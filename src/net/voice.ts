import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomId } from '../config';
import { audioContext, audioLocked } from './audio';
import { savedMicDevice, saveMicDevice, savedSpeaker, saveSpeaker } from '../prefs';
import { mixer } from '../ui/mixer';
import { devTest } from './mode';
import { countMessage } from './stats';
import { net } from './netQuality';
import { supabase } from './supabase';

// Voice for one "space" at a time: a room, or the hallway. Peer-to-peer WebRTC (max 8 people), signalled
// over a Supabase Realtime channel per space (voice:room_0N, voice:hallway). ICE: Google STUN + Twilio
// TURN from /api/turn.
// Rooms: everyone connects to everyone and hears everyone. Hallway (UPDATE.md Phase 10): a HallPolicy
// decides who to connect to (people nearby, or everyone while someone's on the walkie-talkie), who gets
// our mic (sender-side: replaceTrack, so distant people get no bytes), and how each person sounds
// (receiver-side Web Audio: muffled whisper fading with distance, or a crackly radio).

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CONNECT_TIMEOUT = 10_000; // ms before retrying a peer through TURN only
const STUCK_AFTER = 20_000; // ms before a connection that never came up is started again
const MAINTAIN_EVERY = 3_000; // ms between checks that we're connected to everyone in the room
const ALIVE_CHECK = 2_500; // ms between "is anything still arriving?" checks on someone who left the room list
const DROP_AFTER = 4_000; // ms a connection may stay 'disconnected' before we drop it (other side closed the tab)
const SPEAKING_LEVEL = 0.02; // RMS above which someone counts as speaking
const LEVEL_EVERY = 60; // ms between speaking checks
const STATS_EVERY = 5_000; // ms between call-quality readings (for the connection bars)
const HALL_EVERY = 200; // ms between hallway checks (who to connect to, who hears us, how loud)
const RECONTACT_AFTER = 2_000; // ms before calling the same hallway person again
const SPEAKING_HOLD = 350; // ms the glow stays on after the last loud moment, so it doesn't flicker
const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
// Opus tuning we ask the other side to send us: in-band FEC (survives lost packets on mobile/Middle East
// links), DTX (near-silent when you're quiet), speech bitrate, mono.
const OPUS = { useinbandfec: '1', usedtx: '1', maxaveragebitrate: '32000', stereo: '0' };

// Rewrites the Opus line of an SDP with the settings above.
export function tuneOpus(sdp: string) {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!pt) return sdp;
  const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm');
  const params = new Map<string, string>();
  for (const kv of (sdp.match(fmtp)?.[1] ?? '').split(';'))
    if (kv.includes('=')) params.set(kv.split('=')[0].trim(), kv.split('=')[1].trim());
  for (const [k, v] of Object.entries(OPUS)) params.set(k, v);
  const line = `a=fmtp:${pt} ${[...params].map(([k, v]) => `${k}=${v}`).join(';')}`;
  return fmtp.test(sdp) ? sdp.replace(fmtp, line) : sdp.replace(new RegExp(`^(a=rtpmap:${pt} opus.*)$`, 'mi'), `$1\r\n${line}`);
}

type Signal =
  // retry: second hello shortly after joining. rejoin: our Supabase connection dropped and came back.
  | { kind: 'hello'; from: string; to: string; retry?: boolean; rejoin?: boolean }
  | { kind: 'bye'; from: string; to: string }
  | { kind: 'offer' | 'answer'; from: string; to: string; session: number; relay: boolean; sdp: string }
  | { kind: 'ice'; from: string; to: string; session: number; candidate: RTCIceCandidateInit };

// Hallway: how we hear one person (receiver-side effects, see createFx).
type Fx = { src: MediaStreamAudioSourceNode; whisper: GainNode; radio: GainNode; hiss: GainNode; noise: AudioBufferSourceNode };

// Rooms: their voice through Web Audio, so the volume sliders work on phones too (they ignore
// volume on <audio>). The element stays, muted, to keep the stream flowing in Chrome.
type Room = { src: MediaStreamAudioSourceNode; gain: GainNode };

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null; // our mic to them (null track = they get nothing)
  fx: Fx | null;
  room: Room | null;
  session: number;
  relay: boolean;
  initiator: boolean;
  audio: HTMLAudioElement | null;
  meter: Meter | null;
  timer: number;
  pendingIce: RTCIceCandidateInit[];
  created: number;
};

export type Space = RoomId | 'hallway';
export type VoiceStatus =
  | { state: 'off' }
  | { state: 'joining' }
  | { state: 'in-room'; space: Space; connected: number; total: number; mic: 'on' | 'blocked'; turn: boolean; problem: MicProblemKind; silent: boolean };

