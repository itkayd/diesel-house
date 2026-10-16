import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Dir } from '../characters';
import type { RoomId, Zone } from '../config';
import type { Room } from './rooms';
import { devTest } from './mode';
import type { NetQuality } from './netQuality';
import { countMessage, countReconnect } from './stats';
import { supabase } from './supabase';

// Who someone is (shared via Realtime presence; changes rarely). `id` is their account id.
// `mic`: whether others in their room can hear them (see MicState in voice.ts); shown on their name tag.
export type PlayerInfo = { id: string; name: string; character: number; zone: Zone | null; guest?: boolean; mic?: 'on' | 'muted' | 'off' | 'silent'; net?: NetQuality };
// How someone is moving (Realtime broadcast). Sent only when movement changes, plus a correction every
// 500 ms while walking, so receivers extrapolate from x,y + velocity (px/s). Zone rides along because
// presence updates take a few seconds to spread, and voice needs to know within a second.
// `t` is the sender's clock (ms) when the position was taken.
export type MoveMsg = { id: string; x: number; y: number; vx: number; vy: number; dir: Dir; zone: Zone | null; t: number };
// Door messages, addressed to one person: a knock (to the owner), let in / not now (to the visitor), or
// being asked to leave. The database (room passes) is what actually opens a door; these just tell people.
export type ChatChange = { table: 'messages' | 'reactions'; type: 'INSERT' | 'DELETE'; row: Record<string, unknown> };
export type DoorMsg = { kind: 'knock' | 'let-in' | 'not-now' | 'kick'; room: RoomId; from: string; to: string; name: string; character: number };
// Presence also carries which tab this is and when it joined, so a second tab of the same person wins.
type Meta = Omit<PlayerInfo, 'id'> & { tab: string; since: number };

type Handlers = {
  onJoin: (p: PlayerInfo) => void;
  onLeave: (id: string) => void;
  onInfo: (p: PlayerInfo) => void;
  onMove: (m: MoveMsg) => void;
  onStatus: (status: 'connecting' | 'reconnecting' | 'online' | 'offline') => void;
  // Someone asked everyone for a fresh position (they just reconnected): send ours once.
  onSyncRequest: () => void;
  // The house connection was rebuilt (after a phone slept, say): rejoin voice.
  onReconnected: () => void;
  onRoomChange: (room: Room) => void;
  onDoor: (m: DoorMsg) => void;
  // Room chat changes (new or deleted messages and reactions), already filtered by the database to rooms
  // this person may see.
  onChat: (e: ChatChange) => void;
  // This person opened Diesel House in another tab or device, which takes over.
  onReplaced: () => void;
};

const CHANNEL = 'house';
// Supabase cuts off a client that updates its presence too often (ClientPresenceRateLimitReached), e.g.
// someone standing in a doorway flipping between hallway and room. Presence is sent at most this often,
// always with the latest info; positions and zones travel in move messages anyway.
const TRACK_EVERY_MS = 2000;
// If the channel drops (rate limit, network, phone asleep) and doesn't come back by itself, start again.
const RECONNECT_MS = [2000, 5000, 10000, 20000, 30000];
// Back from the background (or the network) after this long, or nothing heard for this long: rebuild.
const STALE_MS = 10_000;

