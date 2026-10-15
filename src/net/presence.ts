import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Dir } from '../characters';
import type { Zone } from '../config';
import type { Room } from './rooms';
import { devTest } from './mode';
import { countMessage } from './stats';
import { supabase } from './supabase';

// Who someone is (shared via Realtime presence; changes rarely). `id` is their account id.
export type PlayerInfo = { id: string; name: string; character: number; zone: Zone | null; guest?: boolean };
// How someone is moving (Realtime broadcast). Sent only when movement changes, plus a correction every
// 500 ms while walking, so receivers extrapolate from x,y + velocity (px/s). Zone rides along because
// presence updates take a few seconds to spread, and voice needs to know within a second.
// `t` is the sender's clock (ms) when the position was taken.
export type MoveMsg = { id: string; x: number; y: number; vx: number; vy: number; dir: Dir; zone: Zone | null; t: number };
// Presence also carries which tab this is and when it joined, so a second tab of the same person wins.
type Meta = Omit<PlayerInfo, 'id'> & { tab: string; since: number };

type Handlers = {
  onJoin: (p: PlayerInfo) => void;
  onLeave: (id: string) => void;
  onInfo: (p: PlayerInfo) => void;
  onMove: (m: MoveMsg) => void;
  onStatus: (status: 'connecting' | 'online' | 'offline') => void;
  onRoomChange: (room: Room) => void;
  // This person opened Diesel House in another tab or device, which takes over.
  onReplaced: () => void;
};

const CHANNEL = 'house';

export class Presence {
  private channel: RealtimeChannel | null = null;
  private info: Meta;
  private known = new Map<string, PlayerInfo>();
  private readonly tab = crypto.randomUUID();
  private replaced = false;

  constructor(
    readonly id: string,
    info: Omit<PlayerInfo, 'id'>,
    private h: Handlers,
    private opts: { lagMs?: number } = {},
  ) {
    this.info = { ...info, tab: this.tab, since: Date.now() };
  }

  connect() {
    if (!supabase) {
      console.warn('Supabase not configured (.env missing) — running offline');
      this.h.onStatus('offline');
      return;
    }
    this.h.onStatus('connecting');
    // Private: only signed-in people on the guest list may join (see supabase/migrations/*_realtime_auth.sql).
    const ch = supabase.channel(CHANNEL, { config: { private: !devTest, broadcast: { self: false }, presence: { key: this.id } } });
    ch.on('broadcast', { event: 'move' }, ({ payload }) => {
      countMessage('received', 'move');
      if (this.replaced) return;
      const m = payload as MoveMsg;
      // Dev-only: ?lag=200 delays incoming movement (with jitter) to check smoothing on slow links.
      if (this.opts.lagMs) setTimeout(() => this.h.onMove(m), this.opts.lagMs * (0.75 + Math.random() * 0.5));
      else this.h.onMove(m);
    });
    ch.on('presence', { event: 'sync' }, () => this.sync());
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, ({ new: row }) => this.h.onRoomChange(row as Room));
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        this.h.onStatus('online');
        if (!this.replaced) void ch.track(this.info); // also re-announces us after a dropped connection rejoins
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.warn('House channel:', status, err.message);
        this.h.onStatus('offline');
      }
    });
    this.channel = ch;
  }

  // Diff presence state against what we knew, and report joins/leaves/changes.
  private sync() {
    const state = this.channel!.presenceState<Meta>();
    const seen = new Set<string>();
    for (const [key, metas] of Object.entries(state)) {
      if (!metas.length) continue;
      if (key === this.id) {
        // Same person, another tab or device: the newest one is "them"; this one steps aside.
        if (!this.replaced && metas.some((m) => m.tab !== this.tab && m.since > this.info.since)) {
          this.replaced = true;
          void this.channel?.untrack();
          this.h.onReplaced();
        }
        continue;
      }
      const m = metas.reduce((a, b) => (b.since > a.since ? b : a));
      const p: PlayerInfo = { id: key, name: m.name, character: m.character, zone: m.zone, guest: !!m.guest };
      seen.add(key);
      const old = this.known.get(key);
      this.known.set(key, p);
      if (!old) this.h.onJoin(p);
      else if (old.name !== p.name || old.character !== p.character || old.zone !== p.zone || old.guest !== p.guest) this.h.onInfo(p);
    }
    for (const id of [...this.known.keys()]) {
      if (!seen.has(id)) {
        this.known.delete(id);
        this.h.onLeave(id);
      }
    }
  }

  get isReplaced() {
    return this.replaced;
  }

  // "Use it here instead": this tab takes over again.
  reclaim() {
    this.replaced = false;
    this.info.since = Date.now();
    if (this.channel?.state === 'joined') void this.channel.track(this.info);
  }

  update(change: Partial<Omit<PlayerInfo, 'id'>>) {
    this.info = { ...this.info, ...change };
    if (this.channel?.state === 'joined' && !this.replaced) void this.channel.track(this.info);
  }

  sendMove(m: Omit<MoveMsg, 'id' | 't'>) {
    if (this.replaced || this.channel?.state !== 'joined' || !supabase?.realtime.isConnected()) return;
    countMessage('sent', 'move');
    void this.channel.send({ type: 'broadcast', event: 'move', payload: { ...m, id: this.id, t: Date.now() } });
  }

  // Tab closing: tell everyone straight away rather than waiting for the server to notice.
  leave() {
    if (this.channel?.state === 'joined') void this.channel.untrack();
  }
}
