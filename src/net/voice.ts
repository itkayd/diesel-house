import type { RealtimeChannel } from '@supabase/supabase-js';
import type { RoomId } from '../config';
import { supabase } from './supabase';

// Per-room voice: a full mesh of peer-to-peer WebRTC connections (max 8 people), signalled over a
// Supabase Realtime channel per room. ICE: Google STUN + Twilio TURN from /api/turn.

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CONNECT_TIMEOUT = 10_000; // ms before retrying a peer through TURN only
const STUCK_AFTER = 20_000; // ms before a connection that never came up is started again
const MAINTAIN_EVERY = 3_000; // ms between checks that we're connected to everyone in the room
const DROP_AFTER = 4_000; // ms a connection may stay 'disconnected' before we drop it (other side closed the tab)
const SPEAKING_LEVEL = 0.02; // RMS above which someone counts as speaking
const LEVEL_EVERY = 60; // ms between speaking checks
const SPEAKING_HOLD = 350; // ms the glow stays on after the last loud moment, so it doesn't flicker
const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

type Signal =
  | { kind: 'hello'; from: string; to: string; retry?: boolean }
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
};

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
  private levelTimer = 0;
  private maintainTimer = 0;
  private speaking = new Set<string>();
  private loudUntil = new Map<string, number>();
  private muted = false;
  private pushToTalk = false;
  private talking = false;

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

    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    const [stream] = await Promise.all([this.openMic(), this.iceServers()]);
    if (token !== this.joinToken) {
      stream?.getTracks().forEach((t) => t.stop());
      return; // left (or moved rooms) while we were waiting
    }
    this.stream = stream;
    if (stream) this.localMeter = new Meter(this.ctx, stream);
    this.applyMute();

    if (!supabase) return;
    const ch = supabase.channel(`voice:${room}`, { config: { broadcast: { self: false }, presence: { key: this.myId } } });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload as Signal));
    ch.on('presence', { event: 'sync' }, () => {
      // Backup cleanup in case a "bye" was missed (closed tab, lost connection).
      const here = new Set(Object.keys(ch.presenceState()));
      for (const id of this.peers.keys()) if (!here.has(id)) this.closePeer(id);
    });
    ch.subscribe((status) => {
      if (status !== 'SUBSCRIBED' || token !== this.joinToken) return;
      void ch.track({ id: this.myId });
      // Say hello now and once more shortly after, in case the first one raced someone else's join.
      this.send({ kind: 'hello', from: this.myId, to: '*' });
      setTimeout(() => token === this.joinToken && this.send({ kind: 'hello', from: this.myId, to: '*', retry: true }), 1500);
    });
    this.channel = ch;
    this.levelTimer = window.setInterval(() => this.checkLevels(), LEVEL_EVERY);
    this.maintainTimer = window.setInterval(() => this.maintain(), MAINTAIN_EVERY);
    this.report();
  }

  leave() {
    if (!this.room) return;
    this.joinToken++;
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

  get micLive() {
    return !!this.stream && !this.muted && (!this.pushToTalk || this.talking);
  }

  private applyMute() {
    const live = this.micLive;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = live));
  }

  private async openMic(): Promise<MediaStream | null> {
    try {
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
    void this.channel.send({ type: 'broadcast', event: 'signal', payload: s });
  }

  private async onSignal(s: Signal) {
    if (s.from === this.myId || (s.to !== '*' && s.to !== this.myId) || !this.channel) return;

    if (s.kind === 'hello') {
      // A fresh hello from someone we think we're connected to means they've lost us (rejoined, or
      // dropped their side): start over. Retry hellos only fill gaps.
      if (this.peers.has(s.from)) {
        if (s.retry) return;
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
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
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

  private flushIce(peer: Peer) {
    for (const c of peer.pendingIce) void peer.pc.addIceCandidate(c).catch(() => {});
    peer.pendingIce = [];
  }

  private async startPeer(id: string, relay: boolean) {
    const peer = this.createPeer(id, Date.now(), relay, true);
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
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
      void peer.audio.play().catch(() => {});
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
