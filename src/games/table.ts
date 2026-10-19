import { asSkin, legacyIndex, type Skin } from '../characters';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomId } from '../config';
import { devTest } from '../net/mode';
import { countMessage } from '../net/stats';
import { supabase } from '../net/supabase';

// A game spot's table (UPDATE.md Phase 12): one Realtime topic per spot, game:hall or game:room_0N,
// broadcast plus presence (who is sitting at it). Whoever starts a game is the host: their browser holds
// the game and sends a full small snapshot on each change, never per-frame messages. Players send their
// moves to the host. If the host leaves (and stays gone for GRACE_MS), the player who sat down first
// takes over from the last snapshot.
//
// `gen` (host generation) goes up on every start and takeover. If two people start at the same moment, or a
// host whose connection blipped carries on after someone took over, every screen keeps the same one: the
// higher generation, then the lower host id. So there is always exactly one host.

export type SpotId = 'hall' | RoomId;
export type Seat = { id: string; name: string; character: Skin; guest?: boolean; at: number }; // at: when they sat down
export type Snapshot<S = unknown> = { v: number; gen?: number; host: string; game: string; players: Seat[]; state: S };

// What a game's host and screen need from a table (GameTable, or a stand-in in tests).
export type Table = Pick<GameTable, 'id' | 'spot' | 'isHost' | 'people' | 'snap' | 'start' | 'update' | 'act' | 'seat'>;
// Each table game (Quick Draw, Higher or lower, Would you rather, Four in a row) has a host side, run
// by whoever started it (or took it over), and a screen everyone at the table sees.
export interface TableHost {
  start(players: Seat[]): void | Promise<void>;
  takeover(s: Snapshot): void | Promise<void>;
  onAction(from: string, a: unknown): void;
  onPeople(): void;
  stop(): void;
}
export interface TableView {
  readonly root: HTMLElement;
  show(s: Snapshot): void;
  destroy(): void;
}
// name '' and no character for someone we don't know (the seat's own name and character are used then).
export type Names = (id: string) => { name: string; character?: Skin };
// The host saves the result (record_game): players, winners, score, the revealed seed.
export type Recorder = (players: string[], winners: string[], score: unknown, seed?: string) => void;

type Handlers = {
  // A new snapshot (from the host, or our own as host).
  onSnapshot: (s: Snapshot) => void;
  // Host only: a player's move.
  onAction: (from: string, a: unknown) => void;
  // Who is at the table now (players and watchers).
  onPeople: (seats: Seat[]) => void;
  // The host left and we are taking over: carry the game on from `s`.
  onTakeover: (s: Snapshot) => void;
  // Is this game still going? (A finished game isn't taken over.)
  running?: (s: Snapshot) => boolean;
};

const LINGER_MS = 15_000; // keep the channel a while after closing the panel (presence allows 5 updates / 30 s)
// Someone who drops off the table's presence counts as still here this long (phones on 4G blip): no
// takeover, forfeit or skipped turn for a short drop.
export const GRACE_MS = 5_000;

// Does snapshot `a` win over `b`? Higher generation, then (same generation) the lower host id; the same
// host's newer version always wins.
export function wins(a: Snapshot, b: Snapshot) {
  const ga = a.gen ?? 0;
  const gb = b.gen ?? 0;
  if (a.host === b.host && ga === gb) return a.v > b.v;
  if (ga !== gb) return ga > gb;
  return a.host < b.host;
}

export class GameTable {
  private channel: RealtimeChannel | null = null;
  private linger: ReturnType<typeof setTimeout> | null = null;
  private seated = false;
  private at = Date.now();
  private present = new Map<string, Seat>();
  private gone = new Map<string, { seat: Seat; at: number }>(); // just dropped off: still counted for GRACE_MS
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
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
  // Who is at the table: present now, plus anyone who dropped off less than GRACE_MS ago.
  get people() {
    const all = new Map(this.present);
    const now = Date.now();
    for (const [id, g] of this.gone) if (!all.has(id) && now - g.at < GRACE_MS) all.set(id, g.seat);
    return [...all.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
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
    this.gone.clear();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  // Host: start a game (or a new one), with us as host.
  start<S>(game: string, players: Seat[], state: S) {
    this.publish({ v: (this.snap?.v ?? 0) + 1, gen: (this.snap?.gen ?? 0) + 1, host: this.me.id, game, players, state });
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
    if (this.snap && !wins(s, this.snap)) {
      // A host that lost (same moment, or carried on after a blip) hears the winner again.
      if (this.isHost && s.host !== this.me.id) this.send('snap', this.snap);
      return;
    }
    this.snap = s;
    this.h.onSnapshot(s);
  }

  private track() {
    this.seated = true;
    void this.channel?.track({ name: this.me.name, character: legacyIndex(this.me.character), skin: this.me.character, guest: !!this.me.guest, at: this.at });
  }

  private sync() {
    const state = this.channel?.presenceState<{ name: string; character: number | Skin; skin?: Skin; guest: boolean; at: number }>() ?? {};
    const before = new Map(this.present);
    this.present.clear();
    for (const [id, metas] of Object.entries(state)) {
      const m = metas[0];
      if (m) this.present.set(id, { id, name: m.name, character: asSkin(m.skin ?? m.character), guest: m.guest, at: m.at });
    }
    const now = Date.now();
    for (const [id, seat] of before) if (!this.present.has(id) && !this.gone.has(id)) this.gone.set(id, { seat, at: now });
    for (const id of this.present.keys()) this.gone.delete(id);
    // Check again once the grace time is up (the people list changes then too).
    if (this.gone.size && !this.graceTimer)
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        const t = Date.now();
        for (const [id, g] of this.gone) if (t - g.at >= GRACE_MS) this.gone.delete(id);
        this.afterPeople();
        if (this.gone.size) this.sync();
      }, GRACE_MS + 50);
    this.afterPeople();
  }

  private afterPeople() {
    this.h.onPeople(this.people);
    // The host has gone (past the grace time) and the game is still going: the player who sat down first
    // (and is still here) carries on.
    const s = this.snap;
    const here = new Set(this.people.map((p) => p.id));
    if (!s || here.has(s.host) || s.host === this.me.id) return;
    if (this.h.running && !this.h.running(s)) return;
    const next = s.players.filter((p) => here.has(p.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
    if (next?.id !== this.me.id) return;
    this.snap = { ...s, host: this.me.id, v: s.v + 1, gen: (s.gen ?? 0) + 1 };
    this.send('snap', this.snap);
    this.h.onTakeover(this.snap);
  }

  private send(event: 'snap' | 'act' | 'hello', payload: unknown) {
    if (!this.channel) return;
    countMessage('sent', 'game');
    void this.channel.send({ type: 'broadcast', event, payload });
  }
}
