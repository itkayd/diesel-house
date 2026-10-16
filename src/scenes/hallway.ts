import type { HallPolicy, WalkieMsg } from '../net/voice';
import { busyBuzz, squelch } from '../ui/radioSfx';

// Hallway voice rules (UPDATE.md Phase 10). Rooms never hear the hallway and the hallway never hears
// rooms; inside the hallway there are two ways to talk:
// - Whisper: just talk next to someone. Our mic opens only while someone is within WHISPER px and goes
//   only to them; they hear us muffled and quieter, fading out by WHISPER px.
// - Walkie-talkie: hold the button (or T). Everyone in the hallway hears us through a radio filter, at
//   full volume. One talker at a time, at most WALKIE_MAX ms per press.
// Connections: to people within CONNECT px (dropped past DROP px), or to everyone in the hallway while
// someone's on the walkie and for STAY_CONNECTED ms after. Positions come from the movement messages the
// house already shares, so none of this adds Realtime messages while standing still.

export const WHISPER = 64; // px (4 tiles): whisper range
const FULL = 24; // px: whisper at full (whisper) loudness up to here
const CONNECT = 96; // px: start a connection
const DROP = 128; // px: end it
const WHISPER_GAIN = 0.5; // −6 dB
const WALKIE_MAX = 15_000; // ms per press
const STAY_CONNECTED = 10_000; // ms after the walkie goes quiet
const STALE_TALKER = 16_000; // ms: someone's "start" with no "end" (closed tab) stops counting

const KEYS = { whisper: 'diesel-house.whisper', hear: 'diesel-house.hear-walkie', key: 'diesel-house.walkie-key' };
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // not remembered in private browsing
  }
};

type Pos = { x: number; y: number; inHall: boolean; mic?: boolean };
type Deps = {
  myId: () => string;
  me: () => Pos;
  peer: (id: string) => Pos | null;
  myMic: () => boolean; // we have a mic to whisper with
  send: (m: WalkieMsg) => void;
  onChange: () => void; // walkie state changed: redraw the button, the strip, the icons
};

export class Hallway implements HallPolicy {
  whisperOn = read(KEYS.whisper) !== '0';
  hearWalkie = read(KEYS.hear) !== '0';
  walkieKey = read(KEYS.key) || 't';
  talker: { id: string; t: number; since: number } | null = null;
  private lastTalk = new Map<string, number>();
  private autoEnd = 0;

  constructor(private d: Deps) {}

  setWhisper(on: boolean) {
    this.whisperOn = on;
    write(KEYS.whisper, on ? '1' : '0');
  }
  setHearWalkie(on: boolean) {
    this.hearWalkie = on;
    write(KEYS.hear, on ? '1' : '0');
  }
  setWalkieKey(k: string) {
    this.walkieKey = k;
    write(KEYS.key, k);
  }

  private dist(id: string) {
    const me = this.d.me();
    const p = this.d.peer(id);
    if (!me.inHall || !p?.inHall) return Infinity;
    return Math.hypot(p.x - me.x, p.y - me.y);
  }

  private get live() {
    if (this.talker && Date.now() - this.talker.since > STALE_TALKER) this.talker = null;
    return this.talker;
  }
  get talkerId() {
    return this.live?.id ?? null;
  }
  get meTalking() {
    return this.talkerId === this.d.myId();
  }
  // Someone else has the walkie: our button shows "Channel busy".
  get busy() {
    return !!this.talkerId && !this.meTalking;
  }
  private get walkieActive() {
    if (this.talkerId) return true;
    const now = Date.now();
    for (const t of this.lastTalk.values()) if (now - t < STAY_CONNECTED) return true;
    return false;
  }

  // Seconds left on our walkie press (0 when not talking).
  get secondsLeft() {
    return this.meTalking && this.talker ? Math.max(0, Math.ceil((WALKIE_MAX - (Date.now() - this.talker.since)) / 1000)) : 0;
  }

  // Anyone (in the hallway) near enough to whisper to?
  get someoneNear() {
    return this.nearby().length > 0;
  }
  nearby(): string[] {
    return this.idsInHall().filter((id) => this.dist(id) <= WHISPER);
  }
  idsInHall: () => string[] = () => [];

  // ---- HallPolicy (asked by voice.ts) ----
  wants(id: string, connected: boolean) {
    const d = this.dist(id);
    if (d === Infinity) return false;
    if (this.walkieActive) return true;
    // Whisper only works if one of us has a mic on: otherwise a connection would carry nothing.
    if (!this.d.myMic() && !this.d.peer(id)?.mic) return false;
    return d <= (connected ? DROP : CONNECT);
  }
  sendsTo(id: string) {
    if (this.meTalking) return true;
    return this.whisperOn && this.dist(id) <= WHISPER;
  }
  route(id: string) {
    if (this.talkerId === id) return this.hearWalkie ? { mode: 'radio' as const, gain: 1 } : { mode: 'off' as const, gain: 0 };
    const d = this.dist(id);
    if (!this.whisperOn || d > WHISPER) return { mode: 'off' as const, gain: 0 };
    const fade = d <= FULL ? 1 : 0.5 * (1 + Math.cos((Math.PI * (d - FULL)) / (WHISPER - FULL)));
    return { mode: 'whisper' as const, gain: WHISPER_GAIN * fade };
  }
  micOpen() {
    return this.meTalking || (this.whisperOn && this.someoneNear);
  }

  // ---- Walkie-talkie ----
  // Press: 'ok', or 'busy' if someone else has it (with a buzz).
  press(): 'ok' | 'busy' {
    if (this.busy) {
      busyBuzz();
      return 'busy';
    }
    if (this.meTalking) return 'ok';
    const t = Date.now();
    this.talker = { id: this.d.myId(), t, since: t };
    this.d.send({ kind: 'start', from: this.d.myId(), t });
    squelch(true);
    clearTimeout(this.autoEnd);
    this.autoEnd = window.setTimeout(() => this.release(), WALKIE_MAX);
    this.d.onChange();
    return 'ok';
  }

  release() {
    if (!this.meTalking) return;
    clearTimeout(this.autoEnd);
    const me = this.d.myId();
    this.d.send({ kind: 'end', from: me, t: Date.now() });
    this.lastTalk.set(me, Date.now());
    this.talker = null;
    squelch(false);
    this.d.onChange();
  }

  // Messages from voice:hallway. Two starts at once: the earlier press wins (then the lower id), on
  // every screen the same way; the loser hears the busy buzz.
  onMessage(m: WalkieMsg) {
    const now = Date.now();
    if (m.kind === 'start') {
      const cur = this.live;
      const wins = !cur || cur.id === m.from || m.t < cur.t || (m.t === cur.t && m.from < cur.id);
      if (!wins) return;
      const lost = cur && cur.id === this.d.myId() && cur.id !== m.from;
      if (lost) {
        clearTimeout(this.autoEnd);
        busyBuzz();
      }
      if (!cur || cur.id !== m.from) this.hearWalkie && squelch(true);
      this.talker = { id: m.from, t: m.t, since: now };
    } else if (this.talker?.id === m.from) {
      this.talker = null;
      this.lastTalk.set(m.from, now);
      if (this.hearWalkie) squelch(false);
    }
    this.d.onChange();
  }

  // Leaving the hallway: let go of the walkie.
  leftHallway() {
    this.release();
  }
}
