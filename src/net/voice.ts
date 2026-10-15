import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomId } from '../config';
import { audioContext, audioLocked } from './audio';
import { savedMicDevice, saveMicDevice } from '../prefs';
import { devGuest } from './mode';
import { countMessage } from './stats';
import { supabase } from './supabase';

// Per-room voice: a full mesh of peer-to-peer WebRTC connections (max 8 people), signalled over a
// Supabase Realtime channel per room. ICE: Google STUN + Twilio TURN from /api/turn.

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CONNECT_TIMEOUT = 10_000; // ms before retrying a peer through TURN only
const STUCK_AFTER = 20_000; // ms before a connection that never came up is started again
const MAINTAIN_EVERY = 3_000; // ms between checks that we're connected to everyone in the room
const ALIVE_CHECK = 2_500; // ms between "is anything still arriving?" checks on someone who left the room list
const DROP_AFTER = 4_000; // ms a connection may stay 'disconnected' before we drop it (other side closed the tab)
const SPEAKING_LEVEL = 0.02; // RMS above which someone counts as speaking
const LEVEL_EVERY = 60; // ms between speaking checks
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

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  session: number;
  relay: boolean;
  initiator: boolean;
  audio: HTMLAudioElement | null;
  meter: Meter | null;
  timer: number;
  pendingIce: RTCIceCandidateInit[];
  created: number;
};

export type VoiceStatus =
  | { state: 'off' }
  | { state: 'joining' }
  | { state: 'in-room'; connected: number; total: number; mic: 'on' | 'blocked'; turn: boolean };

type Handlers = {
  onSpeaking: (id: string, speaking: boolean) => void;
  onStatus: (s: VoiceStatus) => void;
  // The browser is holding sound back until the player taps (iPhone): ask for a tap.
  onAudioLocked: () => void;
  // Explain the mic before the browser asks. Resolves false to join listening only.
  askMic: (cancelled: Promise<void>) => Promise<boolean>;
  // How loud this person should be for us (0..1), when their audio starts.
  volumeFor: (id: string) => number;
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
  room: RoomId | null = null;
  private channel: RealtimeChannel | null = null;
  private peers = new Map<string, Peer>();
  private stream: MediaStream | null = null;
  private localMeter: Meter | null = null;
  private ctx: AudioContext | null = null;
  private ice: { servers: RTCIceServer[]; turn: boolean; expires: number } | null = null;
  private joinToken = 0;
  private cancelJoin: (() => void) | null = null;
  private levelTimer = 0;
  private maintainTimer = 0;
  private speaking = new Set<string>();
  private loudUntil = new Map<string, number>();
  private muted = false;
  private pushToTalk = false;
  private talking = false;
  private volumes = new Map<string, number>();
  private absent = new Map<string, number>(); // peer -> bytes received when last checked, while off the room list

  constructor(
    private myId: string,
    private h: Handlers,
    private opts: { forceRelay?: boolean } = {},
  ) {}

  async join(room: RoomId) {
    if (this.room === room) return;
    this.leave();
    this.room = room;
    const token = ++this.joinToken;
    this.h.onStatus({ state: 'joining' });

    this.ctx = audioContext();
    void this.ctx.resume();
    const cancelled = new Promise<void>((r) => (this.cancelJoin = r));
    const wantMic = await this.h.askMic(cancelled);
    if (token !== this.joinToken) return;
    const [stream] = await Promise.all([wantMic ? this.openMic() : null, this.iceServers()]);
    if (token !== this.joinToken) {
      stream?.getTracks().forEach((t) => t.stop());
      return; // left (or moved rooms) while we were waiting
    }
    this.stream = stream;
    if (stream) this.localMeter = new Meter(this.ctx, stream);
    this.applyMute();

    if (!supabase) return;
    // Private: guest-list members only (and from Phase 6, only people the door lets in).
    const ch = supabase.channel(`voice:${room}`, { config: { private: !devGuest, broadcast: { self: false }, presence: { key: this.myId } } });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      countMessage('received', 'signal');
      void this.onSignal(payload as Signal);
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
      // Say hello now and once more shortly after, in case the first one raced someone else's join.
      this.send({ kind: 'hello', from: this.myId, to: '*' });
      setTimeout(() => token === this.joinToken && this.send({ kind: 'hello', from: this.myId, to: '*', retry: true }), 1500);
    });
    this.channel = ch;
    this.levelTimer = window.setInterval(() => this.checkLevels(), LEVEL_EVERY);
    this.maintainTimer = window.setInterval(() => this.maintain(), MAINTAIN_EVERY);
    this.report();
    if (audioLocked()) this.h.onAudioLocked();
  }

  leave() {
    if (!this.room) return;
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
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    clearInterval(this.levelTimer);
    clearInterval(this.maintainTimer);
    for (const id of this.speaking) this.h.onSpeaking(id, false);
    this.speaking.clear();
    this.loudUntil.clear();
    this.room = null;
    this.h.onStatus({ state: 'off' });
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

  // Per-person volume, 0..1. (iPhones ignore volume on audio elements; elsewhere it works.)
  setVolume(id: string, v: number) {
    this.volumes.set(id, v);
    const a = this.peers.get(id)?.audio;
    if (a) a.volume = v;
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
      const sender = p.pc.getSenders().find((x) => x.track?.kind === 'audio');
      await sender?.replaceTrack(track);
    }
    this.stream.getTracks().forEach((t) => t.stop());
    this.localMeter?.disconnect();
    this.stream = next;
    if (this.ctx) this.localMeter = new Meter(this.ctx, next);
    this.applyMute();
  }

  get micLive() {
    return !!this.stream && !this.muted && (!this.pushToTalk || this.talking);
  }

  private applyMute() {
    const live = this.micLive;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = live));
  }

  private async openMic(): Promise<MediaStream | null> {
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

  // Safety net for lost messages: call anyone in the room we have no connection to, and restart
  // connections that never came up.
  private maintain() {
    if (!this.channel) return;
    const here = Object.keys(this.channel.presenceState()).filter((id) => id !== this.myId);
    for (const id of here) if (!this.peers.has(id)) void this.contact(id);
    for (const p of [...this.peers.values()]) {
      if (!p.initiator || p.pc.connectionState === 'connected') continue;
      const dead = p.pc.connectionState === 'failed' || p.pc.connectionState === 'closed';
      if (dead || Date.now() - p.created > STUCK_AFTER) {
        this.closePeer(p.id);
        void this.startPeer(p.id, this.opts.forceRelay ?? false);
      }
    }
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
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    const peer: Peer = { id, pc, session, relay, initiator, audio: null, meter: null, timer: 0, pendingIce: [], created: Date.now() };
    this.peers.set(id, peer);

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
      peer.audio.volume = this.volumes.get(id) ?? this.h.volumeFor(id);
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
    set(this.myId, this.micLive && (this.localMeter?.level() ?? 0) > SPEAKING_LEVEL);
    for (const p of this.peers.values())
      set(p.id, p.pc.connectionState === 'connected' && (p.meter?.level() ?? 0) > SPEAKING_LEVEL);
  }

  private report() {
    if (!this.room) return;
    let connected = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') connected++;
    this.h.onStatus({
      state: 'in-room',
      connected,
      total: this.peers.size,
      mic: this.stream ? 'on' : 'blocked',
      turn: this.ice?.turn ?? false,
    });
  }

  // Used by automated checks.
  debug() {
    return [...this.peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, relay: p.relay, pc: p.pc }));
  }
}
