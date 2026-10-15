import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Dir } from '../characters';
import type { Zone } from '../config';
import { countMessage } from './stats';
import { supabase } from './supabase';

// Who someone is (shared via Realtime presence; changes rarely).
export type PlayerInfo = { id: string; name: string; character: number; zone: Zone | null };
// How someone is moving (Realtime broadcast). Sent only when movement changes, plus a correction every
// 500 ms while walking, so receivers extrapolate from x,y + velocity (px/s). Zone rides along because
// presence updates take a few seconds to spread, and voice needs to know within a second.
// `t` is the sender's clock (ms) when the position was taken.
export type MoveMsg = { id: string; x: number; y: number; vx: number; vy: number; dir: Dir; zone: Zone | null; t: number };

type Handlers = {
  onJoin: (p: PlayerInfo) => void;
  onLeave: (id: string) => void;
  onInfo: (p: PlayerInfo) => void;
  onMove: (m: MoveMsg) => void;
  onStatus: (status: 'connecting' | 'online' | 'offline') => void;
};

const CHANNEL = 'house';

export class Presence {
  // Temporary per-tab id until accounts arrive in Phase 5.
  readonly id = crypto.randomUUID();
  private channel: RealtimeChannel | null = null;
  private info: PlayerInfo;
  private known = new Map<string, PlayerInfo>();

  constructor(
    info: Omit<PlayerInfo, 'id'>,
    private h: Handlers,
    private opts: { lagMs?: number } = {},
  ) {
    this.info = { ...info, id: this.id };
  }

  connect() {
    if (!supabase) {
      console.warn('Supabase not configured (.env missing) — running offline');
      this.h.onStatus('offline');
      return;
    }
    this.h.onStatus('connecting');
    const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false }, presence: { key: this.id } } });
    ch.on('broadcast', { event: 'move' }, ({ payload }) => {
      countMessage('received', 'move');
      const m = payload as MoveMsg;
      // Dev-only: ?lag=200 delays incoming movement (with jitter) to check smoothing on slow links.
      if (this.opts.lagMs) setTimeout(() => this.h.onMove(m), this.opts.lagMs * (0.75 + Math.random() * 0.5));
      else this.h.onMove(m);
    });
    ch.on('presence', { event: 'sync' }, () => this.sync());
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.h.onStatus('online');
        void ch.track(this.info); // also re-announces us after a dropped connection rejoins
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.h.onStatus('offline');
      }
    });
    this.channel = ch;
  }

  // Diff presence state against what we knew, and report joins/leaves/changes.
  private sync() {
    const state = this.channel!.presenceState<PlayerInfo>();
    const seen = new Set<string>();
    for (const [key, metas] of Object.entries(state)) {
      if (key === this.id || !metas.length) continue;
      const m = metas[metas.length - 1];
      const p: PlayerInfo = { id: key, name: m.name, character: m.character, zone: m.zone };
      seen.add(key);
      const old = this.known.get(key);
      this.known.set(key, p);
      if (!old) this.h.onJoin(p);
      else if (old.name !== p.name || old.character !== p.character || old.zone !== p.zone) this.h.onInfo(p);
    }
    for (const id of [...this.known.keys()]) {
      if (!seen.has(id)) {
        this.known.delete(id);
        this.h.onLeave(id);
      }
    }
  }

  update(change: Partial<Omit<PlayerInfo, 'id'>>) {
    this.info = { ...this.info, ...change };
    if (this.channel?.state === 'joined') void this.channel.track(this.info);
  }

  sendMove(m: Omit<MoveMsg, 'id' | 't'>) {
    if (this.channel?.state !== 'joined' || !supabase?.realtime.isConnected()) return;
    countMessage('sent', 'move');
    void this.channel.send({ type: 'broadcast', event: 'move', payload: { ...m, id: this.id, t: Date.now() } });
  }

  // Tab closing: tell everyone straight away rather than waiting for the server to notice.
  leave() {
    if (this.channel?.state === 'joined') void this.channel.untrack();
  }
}
