// Builds public/assets/sfx/<name>.ogg + .mp3 from the raw packs in assets/raw/new-packs/ (unzipped there):
// mono, 22.05 kHz, ≤ 64 kbps, each file ≤ 40 KB, all new audio ≤ 600 KB (FIXES.md 7, UPDATE.md 9). Also lists every
// file in assets/manifest.json.
//   node scripts/build-sfx.mjs
// Decoding uses headless Edge (decodeAudioData); encoding uses wasm-media-encoders (dev dependency only).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createMp3Encoder, createOggEncoder } from 'wasm-media-encoders';

const RAW = 'assets/raw/new-packs';
const OUT = 'public/assets/sfx';
const RATE = 22050;
const JUHANI = 'The Essential Retro Video Game Sound Effects Collection [512 sounds]/The Essential Retro Video Game Sound Effects Collection [512 sounds] By Juhani Junkala';
const PACKS = {
  rpg: ['kenney_rpg-audio', 'Kenney · RPG Audio (CC0)'],
  ui: ['kenney_interface-sounds', 'Kenney · Interface Sounds (CC0)'],
  digital: ['kenney_digital-audio', 'Kenney · Digital Audio (CC0)'],
  jingles: ['kenney_music-jingles', 'Kenney · Music Jingles (CC0)'],
  juhani: [JUHANI, 'Juhani Junkala · The Essential Retro Video Game Sound Effects Collection (CC0)'],
  pack01: ['SoundPack01', 'SoundPack01 (CC0)'],
  casino: ['kenney_casino-audio', 'Kenney · Casino Audio (CC0)'],
};
const find = (pack, name) => {
  const root = path.join(RAW, PACKS[pack][0]);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const hit = walk(root).find((f) => path.basename(f) === name);
  if (!hit) throw new Error(`not found: ${pack}/${name}`);
  return hit;
};

// What the game plays (src/ui/sounds.ts names) → where it comes from. `max`: seconds kept.
const PICKS = [
  { name: 'knock', pack: 'rpg', file: 'bookPlace1.ogg', knock: true, max: 0.7 },
  { name: 'doorbell', pack: 'digital', file: 'twoTone1.ogg', max: 1.5 }, // ding-dong
  { name: 'door_open', pack: 'rpg', file: 'doorOpen_1.ogg', max: 1.2 },
  { name: 'join', pack: 'ui', file: 'maximize_003.ogg', max: 0.8 },
  { name: 'leave', pack: 'ui', file: 'minimize_003.ogg', max: 0.8 },
  { name: 'footstep', pack: 'rpg', file: 'footstep00.ogg', max: 0.4 },
  { name: 'footstep2', pack: 'rpg', file: 'footstep01.ogg', max: 0.4 },
  { name: 'click', pack: 'ui', file: 'click_002.ogg', max: 0.3 },
  { name: 'confirm', pack: 'ui', file: 'confirmation_002.ogg', max: 0.8 },
  { name: 'error', pack: 'juhani', file: 'sfx_sounds_error1.wav', max: 0.8 },
  { name: 'levelup', pack: 'juhani', file: 'sfx_sounds_fanfare1.wav', max: 3 },
  { name: 'win', pack: 'jingles', pick: 'rising', max: 3 },
  { name: 'lose', pack: 'jingles', pick: 'falling', max: 3 },
  { name: 'challenge', pack: 'pack01', file: 'Rise03.aif', max: 2 },
  { name: 'coin', pack: 'pack01', file: 'Coin01.aif', max: 1 },
  { name: 'powerup', pack: 'digital', file: 'powerUp3.ogg', max: 1.2 },
  { name: 'emote', pack: 'digital', file: 'pepSound1.ogg', max: 0.6 },
  // Games (UPDATE.md Phase 9): dice, cards, chips.
  { name: 'dice_shake', pack: 'casino', file: 'dice-shake-1.ogg', max: 1.2 },
  { name: 'dice_throw', pack: 'casino', file: 'dice-throw-1.ogg', max: 1.2 },
  { name: 'card_place', pack: 'casino', file: 'card-place-1.ogg', max: 0.6 },
  { name: 'card_flip', pack: 'casino', file: 'card-slide-1.ogg', max: 0.6 },
  { name: 'card_shuffle', pack: 'casino', file: 'card-shuffle.ogg', max: 1.6 },
  { name: 'chips', pack: 'casino', file: 'chips-collide-1.ogg', max: 0.8 },
];

