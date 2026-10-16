import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomId } from '../config';
import { devTest } from '../net/mode';
import { countMessage } from '../net/stats';
import { supabase } from '../net/supabase';

// A game spot's table (UPDATE.md Phase 12): one Realtime topic per spot, game:hall or game:room_0N,
// broadcast plus presence (who is sitting at it). Whoever starts a game is the host: their browser holds
// the game and sends a full small snapshot on each change, never per-frame messages. Players send their
// moves to the host. If the host leaves, the player who sat down first takes over from the last snapshot.

export type SpotId = 'hall' | RoomId;
export type Seat = { id: string; name: string; character: number; guest?: boolean; at: number }; // at: when they sat down
export type Snapshot<S = unknown> = { v: number; host: string; game: string; players: Seat[]; state: S };

type Handlers = {
  // A new snapshot (from the host, or our own as host).
  onSnapshot: (s: Snapshot) => void;
  // Host only: a player's move.
  onAction: (from: string, a: unknown) => void;
  // Who is at the table now (players and watchers).
  onPeople: (seats: Seat[]) => void;
  // The host left and we are taking over: carry the game on from `s`.
  onTakeover: (s: Snapshot) => void;
};

const LINGER_MS = 15_000; // keep the channel a while after closing the panel (presence allows 5 updates / 30 s)

export class GameTable {
  private channel: RealtimeChannel | null = null;
  private linger: ReturnType<typeof setTimeout> | null = null;
  private seated = false;
  private at = Date.now();
  private present = new Map<string, Seat>();
  snap: Snapshot | null = null;

  constructor(
    readonly spot: SpotId,
    private me: Omit<Seat, 'at'>,
    private h: Handlers,
  ) {}

  get id() {
    return this.me.id;
  }
  get isHost() {
    return this.snap?.host === this.me.id;
  }
  get people() {
    return [...this.present.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }

  // Sit down at the table (open its panel).
  open() {
    if (this.linger) clearTimeout(this.linger);
    this.linger = null;
    if (!supabase) return;
    if (this.channel) {
      if (!this.seated) this.track();
      return;
    }
    const ch = supabase.channel(`game:${this.spot}`, { config: { private: !devTest, broadcast: { self: false }, presence: { key: this.me.id } } });
    this.channel = ch;
    ch.on('broadcast', { event: 'snap' }, ({ payload }) => {
      countMessage('received', 'game');
      this.accept(payload as Snapshot);
    });
    ch.on('broadcast', { event: 'act' }, ({ payload }) => {
      countMessage('received', 'game');
      const { from, a } = payload as { from: string; a: unknown };
      if (this.isHost) this.h.onAction(from, a);
    });
    ch.on('broadcast', { event: 'hello' }, () => {
      countMessage('received', 'game');
      if (this.isHost && this.snap) this.send('snap', this.snap); // a newcomer gets the game as it is
    });
    ch.on('presence', { event: 'sync' }, () => this.sync());
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      this.track();
      this.send('hello', {});
    });
  }

  // Stand up (close the panel). The channel stays a little while in case they come straight back.
  close() {
    if (this.seated) void this.channel?.untrack();
    this.seated = false;
    if (this.linger) clearTimeout(this.linger);
    this.linger = setTimeout(() => this.destroy(), LINGER_MS);
  }

  destroy() {
    if (this.linger) clearTimeout(this.linger);
    this.linger = null;
    if (this.channel) void supabase?.removeChannel(this.channel);
    this.channel = null;
    this.seated = false;
    this.present.clear();
  }

  // Host: start a game (or a new one), with us as host.
  start<S>(game: string, players: Seat[], state: S) {
    this.publish({ v: (this.snap?.v ?? 0) + 1, host: this.me.id, game, players, state });
  }

  // Host: the game changed.
  update<S>(change: Partial<Pick<Snapshot<S>, 'players' | 'state'>>) {
    if (!this.snap || !this.isHost) return;
    this.publish({ ...this.snap, ...change, v: this.snap.v + 1 });
  }

  // A move: to the host (or straight to our own handler if we are the host).
  act(a: unknown) {
    if (this.isHost) this.h.onAction(this.me.id, a);
    else this.send('act', { from: this.me.id, a });
  }

  // This seat (for joining a game's player list).
  seat(): Seat {
    return { ...this.me, at: this.at };
  }

  private publish(s: Snapshot) {
    this.snap = s;
    this.send('snap', s);
    this.h.onSnapshot(s);
  }

  private accept(s: Snapshot) {
    // Newer versions win; a takeover (new host) restarts the numbering from the last one seen.
    if (this.snap && s.v <= this.snap.v && s.host === this.snap.host) return;
    this.snap = s;
    this.h.onSnapshot(s);
  }

  private track() {
    this.seated = true;
    void this.channel?.track({ name: this.me.name, character: this.me.character, guest: !!this.me.guest, at: this.at });
  }

  private sync() {
    const state = this.channel?.presenceState<{ name: string; character: number; guest: boolean; at: number }>() ?? {};
    this.present.clear();
    for (const [id, metas] of Object.entries(state)) {
      const m = metas[0];
      if (m) this.present.set(id, { id, name: m.name, character: m.character, guest: m.guest, at: m.at });
    }
    this.h.onPeople(this.people);
    // The host has gone: the player who sat down first (and is still here) carries on.
    const s = this.snap;
    if (!s || this.present.has(s.host)) return;
    const next = s.players.filter((p) => this.present.has(p.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
    if (next?.id !== this.me.id) return;
    this.snap = { ...s, host: this.me.id, v: s.v + 1 };
    this.send('snap', this.snap);
    this.h.onTakeover(this.snap);
  }

  private send(event: 'snap' | 'act' | 'hello', payload: unknown) {
    if (!this.channel) return;
    countMessage('sent', 'game');
    void this.channel.send({ type: 'broadcast', event, payload });
  }
}