// The rules for a space where you're heard by distance, not by everyone (src/scenes/hallway.ts): the
// hallway, and quiet rooms like the Library (REDESIGN.md §2). Asked every HALL_EVERY ms.
export type HallPolicy = {
  // Should we be connected to this person? (connected: we are now, so use the far edge of the range.)
  wants(id: string, connected: boolean): boolean;
  // Send them our mic right now?
  sendsTo(id: string): boolean;
  // How we hear them: muffled whisper at some loudness, the walkie-talkie radio, or nothing.
  route(id: string): { mode: 'whisper' | 'radio' | 'off'; gain: number };
  // Should our mic be open at all (someone near enough to whisper to, or we're on the walkie)?
  micOpen(): boolean;
};
// Walkie-talkie floor control, broadcast on voice:hallway.
export type WalkieMsg = { kind: 'start' | 'end'; from: string; t: number };
export type MicProblemKind = 'declined' | 'denied' | 'busy' | 'none' | 'unsupported' | null;
// What others get from our mic: sending sound, muted (or push-to-talk not held), no mic, or a mic that
// only gives silence (on Android, usually another app holding it).
export type MicState = 'on' | 'muted' | 'off' | 'silent';
// ms of exact digital silence from a live mic before we call it broken (dev ?silentms= shortens it for tests)
const KEEP_MIC_MS = 3 * 60_000; // a mic stays switched on (but silenced) this long after leaving a room
const SILENT_AFTER = (import.meta.env.DEV && Number(new URLSearchParams(location.search).get('silentms'))) || 20_000;

type Handlers = {
  onSpeaking: (id: string, speaking: boolean) => void;
  onStatus: (s: VoiceStatus) => void;
  // The browser is holding sound back until the player taps (iPhone): ask for a tap.
  onAudioLocked: () => void;
  // Explain the mic before the browser asks. Resolves false to join listening only. (The hallway only
  // uses the mic if it was allowed before, so walking in doesn't pop up a question.)
  askMic: (cancelled: Promise<void>, space: Space) => Promise<boolean>;
  // Distance rules for a space (the hallway, quiet rooms), or null for a room where everyone hears
  // everyone; and walkie-talkie messages (only in the hallway).
  policyFor?: (space: Space) => HallPolicy | null;
  onWalkie?: (m: WalkieMsg) => void;
  // How loud this person should be for us (0..1), when their audio starts.
  volumeFor: (id: string) => number;
  // Our mic's state changed (shared with everyone so they can see why they can't hear us).
  onMicState?: (s: MicState) => void;
};

// Total bytes received over a connection (audio, plus the control messages that flow even when muted).
async function bytesIn(pc: RTCPeerConnection) {
  let n = 0;
  (await pc.getStats()).forEach((s) => s.type === 'transport' && (n += s.bytesReceived ?? 0));
  return n;
}

// Measures loudness of a stream via Web Audio.
class Meter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buf: Float32Array<ArrayBuffer>;
  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048; // ~43 ms of audio per reading
    this.buf = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }
  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }
  disconnect() {
    this.source.disconnect();
  }
}

export class Voice {
  space: Space | null = null;
  // This space's distance rules (hallway, quiet rooms), or null: everyone hears everyone.
  private policy: HallPolicy | null = null;
  // The room we're in (null in the hallway or nowhere).
  get room(): RoomId | null {
    return this.space && this.space !== 'hallway' ? this.space : null;
  }
  private channel: RealtimeChannel | null = null;
  private peers = new Map<string, Peer>();
  private stream: MediaStream | null = null;
  // The mic after leaving a room, switched off but kept for KEEP_MIC_MS: walking room → hall → room reuses it
  // instead of opening it again (phones show a "Microphone access" banner every time the mic opens).
  private parked: MediaStream | null = null;
  private parkTimer = 0;
  private localMeter: Meter | null = null;
  private ctx: AudioContext | null = null;
  private ice: { servers: RTCIceServer[]; turn: boolean; expires: number } | null = null;
  private joinToken = 0;
  private cancelJoin: (() => void) | null = null;
  private levelTimer = 0;
  private lastSound = 0; // when the live mic last gave anything but exact silence
  private silent = false;
  private restartedForSilence = false;
  private reportedMic: MicState | null = null;
  private maintainTimer = 0;
  private statsTimer = 0;
  private hallTimer = 0;
  private micWasOpen = true;
  private lastContact = new Map<string, number>();
  private lastCounts = new Map<string, { lost: number; got: number }>();
  private speaking = new Set<string>();
  private loudUntil = new Map<string, number>();
  private muted = false;
  private pushToTalk = false;
  private talking = false;
  private volumes = new Map<string, number>();
  private watchingCtx = false;
  private absent = new Map<string, number>(); // peer -> bytes received when last checked, while off the room list