export class Presence {
  private channel: RealtimeChannel | null = null;
  private info: Meta;
  private known = new Map<string, PlayerInfo>();
  private readonly tab = crypto.randomUUID();
  private replaced = false;
  private lastTrack = 0;
  private trackTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private hiddenAt = 0;
  private lastHeard = Date.now(); // anything received on the house channel
  private rebuilding = false;
  private lastRebuild = 0;
  private watching = false;

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
    this.h.onStatus(this.rebuilding ? 'reconnecting' : 'connecting');
    this.watchResume();
    // Private: only signed-in people on the guest list may join (see supabase/migrations/*_realtime_auth.sql).
    const ch = supabase.channel(CHANNEL, { config: { private: !devTest, broadcast: { self: false }, presence: { key: this.id } } });
    ch.on('broadcast', { event: 'sync' }, () => {
      countMessage('received', 'sync');
      this.lastHeard = Date.now();
      if (!this.replaced) this.h.onSyncRequest();
    });
    ch.on('broadcast', { event: 'move' }, ({ payload }) => {
      countMessage('received', 'move');
      this.lastHeard = Date.now();
      if (this.replaced) return;
      const m = payload as MoveMsg;
      // Dev-only: ?lag=200 delays incoming movement (with jitter) to check smoothing on slow links.
      if (this.opts.lagMs) setTimeout(() => this.h.onMove(m), this.opts.lagMs * (0.75 + Math.random() * 0.5));
      else this.h.onMove(m);
    });
    ch.on('broadcast', { event: 'door' }, ({ payload }) => {
      countMessage('received', 'door');
      const m = payload as DoorMsg;
      if (m.to === this.id && !this.replaced) this.h.onDoor(m);
    });
    ch.on('presence', { event: 'sync' }, () => {
      this.lastHeard = Date.now();
      this.sync();
    });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, ({ new: row }) => this.h.onRoomChange(row as Room));
    for (const table of ['messages', 'reactions'] as const)
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        if (p.eventType === 'INSERT' || p.eventType === 'DELETE')
          this.h.onChat({ table, type: p.eventType, row: (p.eventType === 'INSERT' ? p.new : p.old) as Record<string, unknown> });
      });
    ch.subscribe((status, err) => {
      if (this.channel !== ch) return; // an old channel we replaced
      if (status === 'SUBSCRIBED') {
        this.failures = 0;
        this.lastHeard = Date.now();
        this.h.onStatus('online');
        this.lastTrack = 0;
        this.announce(); // also re-announces us after a dropped connection rejoins
        if (this.rebuilding) {
          this.rebuilding = false;
          this.requestSync(); // everyone sends their position once, so we see them straight away
          this.h.onReconnected();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (err) console.warn('House channel:', status, err.message);
        this.h.onStatus('offline');
        this.scheduleReconnect(ch);
      }
    });
    this.channel = ch;
  }

  // Tells everyone our latest info, but not more than once every TRACK_EVERY_MS.
  private announce() {
    const ch = this.channel;
    if (!ch || ch.state !== 'joined' || this.replaced) return;
    const wait = this.lastTrack + TRACK_EVERY_MS - Date.now();
    if (wait > 0) {
      this.trackTimer ??= setTimeout(() => {
        this.trackTimer = null;
        this.announce();
      }, wait);
      return;
    }
    this.lastTrack = Date.now();
    void ch.track(this.info);
  }

  // Supabase retries some failures itself; if we're still not back after a while, make a fresh channel.
  private scheduleReconnect(ch: RealtimeChannel) {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_MS[Math.min(this.failures, RECONNECT_MS.length - 1)];
    this.failures++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.channel !== ch || ch.state === 'joined') return;
      this.channel = null;
      void supabase?.removeChannel(ch);
      this.rebuilding = true;
      countReconnect();
      this.connect();
    }, delay);
  }

  // Phones pause background tabs and drop their sockets. When we come back (tab visible again, page
  // restored, network back), check the connection; if it's dead or we were away long enough for it to
  // go stale, rebuild it. Never ask anyone to reload.
  private watchResume() {
    if (this.watching) return;
    this.watching = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hiddenAt = Date.now();
      else this.resume(false);
    });
    addEventListener('pageshow', (e) => (e as PageTransitionEvent).persisted && this.resume(true));
    addEventListener('online', () => this.resume(true));
  }

  resume(force: boolean) {
    const away = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    const ch = this.channel;
    const dead = !ch || ch.state !== 'joined' || !supabase?.realtime.isConnected();
    // Stale: away a while and nothing has arrived since (a sleeping phone's socket is usually dead).
    const stale = away > STALE_MS && Date.now() - this.lastHeard > STALE_MS;
    if (force || dead || stale) this.rebuild();
    else if (away > 2000) this.requestSync();
  }

  // Throw the house channel away and join again (resubscribe, re-announce, ask for positions, rejoin voice).
  rebuild() {
    // Not twice at once (visibilitychange and pageshow can both fire on waking).
    if (Date.now() - this.lastRebuild < 3000) return;
    this.lastRebuild = Date.now();
    this.rebuilding = true;
    countReconnect();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const old = this.channel;
    this.channel = null;
    if (old) void supabase?.removeChannel(old);
    supabase?.realtime.connect(); // reopens the socket if the phone's sleep closed it
    this.connect();
  }

  // Ask everyone for their current position (each replies once with a move message).
  requestSync() {
    if (this.channel?.state !== 'joined') return;
    countMessage('sent', 'sync');
    void this.channel.send({ type: 'broadcast', event: 'sync', payload: { from: this.id } });
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
      const p: PlayerInfo = { id: key, name: m.name, character: m.character, zone: m.zone, guest: !!m.guest, mic: m.mic, net: m.net };
      seen.add(key);
      const old = this.known.get(key);
      this.known.set(key, p);
      if (!old) this.h.onJoin(p);
      else if (old.name !== p.name || old.character !== p.character || old.zone !== p.zone || old.guest !== p.guest || old.mic !== p.mic || old.net !== p.net) this.h.onInfo(p);
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
    this.announce();
  }

  update(change: Partial<Omit<PlayerInfo, 'id'>>) {
    this.info = { ...this.info, ...change };
    this.announce();
  }

  sendMove(m: Omit<MoveMsg, 'id' | 't'>) {
    if (this.replaced || this.channel?.state !== 'joined' || !supabase?.realtime.isConnected()) return;
    countMessage('sent', 'move');
    void this.channel.send({ type: 'broadcast', event: 'move', payload: { ...m, id: this.id, t: Date.now() } });
  }

  sendDoor(m: Omit<DoorMsg, 'from'>) {
    if (this.channel?.state !== 'joined') return;
    countMessage('sent', 'door');
    void this.channel.send({ type: 'broadcast', event: 'door', payload: { ...m, from: this.id } });
  }

  // Tab closing: tell everyone straight away rather than waiting for the server to notice.
  leave() {
    if (this.channel?.state === 'joined') void this.channel.untrack();
  }
}