// AIFF (big-endian PCM) → WAV, so the browser can decode it.
function aiffToWav(buf) {
  let channels = 0, bits = 0, rate = 0, data = null;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString('ascii', o, o + 4);
    const size = buf.readUInt32BE(o + 4);
    if (id === 'COMM') {
      channels = buf.readUInt16BE(o + 8);
      bits = buf.readUInt16BE(o + 14);
      const exp = buf.readUInt16BE(o + 16) & 0x7fff;
      const hi = buf.readUInt32BE(o + 18);
      rate = Math.round(hi * 2 ** (exp - 16383 - 31));
    } else if (id === 'SSND') {
      const offset = buf.readUInt32BE(o + 8);
      data = buf.subarray(o + 16 + offset, o + 8 + size);
    }
    o += 8 + size + (size % 2);
  }
  if (!data || bits % 8) throw new Error('unsupported AIFF');
  const bytes = bits / 8;
  const le = Buffer.alloc(data.length);
  for (let i = 0; i + bytes <= data.length; i += bytes) for (let b = 0; b < bytes; b++) le[i + b] = data[i + bytes - 1 - b];
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + le.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(channels, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * bytes, 28); head.writeUInt16LE(channels * bytes, 32); head.writeUInt16LE(bits, 34);
  head.write('data', 36); head.writeUInt32LE(le.length, 40);
  return Buffer.concat([head, le]);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