  constructor(
    private myId: string,
    private h: Handlers,
    private opts: { forceRelay?: boolean } = {},
  ) {
    mixer.onChange(() => {
      for (const id of this.peers.keys()) this.applyVolume(id);
    });
  }

  // Why there's no mic, for the fix-it card: you chose "Just listen", the browser blocked it, another app
  // has it, there's none, or this browser can't use one (e.g. an app's built-in browser).
  micProblem: MicProblemKind = null;

  async join(space: Space) {
    if (this.space === space) return;
    this.leave();
    this.space = space;
    this.policy = this.h.policyFor?.(space) ?? null;
    const room = space;
    const token = ++this.joinToken;
    this.h.onStatus({ state: 'joining' });
    this.restartedForSilence = false;

    this.ctx = audioContext();
    void this.ctx.resume();
    if (!this.watchingCtx) {
      // Sound unlocked (or locked again): move voices between the element and Web Audio.
      this.watchingCtx = true;
      this.ctx.addEventListener('statechange', () => {
        for (const id of this.peers.keys()) this.applyVolume(id);
      });
    }
    const cancelled = new Promise<void>((r) => (this.cancelJoin = r));
    const wantMic = await this.h.askMic(cancelled, space);
    if (token !== this.joinToken) return;
    const [stream] = await Promise.all([wantMic ? this.takeMic() : null, this.iceServers()]);
    if (!wantMic) this.micProblem = 'declined';
    else if (stream) this.micProblem = null;
    if (token !== this.joinToken) {
      this.park(stream);
      return; // left (or moved rooms) while we were waiting
    }
    this.useStream(stream);

    if (!supabase) return;
    // Back in the same room straight after leaving (e.g. "Try again" on the mic): finish closing the old
    // channel first, or Supabase hands that one back.
    for (const old of supabase.getChannels()) if (old.topic === `realtime:voice:${room}`) await supabase.removeChannel(old);
    if (token !== this.joinToken) {
      this.park(stream);
      return;
    }
    // Private: guest-list members only (and from Phase 6, only people the door lets in).
    const ch = supabase.channel(`voice:${room}`, { config: { private: !devTest, broadcast: { self: false }, presence: { key: this.myId } } });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      countMessage('received', 'signal');
      void this.onSignal(payload as Signal);
    });
    ch.on('broadcast', { event: 'walkie' }, ({ payload }) => {
      countMessage('received', 'walkie');
      this.h.onWalkie?.(payload as WalkieMsg);
    });
    ch.on('presence', { event: 'sync' }, () => {
      // Backup cleanup in case a "bye" was missed (closed tab). Someone can also drop off this list just
      // because their (or our) Supabase connection blipped while the call itself is fine, so a working
      // call is only ended once nothing has arrived over it for a couple of seconds.
      const here = new Set(Object.keys(ch.presenceState()));
      for (const [id, p] of this.peers) {
        if (here.has(id)) this.absent.delete(id);
        else if (p.pc.connectionState !== 'connected') this.closePeer(id);
        else if (!this.absent.has(id)) void this.watchAbsent(id, p);
      }
    });
    let joinedBefore = false;
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED' || token !== this.joinToken) return;
      void ch.track({ id: this.myId });
      if (joinedBefore) {
        // Supabase dropped and came back (this callback runs again on every rejoin). Voice itself runs
        // browser-to-browser, so keep working calls; just make sure everyone else can find us again.
        this.send({ kind: 'hello', from: this.myId, to: '*', rejoin: true });
        return;
      }
      joinedBefore = true;
      // The hallway and quiet rooms connect by distance (hallTick), not to everyone: no hello to all.
      if (this.policy) return;
      // Say hello now and once more shortly after, in case the first one raced someone else's join.
      this.send({ kind: 'hello', from: this.myId, to: '*' });
      setTimeout(() => token === this.joinToken && this.send({ kind: 'hello', from: this.myId, to: '*', retry: true }), 1500);
    });
    this.channel = ch;
    this.levelTimer = window.setInterval(() => this.checkLevels(), LEVEL_EVERY);
    this.maintainTimer = window.setInterval(() => this.maintain(), MAINTAIN_EVERY);
    this.statsTimer = window.setInterval(() => void this.callStats(), STATS_EVERY);
    if (this.policy) this.hallTimer = window.setInterval(() => this.hallTick(), HALL_EVERY);
    this.report();
    if (audioLocked()) this.h.onAudioLocked();
  }

  leave() {
    if (!this.space) return;
    this.joinToken++;
    this.cancelJoin?.();
    this.cancelJoin = null;
    if (this.channel) {
      this.send({ kind: 'bye', from: this.myId, to: '*' });
      const ch = this.channel;
      this.channel = null;
      // Give the "bye" a moment to go out before dropping the channel.
      setTimeout(() => void supabase?.removeChannel(ch), 300);
    }
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.localMeter?.disconnect();
    this.localMeter = null;
    this.park(this.stream);
    this.stream = null;
    clearInterval(this.levelTimer);
    clearInterval(this.maintainTimer);
    clearInterval(this.statsTimer);
    clearInterval(this.hallTimer);
    this.lastContact.clear();
    this.micWasOpen = true;
    this.lastCounts.clear();
    for (const id of this.speaking) this.h.onSpeaking(id, false);
    this.speaking.clear();
    this.loudUntil.clear();
    this.space = null;
    this.policy = null;
    this.h.onStatus({ state: 'off' });
  }

  get isSilent() {
    return this.silent;
  }

  get micState(): MicState {
    if (!this.stream) return 'off';
    if (this.muted || (this.pushToTalk && !this.talking)) return 'muted';
    return this.silent ? 'silent' : 'on';
  }

  private reportMic() {
    const s = this.micState;
    if (s === this.reportedMic) return;
    this.reportedMic = s;
    this.h.onMicState?.(s);
  }

  // Starts using a mic stream: meter, mute state, and a restart if the system takes the mic away (a phone
  // call, another app).
  private useStream(stream: MediaStream | null) {
    this.stream = stream;
    this.localMeter?.disconnect();
    this.localMeter = stream && this.ctx ? new Meter(this.ctx, stream) : null;
    this.lastSound = Date.now();
    this.silent = false;
    stream?.getAudioTracks().forEach((t) => (t.onended = () => this.stream === stream && void this.restartMic()));
    this.applyMute();
  }

  // Opens the mic again and swaps it into every call (no reconnect). Used after the mic stopped or went
  // silent, and by "Try again".
  async restartMic() {
    if (!this.space) return;
    if (!this.stream || [...this.peers.values()].some((p) => !p.sender)) {
      // Calls set up listening only can't take a mic without renegotiating: rejoin instead.
      const space = this.space;
      this.leave();
      return void this.join(space);
    }
    const next = await this.openMic();
    if (!next) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.useStream(null);
      this.report();
      return;
    }
    const track = next.getAudioTracks()[0];
    for (const p of this.peers.values()) {
      const sender = this.sendsTo(p.id) ? p.sender : null;
      await sender?.replaceTrack(track).catch(() => {});
    }
    const old = this.stream;
    this.useStream(next);
    old?.getTracks().forEach((t) => t.stop());
    this.report();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMute();
  }

  setPushToTalk(on: boolean) {
    this.pushToTalk = on;
    this.applyMute();
  }

  setTalking(on: boolean) {
    this.talking = on;
    this.applyMute();
  }

  // Per-person volume, 0..1, times the Master and Voices sliders. (iPhones ignore volume on audio
  // elements; elsewhere it works.)
  setVolume(id: string, v: number) {
    this.volumes.set(id, v);
    this.applyVolume(id);
  }

  private applyVolume(id: string) {
    const p = this.peers.get(id);
    const a = p?.audio;
    if (!p || !a || this.policy) return;
    const person = this.volumes.get(id) ?? this.h.volumeFor(id);
    // Through Web Audio once sound is unlocked (the sliders are the bus gains); until then the element plays.
    const web = !!p.room && this.ctx?.state === 'running';
    if (p.room) p.room.gain.gain.value = web ? Math.max(0, Math.min(1, person)) : 0;
    a.muted = web;
    if (!web) a.volume = mixer.voiceVolume(person);
  }

  // The live mic stream while we're in a room (Settings → Mic meters and tests it).
  get micStream() {
    return this.stream;
  }

  // Which speaker voices play on, where the browser lets us choose (setSinkId). '' = system default.
  static speakerChoice = typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';
  async listSpeakers() {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return all.filter((d) => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: d.label || `Speaker ${i + 1}` }));
  }
  setSpeaker(id: string) {
    saveSpeaker(id);
    for (const p of this.peers.values()) if (p.audio) void (p.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(id).catch(() => {});
    void (this.ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> } | null)?.setSinkId?.(id).catch(() => {});
  }

  hasPeer(id: string) {
    return this.peers.has(id);
  }

  // Microphones on this device. Names only appear once the mic has been allowed.
  async listMics() {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  // Switches microphone, live if we're in a room (no reconnect needed).
  async setMicDevice(id: string) {
    saveMicDevice(id);
    if (!this.stream) return;
    const next = await this.openMic();
    if (!next || !this.stream) {
      next?.getTracks().forEach((t) => t.stop());
      return;
    }
    const track = next.getAudioTracks()[0];
    for (const p of this.peers.values()) {
      const sender = this.sendsTo(p.id) ? p.sender : null;
      await sender?.replaceTrack(track);
    }
    const old = this.stream;
    this.useStream(next);
    old.getTracks().forEach((t) => t.stop());
  }

  get micLive() {
    return !!this.stream && !this.muted && (!this.pushToTalk || this.talking);
  }

  // Our mic is actually going out: live, and (in the hallway) someone near enough or we're on the walkie.
  private get sending() {
    return this.micLive && this.micOpen;
  }
  private get micOpen() {
    return !this.policy || this.policy.micOpen();
  }
  private sendsTo(id: string) {
    return !this.policy || this.policy.sendsTo(id);
  }

  private applyMute() {
    const live = this.sending;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = live));
    this.lastSound = Date.now(); // muting/unmuting restarts the silence check
    this.reportMic();
  }

  // The parked mic if it's still live, else a newly opened one.
  private async takeMic(): Promise<MediaStream | null> {
    const kept = this.parked;
    this.parked = null;
    clearTimeout(this.parkTimer);
    if (kept && kept.getAudioTracks().some((t) => t.readyState === 'live')) {
      kept.getAudioTracks().forEach((t) => (t.enabled = true));
      this.micProblem = null;
      return kept;
    }
    kept?.getTracks().forEach((t) => t.stop());
    return this.openMic();
  }

  // Switch the mic off and keep it a few minutes (stopped for good after that, or when the tab is closed).
  private park(stream: MediaStream | null) {
    if (!stream || stream === this.parked) return;
    if (this.parked) this.parked.getTracks().forEach((t) => t.stop());
    stream.getAudioTracks().forEach((t) => (t.enabled = false));
    this.parked = stream;
    clearTimeout(this.parkTimer);
    this.parkTimer = window.setTimeout(() => this.releaseMic(), KEEP_MIC_MS);
  }

  // Let go of a kept mic (the browser's mic light goes off).
  releaseMic() {
    clearTimeout(this.parkTimer);
    this.parked?.getTracks().forEach((t) => t.stop());
    this.parked = null;
  }

  private async openMic(): Promise<MediaStream | null> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micProblem = 'unsupported';
      return null;
    }
    try {
      const device = savedMicDevice();
      if (device) {
        // The mic you picked, or the default if it has been unplugged since.
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: { ...MIC, deviceId: { exact: device } }, video: false });
        } catch (e) {
          if (!(e instanceof DOMException) || !['OverconstrainedError', 'NotFoundError'].includes(e.name)) throw e;
        }
      }
      return await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
    } catch (e) {
      console.warn('Microphone unavailable — joining to listen only', e);
      const name = e instanceof DOMException ? e.name : '';
      this.micProblem =
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotReadableError' || name === 'AbortError' ? 'busy'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'none'
        : 'unsupported';
      return null;
    }
  }

  // Twilio TURN via /api/turn, cached until shortly before the credentials expire. STUN-only if that fails.
  private async iceServers() {
    if (this.ice && Date.now() < this.ice.expires) return this.ice;
    try {
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const res = await fetch('/api/turn', {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) throw new Error(`/api/turn ${res.status}`);
      const body = (await res.json()) as { iceServers: RTCIceServer[]; ttl: number };
      this.ice = { servers: [...STUN, ...body.iceServers], turn: true, expires: Date.now() + (body.ttl - 300) * 1000 };
    } catch (e) {
      console.warn('TURN unavailable, using STUN only', e);
      this.ice = { servers: STUN, turn: false, expires: Date.now() + 60_000 };
    }
    return this.ice;
  }

  private send(s: Signal) {
    if (this.channel?.state !== 'joined' || !supabase?.realtime.isConnected()) return; // e.g. tab closing
    countMessage('sent', 'signal');
    void this.channel.send({ type: 'broadcast', event: 'signal', payload: s });
  }

  private async onSignal(s: Signal) {
    if (s.from === this.myId || (s.to !== '*' && s.to !== this.myId) || !this.channel) return;

    if (s.kind === 'hello') {
      // Hallway: only people within range (the wider, already-connected edge, as positions differ a bit).
      if (this.policy && !this.wanted(s.from, true)) return;
      // A fresh hello from someone we think we're connected to means they've lost us (rejoined, or
      // dropped their side): start over. Retry hellos only fill gaps.
      const existing = this.peers.get(s.from);
      if (existing) {
        if (s.retry) return;
        if (s.rejoin && existing.pc.connectionState === 'connected') return; // their call to us still works
        this.closePeer(s.from);
      }
      await this.contact(s.from);
      return;
    }
    if (s.kind === 'bye') {
      this.closePeer(s.from);
      return;
    }

    let peer = this.peers.get(s.from);
    if (s.kind === 'offer') {
      // A new offer (first call, or a retry through TURN) replaces any older connection.
      if (peer) this.closePeer(s.from);
      peer = this.createPeer(s.from, s.session, s.relay, false);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp!) });
      this.send({ kind: 'answer', from: this.myId, to: s.from, session: s.session, relay: s.relay, sdp: peer.pc.localDescription!.sdp });
      this.flushIce(peer);
      return;
    }
    if (!peer || s.session !== peer.session) return; // stale message from an older attempt
    if (s.kind === 'answer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
      this.flushIce(peer);
    } else if (s.kind === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.candidate).catch(() => {});
      else peer.pendingIce.push(s.candidate);
    }
  }

  // Lower id calls; higher id asks to be called. Either way a connection follows.
  private async contact(id: string) {
    if (this.myId < id) await this.startPeer(id, this.opts.forceRelay ?? false);
    else this.send({ kind: 'hello', from: this.myId, to: id });
  }

  // Round trip and lost audio packets across our calls, for the connection bars (see netQuality.ts).
  private async callStats() {
    const rtts: number[] = [];
    let lost = 0;
    let got = 0;
    for (const p of this.peers.values()) {
      if (p.pc.connectionState !== 'connected') continue;
      const stats = await p.pc.getStats().catch(() => null);
      if (!stats) continue;
      let pl = 0;
      let pr = 0;
      stats.forEach((s) => {
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated && typeof s.currentRoundTripTime === 'number')
          rtts.push(s.currentRoundTripTime * 1000);
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          pl += s.packetsLost ?? 0;
          pr += s.packetsReceived ?? 0;
        }
      });
      const before = this.lastCounts.get(p.id);
      this.lastCounts.set(p.id, { lost: pl, got: pr });
      if (before) {
        lost += Math.max(0, pl - before.lost);
        got += Math.max(0, pr - before.got);
      }
    }
    if (!rtts.length) return;
    net.setCallStats(rtts.reduce((a, b) => a + b, 0) / rtts.length, lost + got > 0 ? lost / (lost + got) : 0);
  }

  // Safety net for lost messages: call anyone in the room we have no connection to, and restart
  // connections that never came up.
  private maintain() {
    if (!this.channel) return;
    const here = Object.keys(this.channel.presenceState()).filter((id) => id !== this.myId);
    for (const id of here) if (!this.peers.has(id) && this.wanted(id, false)) void this.contact(id);
    for (const p of [...this.peers.values()]) {
      if (!p.initiator || p.pc.connectionState === 'connected') continue;
      const dead = p.pc.connectionState === 'failed' || p.pc.connectionState === 'closed';
      if (dead || Date.now() - p.created > STUCK_AFTER) {
        this.closePeer(p.id);
        void this.startPeer(p.id, this.opts.forceRelay ?? false);
      }
    }
  }

  private wanted(id: string, connected: boolean) {
    return !this.policy || this.policy.wants(id, connected);
  }

  // Hallway: connect to the people the rules want (and drop the rest), gate our mic per person, open or
  // close the mic, and set how loud / which effect each person gets. All local: no messages unless a
  // connection starts or ends.
  private hallTick() {
    const hall = this.policy;
    if (!hall || !this.channel) return;
    const now = Date.now();
    const here = Object.keys(this.channel.presenceState()).filter((id) => id !== this.myId);
    for (const id of here) {
      if (this.peers.has(id) || !hall.wants(id, false)) continue;
      if (now - (this.lastContact.get(id) ?? 0) < RECONTACT_AFTER) continue;
      this.lastContact.set(id, now);
      // Both sides notice each other at about the same time: the lower id calls, the higher one asks to be
      // called with a "retry" hello, which never restarts a call that is already starting.
      if (this.myId < id) void this.startPeer(id, this.opts.forceRelay ?? false);
      else this.send({ kind: 'hello', from: this.myId, to: id, retry: true });
    }
    for (const p of [...this.peers.values()]) {
      if (!hall.wants(p.id, true)) {
        this.closePeer(p.id, true);
        continue;
      }
      this.gate(p);
      if (p.fx && this.ctx) {
        const r = hall.route(p.id);
        const vol = this.volumes.get(p.id) ?? this.h.volumeFor(p.id);
        const t = this.ctx.currentTime;
        p.fx.whisper.gain.setTargetAtTime(r.mode === 'whisper' ? r.gain * vol : 0, t, 0.06);
        p.fx.radio.gain.setTargetAtTime(r.mode === 'radio' ? r.gain * vol : 0, t, 0.03);
        p.fx.hiss.gain.setTargetAtTime(r.mode === 'radio' ? 0.032 * vol : 0, t, 0.03);
      }
    }
    const open = this.micOpen;
    if (open !== this.micWasOpen) {
      this.micWasOpen = open;
      this.applyMute();
    }
  }

  // Our mic to one person: on or off without renegotiating (replaceTrack).
  private gate(p: Peer) {
    if (!p.sender) return;
    const want = this.sendsTo(p.id) ? (this.stream?.getAudioTracks()[0] ?? null) : null;
    if (p.sender.track !== want) void p.sender.replaceTrack(want).catch(() => {});
  }

  // Hallway: whisper path (low-pass 2.5 kHz, quieter) and radio path (300-3000 Hz band, a little
  // distortion, a low hiss), mixed by hallTick. Out through the mixer's "Walkie & whisper" bus.
  private createFx(stream: MediaStream): Fx | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const out = mixer.bus('radio');
    const src = ctx.createMediaStreamSource(stream);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    const whisper = ctx.createGain();
    whisper.gain.value = 0;
    src.connect(lp).connect(whisper).connect(out);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp3 = ctx.createBiquadFilter();
    lp3.type = 'lowpass';
    lp3.frequency.value = 3000;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.4 * x) / Math.tanh(2.4);
    }
    shaper.curve = curve;
    const radio = ctx.createGain();
    radio.gain.value = 0;
    src.connect(hp).connect(lp3).connect(shaper).connect(radio).connect(out);
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    noise.connect(band).connect(hiss).connect(out);
    noise.start();
    return { src, whisper, radio, hiss, noise };
  }

  // Walkie-talkie messages to everyone in the hallway.
  sendWalkie(m: WalkieMsg) {
    if (this.space !== 'hallway' || this.channel?.state !== 'joined') return;
    countMessage('sent', 'walkie');
    void this.channel.send({ type: 'broadcast', event: 'walkie', payload: m });
  }

  // Someone left the room list but their call is up: keep it while data still arrives, end it when it stops.
  private async watchAbsent(id: string, peer: Peer) {
    this.absent.set(id, await bytesIn(peer.pc));
    const check = async () => {
      if (!this.absent.has(id) || this.peers.get(id) !== peer) return; // back on the list, or already gone
      const now = await bytesIn(peer.pc);
      if (now === this.absent.get(id)) this.closePeer(id);
      else {
        this.absent.set(id, now);
        setTimeout(() => void check(), ALIVE_CHECK);
      }
    };
    setTimeout(() => void check(), ALIVE_CHECK);
  }

  private flushIce(peer: Peer) {
    for (const c of peer.pendingIce) void peer.pc.addIceCandidate(c).catch(() => {});
    peer.pendingIce = [];
  }

  private async startPeer(id: string, relay: boolean) {
    const peer = this.createPeer(id, Date.now(), relay, true);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp!) });
    this.send({ kind: 'offer', from: this.myId, to: id, session: peer.session, relay, sdp: peer.pc.localDescription!.sdp });
  }

  private createPeer(id: string, session: number, relay: boolean, initiator: boolean): Peer {
    this.closePeer(id); // never leave an older connection to the same person running
    const pc = new RTCPeerConnection({ iceServers: this.ice?.servers ?? STUN, iceTransportPolicy: relay ? 'relay' : 'all' });
    const track = this.stream?.getAudioTracks()[0];
    const sender = track ? pc.addTrack(track, this.stream!) : null;
    if (!track) pc.addTransceiver('audio', { direction: 'recvonly' });

    const peer: Peer = { id, pc, sender, fx: null, room: null, session, relay, initiator, audio: null, meter: null, timer: 0, pendingIce: [], created: Date.now() };
    this.peers.set(id, peer);
    this.gate(peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ kind: 'ice', from: this.myId, to: id, session, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.setAttribute('playsinline', '');
        peer.audio.dataset.peer = id;
        document.body.appendChild(peer.audio);
      }
      peer.audio.srcObject = stream;
      if (this.policy) {
        // Heard through Web Audio effects instead; the muted element keeps the stream flowing (Chrome).
        peer.audio.muted = true;
        peer.fx?.src.disconnect();
        peer.fx?.noise.stop();
        peer.fx = this.createFx(stream);
      } else if (this.ctx) {
        peer.room?.src.disconnect();
        const src = this.ctx.createMediaStreamSource(stream);
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(gain).connect(mixer.bus('voices'));
        peer.room = { src, gain };
      }
      this.applyVolume(id);
      const speaker = savedSpeaker();
      if (speaker) void (peer.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(speaker).catch(() => {});
      void peer.audio.play().catch(() => this.h.onAudioLocked());
      peer.meter?.disconnect();
      if (this.ctx) peer.meter = new Meter(this.ctx, stream);
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') clearTimeout(peer.timer);
      if (state === 'failed' && this.peers.get(id) === peer) {
        if (initiator) void this.retry(peer);
        else this.closePeer(id, true);
      }
      if (state === 'disconnected') {
        // Usually the other side closed their tab. If it doesn't recover, drop it; maintain() reconnects
        // if they're actually still in the room.
        setTimeout(() => {
          if (this.peers.get(id) === peer && pc.connectionState !== 'connected') this.closePeer(id, true);
        }, DROP_AFTER);
      }
      this.report();
    };
    // If a direct connection hasn't worked within 10 s, try once more through TURN only.
    if (initiator && !relay) {
      peer.timer = window.setTimeout(() => {
        if (pc.connectionState !== 'connected' && this.peers.get(id) === peer) void this.retry(peer);
      }, CONNECT_TIMEOUT);
    }
    this.report();
    return peer;
  }

  private async retry(peer: Peer) {
    if (peer.relay || !this.ice?.turn) {
      this.closePeer(peer.id, true);
      return;
    }
    console.warn(`Voice: no direct route to ${peer.id}, retrying through TURN`);
    this.closePeer(peer.id);
    await this.startPeer(peer.id, true);
  }

  private closePeer(id: string, tellThem = false) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (tellThem) this.send({ kind: 'bye', from: this.myId, to: id });
    clearTimeout(peer.timer);
    peer.pc.ontrack = peer.pc.onicecandidate = peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.meter?.disconnect();
    if (peer.room) {
      peer.room.src.disconnect();
      peer.room.gain.disconnect();
    }
    if (peer.fx) {
      peer.fx.src.disconnect();
      peer.fx.noise.stop();
      peer.fx.whisper.disconnect();
      peer.fx.radio.disconnect();
      peer.fx.hiss.disconnect();
    }
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    this.peers.delete(id);
    this.absent.delete(id);
    if (this.speaking.delete(id)) this.h.onSpeaking(id, false);
    this.report();
  }

  private checkLevels() {
    const now = Date.now();
    const set = (id: string, loud: boolean) => {
      if (loud) this.loudUntil.set(id, now + SPEAKING_HOLD);
      const on = now < (this.loudUntil.get(id) ?? 0);
      if (on === this.speaking.has(id)) return;
      if (on) this.speaking.add(id);
      else this.speaking.delete(id);
      this.h.onSpeaking(id, on);
    };
    const mine = this.localMeter?.level() ?? 0;
    set(this.myId, this.sending && mine > SPEAKING_LEVEL);
    // A live mic that gives exact digital silence for a while isn't really working (real mics always
    // pick up a little noise). Try reopening it once; if it's still silent, say so.
    if (!this.sending || mine > 0) {
      this.lastSound = now;
      if (this.silent && mine > 0) this.silent = false;
    } else if (!this.silent && now - this.lastSound > SILENT_AFTER) {
      if (!this.restartedForSilence) {
        this.restartedForSilence = true;
        this.lastSound = now;
        void this.restartMic();
      } else {
        this.silent = true;
        this.report();
      }
    }
    if (this.silent && mine > 0) this.report();
    this.reportMic();
    for (const p of this.peers.values())
      set(p.id, p.pc.connectionState === 'connected' && (p.meter?.level() ?? 0) > SPEAKING_LEVEL);
  }

  private report() {
    if (!this.space) return;
    let connected = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') connected++;
    this.h.onStatus({
      state: 'in-room',
      space: this.space,
      connected,
      total: this.peers.size,
      mic: this.stream ? 'on' : 'blocked',
      turn: this.ice?.turn ?? false,
      problem: this.stream ? null : this.micProblem,
      silent: this.silent,
    });
  }

  // Used by automated checks.
  debug() {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      state: p.pc.connectionState,
      relay: p.relay,
      pc: p.pc,
      sending: !!p.sender?.track,
      hear: p.fx ? { whisper: p.fx.whisper.gain.value, radio: p.fx.radio.gain.value } : null,
    }));
  }

  // Used by automated checks: is our mic actually going out right now?
  get debugSending() {
    return this.sending;
  }
}
