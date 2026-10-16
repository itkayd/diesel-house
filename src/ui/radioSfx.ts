import { audioContext } from '../net/audio';
import { mixer } from './mixer';

// Walkie-talkie sounds, made in code (UPDATE.md Phase 9: nothing to download), through the mixer's
// "radio" bus (Walkie & whisper slider): a squelch click plus a 120 ms burst of filtered static when you
// press or let go, and a two-beep buzz when the channel is busy.

function noise(ctx: AudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function ready() {
  const ctx = audioContext();
  return ctx.state === 'running' && mixer.levels.sfx ? ctx : null;
}

// `on`: pressing (higher click, static rises) or letting go (lower click, static falls).
export function squelch(on: boolean) {
  const ctx = ready();
  if (!ctx) return;
  const out = mixer.bus('radio');
  const t = ctx.currentTime;

  // Click: a very short square blip.
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(on ? 1800 : 1200, t);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.25, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.035);

  // Static: band-passed noise, 120 ms.
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, 0.14);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(on ? 1400 : 2600, t + 0.02);
  bp.frequency.linearRampToValueAtTime(on ? 2600 : 1400, t + 0.14);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t + 0.02);
  ng.gain.linearRampToValueAtTime(0.35, t + 0.04);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  src.connect(bp).connect(ng).connect(out);
  src.start(t + 0.02);
}

// "Channel busy": two low beeps.
export function busyBuzz() {
  const ctx = ready();
  if (!ctx) return;
  const out = mixer.bus('radio');
  const t = ctx.currentTime;
  for (const at of [0, 0.16]) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t + at);
    g.gain.setValueAtTime(0, t + at + 0.1);
    osc.connect(g).connect(out);
    osc.start(t + at);
    osc.stop(t + at + 0.11);
  }
}