// Decode any file to mono Float32 at RATE.
async function decode(file) {
  let bytes = fs.readFileSync(file);
  if (/\.aiff?$/i.test(file)) bytes = aiffToWav(bytes);
  const b64 = await page.evaluate(async ([b64, rate]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bin.buffer);
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) buf.getChannelData(c).forEach((v, i) => (mono[i] += v / buf.numberOfChannels));
    let s = '';
    const u8 = new Uint8Array(mono.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, [bytes.toString('base64'), RATE]);
  const raw = Buffer.from(b64, 'base64');
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

// Trim silence, keep at most `max` s, normalise the peak, fade the end.
function tidy(x, max) {
  const loud = (v) => Math.abs(v) > 0.003;
  let a = x.findIndex(loud);
  let b = x.length - 1;
  while (b > a && !loud(x[b])) b--;
  if (a < 0) return new Float32Array(0);
  a = Math.max(0, a - 32);
  const y = x.slice(a, Math.min(b + 1, a + Math.round(max * RATE)));
  const peak = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fade = Math.min(y.length, Math.round(0.012 * RATE));
  for (let i = 0; i < y.length; i++) y[i] = (y[i] / peak) * 0.89 * (i >= y.length - fade ? (y.length - i) / fade : 1);
  // Very short sounds (a 10 ms click) encode badly: pad with silence to at least 60 ms.
  const min = Math.round(0.06 * RATE);
  if (y.length >= min) return y;
  const padded = new Float32Array(min);
  padded.set(y);
  return padded;
}

// Pitch direction of a melody: zero crossings per second, last third vs first third (> 1 = rises).
function trend(x) {
  const zc = (s, e) => { let n = 0; for (let i = s + 1; i < e; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++; return n / (e - s); };
  const t = Math.floor(x.length / 3);
  return zc(x.length - t, x.length) / Math.max(1e-6, zc(0, t));
}

const mp3 = await createMp3Encoder();
const ogg = await createOggEncoder();
function encode(enc, samples, params) {
  enc.configure({ channels: 1, sampleRate: RATE, ...params });
  return Buffer.concat([Buffer.from(enc.encode([samples])), Buffer.from(enc.finalize())]);
}

// The real bitrate of each format (short files look higher because Ogg carries a fixed header).
const SETTINGS = { mp3: { bitrate: 48 }, ogg: { vbrQuality: 1 } };
const probe = Float32Array.from({ length: 4 * RATE }, (_, i) => Math.sin(i * 0.07) * 0.5 + Math.sin(i * 0.31) * 0.3 + (Math.random() - 0.5) * 0.2);
for (const [ext, enc] of [['mp3', mp3], ['ogg', ogg]]) {
  const kbps = (encode(enc, probe, SETTINGS[ext]).length * 8) / 1000 / 4;
  console.log(`${ext}: ${kbps.toFixed(0)} kbps mono ${RATE} Hz`);
  if (kbps > 64) throw new Error(`${ext} settings give ${kbps.toFixed(0)} kbps (over 64)`);
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync('assets/manifest.json', 'utf8'));
manifest.sfx = {};
let total = 0;
const rows = [];
for (const p of PICKS) {
  let file = p.file && find(p.pack, p.file);
  let samples;
  if (p.pick) {
    // The NES-style jingles: the most rising one wins, the most falling one loses.
    const root = path.join(RAW, PACKS.jingles[0]);
    const all = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => /jingles_NES\d+\.ogg$/.test(f)).map((f) => path.join(root, f));
    const scored = [];
    for (const f of all) scored.push({ f, x: tidy(await decode(f), p.max) });
    // Real jingles only (over a second), not the short stings.
    scored.splice(0, scored.length, ...scored.filter((s) => s.x.length >= RATE));
    scored.sort((a, b) => trend(b.x) - trend(a.x));
    const chosen = p.pick === 'rising' ? scored[0] : scored[scored.length - 1];
    file = chosen.f;
    samples = chosen.x;
  } else {
    samples = tidy(await decode(file), p.max);
  }
  if (p.knock) {
    // "Knock knock": the thump twice, 0.16 s apart.
    const gap = Math.round(0.16 * RATE);
    const k = new Float32Array(samples.length + gap);
    for (let i = 0; i < samples.length; i++) {
      k[i] += samples[i];
      k[i + gap] += samples[i] * 0.85;
    }
    samples = tidy(k, p.max);
  }
  const outs = { mp3: encode(mp3, samples, SETTINGS.mp3), ogg: encode(ogg, samples, SETTINGS.ogg) };
  const secs = samples.length / RATE;
  for (const [ext, data] of Object.entries(outs)) {
    if (data.length > 40_000) throw new Error(`${p.name}.${ext} is ${data.length} bytes (over 40 KB)`);
    fs.writeFileSync(path.join(OUT, `${p.name}.${ext}`), data);
    total += data.length;
  }
  const from = path.relative(path.join(RAW, PACKS[p.pack][0]), file).replaceAll('\\', '/');
  manifest.sfx[p.name] = { files: [`public/assets/sfx/${p.name}.ogg`, `public/assets/sfx/${p.name}.mp3`], seconds: Number(secs.toFixed(2)), source: `${PACKS[p.pack][1]}: ${from}${p.knock ? ' (twice, knock knock)' : ''}` };
  rows.push(`${p.name.padEnd(10)} ${secs.toFixed(2)} s  ogg ${String(outs.ogg.length).padStart(6)}  mp3 ${String(outs.mp3.length).padStart(6)}  ← ${PACKS[p.pack][0].split('/')[0]}: ${from}`);
}
await browser.close();
if (total > 600_000) throw new Error(`total ${total} bytes (over 600 KB)`);
fs.writeFileSync('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(rows.join('\n'));
console.log(`total ${(total / 1024).toFixed(0)} KB`);
