import type { RealtimeChannel } from '@supabase/supabase-js';
import { asSkin, legacyIndex, type Dir, type Skin } from '../characters';
import type { Zone } from '../config';
import type { Room } from './rooms';
import type { DuelMsg } from '../games/rps';
import { devTest } from './mode';
import type { NetQuality } from './netQuality';
import { countMessage, countReconnect } from './stats';
import { supabase } from './supabase';

// Who someone is (shared via Realtime presence; changes rarely). `id` is their account id.
// Presence carries only what rarely changes (name, character, guest). Zone, mic state and connection
// rating change often, so they ride on move messages instead (Supabase allows each client only 5 presence
// updates per 30 s; more and it closes the channel: ClientPresenceRateLimitReached).
// `mic`: whether others in their room can hear them (see MicState in voice.ts); shown on their name tag.
// lv / st: level and day streak for name tags (Phase 14); members only, set once known.
export type PlayerInfo = { id: string; name: string; character: Skin; pet?: string | null; zone: Zone | null; guest?: boolean; mic?: 'on' | 'muted' | 'off' | 'silent'; net?: NetQuality; lv?: number; st?: number };
// How someone is moving (Realtime broadcast). Sent only when movement changes, plus a correction every
// 500 ms while walking, so receivers extrapolate from x,y + velocity (px/s). Zone rides along because
// presence updates take a few seconds to spread, and voice needs to know within a second.
// `t` is the sender's clock (ms) when the position was taken.
export type MoveMsg = { id: string; x: number; y: number; vx: number; vy: number; dir: Dir; zone: Zone | null; t: number; mic?: PlayerInfo['mic']; net?: NetQuality };
export type ChatChange = { table: 'messages' | 'reactions'; type: 'INSERT' | 'DELETE'; row: Record<string, unknown> };
// An emote (UPDATE.md Phase 11): `e` is an EmoteId; `to` when sent from the tap-a-friend menu.
// cheer: a challenge done or a level up (friends in the same room see confetti).
export type EmoteMsg = { from: string; e: string; to?: string; cheer?: boolean };
// Games (UPDATE.md Phase 12): a dice roll over someone's head, and rock-paper-scissors duel messages.
export type DiceMsg = { from: string; v: number[]; s: number };
// A room's shared study timer (REDESIGN.md R3, the Library): set (ms left), stop, or ask who has one.
export type TimerMsg = { from: string; room: string; k: 'set' | 'stop' | 'ask'; left?: number };
// Presence also carries which tab this is and when it joined, so a second tab of the same person wins.
type Meta = Omit<PlayerInfo, 'id'> & { tab: string; since: number };
// On the wire, `character` is the old number (for older copies of the game, one release) and `skin` the key.
type WireMeta = Omit<Meta, 'character'> & { character: number | Skin; skin?: Skin };

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
  // Someone caught a critter (supabase/migrations/20261028_critters.sql).
  onCatch?: (c: { slot: number; idx: number; user_id: string; critter: string; xp: number }) => void;
  onEmote: (m: EmoteMsg) => void;
  onDice: (m: DiceMsg) => void;
  onDuel: (m: DuelMsg) => void;
  onTimer?: (m: TimerMsg) => void;
  // Room chat changes (new or deleted messages and reactions), already filtered by the database to rooms
  // this person may see.
  onChat: (e: ChatChange) => void;
  // This person opened Diesel House in another tab or device, which takes over.
  onReplaced: () => void;
};

const CHANNEL = 'house';
// Supabase allows each client at most 5 presence updates (track or untrack) per 30 s per channel, and
// closes the channel past that (ClientPresenceRateLimitReached). Presence is only re-sent for name or
// character changes, at most this often, always with the latest info.
const TRACK_EVERY_MS = 10_000;
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
    ch.on('broadcast', { event: 'dice' }, ({ payload }) => {
      countMessage('received', 'dice');
      if (!this.replaced) this.h.onDice(payload as DiceMsg);
    });
    ch.on('broadcast', { event: 'duel' }, ({ payload }) => {
      countMessage('received', 'duel');
      const m = payload as DuelMsg;
      if (!this.replaced && (m.to === this.id || m.k === 'end') && m.from !== this.id) this.h.onDuel(m);
    });
    ch.on('broadcast', { event: 'emote' }, ({ payload }) => {
      countMessage('received', 'emote');
      if (!this.replaced) this.h.onEmote(payload as EmoteMsg);
    });
    ch.on('broadcast', { event: 'timer' }, ({ payload }) => {
      countMessage('received', 'timer');
      if (!this.replaced) this.h.onTimer?.(payload as TimerMsg);
    });
    ch.on('presence', { event: 'sync' }, () => {
      this.lastHeard = Date.now();
      this.sync();
    });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, ({ new: row }) => this.h.onRoomChange(row as Room));
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'critter_catches' }, ({ new: row }) => {
      const r = row as { slot: number | string; idx?: number; user_id: string; critter: string; xp: number };
      this.h.onCatch?.({ slot: Number(r.slot), idx: Number(r.idx ?? 0), user_id: r.user_id, critter: r.critter, xp: Number(r.xp) });
    });
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
    void ch.track({ ...this.info, character: legacyIndex(this.info.character), skin: this.info.character } satisfies WireMeta);
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
    const state = this.channel!.presenceState<WireMeta>();
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
      const lv = Number.isFinite(m.lv) && m.lv! >= 1 ? Math.floor(m.lv!) : undefined;
      const st = Number.isFinite(m.st) && m.st! >= 0 ? Math.floor(m.st!) : undefined;
      const p: PlayerInfo = { id: key, name: m.name, character: asSkin(m.skin ?? m.character), pet: m.pet ?? null, zone: m.zone, guest: !!m.guest, mic: m.mic, net: m.net, lv, st };
      seen.add(key);
      const old = this.known.get(key);
      this.known.set(key, p);
      if (!old) this.h.onJoin(p);
      else if (old.name !== p.name || old.character !== p.character || old.pet !== p.pet || old.zone !== p.zone || old.guest !== p.guest || old.mic !== p.mic || old.net !== p.net || old.lv !== p.lv || old.st !== p.st) this.h.onInfo(p);
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

  sendDice(m: Omit<DiceMsg, 'from'>) {
    if (this.replaced || this.channel?.state !== 'joined') return;
    countMessage('sent', 'dice');
    void this.channel.send({ type: 'broadcast', event: 'dice', payload: { ...m, from: this.id } });
  }

  sendDuel(m: DuelMsg) {
    if (this.replaced || this.channel?.state !== 'joined') return;
    countMessage('sent', 'duel');
    void this.channel.send({ type: 'broadcast', event: 'duel', payload: m });
  }

  sendTimer(m: Omit<TimerMsg, 'from'>) {
    if (this.replaced || this.channel?.state !== 'joined') return;
    countMessage('sent', 'timer');
    void this.channel.send({ type: 'broadcast', event: 'timer', payload: { ...m, from: this.id } });
  }

  sendEmote(m: Omit<EmoteMsg, 'from'>) {
    if (this.replaced || this.channel?.state !== 'joined') return;
    countMessage('sent', 'emote');
    void this.channel.send({ type: 'broadcast', event: 'emote', payload: { ...m, from: this.id } });
  }

  // Tab closing: tell everyone straight away rather than waiting for the server to notice.
  leave() {
    if (this.channel?.state === 'joined') void this.channel.untrack();
  }
}
