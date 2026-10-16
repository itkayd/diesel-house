import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function player(name, character, { mic = true, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 650 }, permissions: mic ? ['microphone'] : [] });
  await ctx.addInitScript(([n, c, mic]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
    localStorage.setItem('diesel-house.mic-ok', '1'); // seen the mic explainer before (tested in audio.mjs)
    if (!mic) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  }, [name, String(character), mic]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test' + query.replace('?', '&'));
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  const id = await page.evaluate(() => window.__house.presence.id);
  return { name, ctx, page, id };
}
const goto = (p, x, y) => p.page.evaluate(([x, y]) => window.__house.body.reset(x, y), [x, y]);
const ROOM1 = [96, 120], ROOM2 = [272, 120], HALL = [300, 256];

const peers = (p) =>
  p.page.evaluate(async () => {
    const out = [];
    for (const d of window.__house.voice.debug()) {
      const stats = await d.pc.getStats();
      let inbound = null, route = null, codec = null;
      stats.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio') inbound = s;
        if (s.type === 'transport' && s.selectedCandidatePairId) {
          const pair = stats.get(s.selectedCandidatePairId);
          route = (pair && stats.get(pair.localCandidateId))?.candidateType ?? null;
        }
      });
      if (inbound?.codecId) codec = stats.get(inbound.codecId)?.mimeType ?? null;
      out.push({ id: d.id.slice(0, 6), state: d.state, relay: d.relay, bytes: inbound?.bytesReceived ?? 0, level: +(inbound?.audioLevel ?? 0).toFixed(3), route, codec });
    }
    return out;
  });
// The fake mic beeps about once a second, so listen over a window and keep the loudest reading.
const loudest = async (p, ms = 2200) => {
  const max = [];
  const t = Date.now();
  while (Date.now() - t < ms) {
    (await peers(p)).forEach((x, i) => (max[i] = Math.max(max[i] ?? 0, x.level)));
    await p.page.waitForTimeout(80);
  }
  return max;
};
const glowSeen = async (p, fn, arg, ms = 2500) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await p.page.evaluate(fn, arg)) return true;
    await p.page.waitForTimeout(50);
  }
  return false;
};
// Levels are 0..1; the fake beep reads ~1, leftover buffer tails a few hundredths.
const SILENT = 0.05, HEARD = 0.1;
const audioEls = (p) => p.page.evaluate(() => document.querySelectorAll('audio[data-peer]').length);
const waitConnected = async (p, n, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await peers(p)).filter((x) => x.state === 'connected').length >= n) return Date.now() - t;
    await p.page.waitForTimeout(100);
  }
  return null;
};
const status = (p) => p.page.locator('#voice-controls').evaluate((e) => (e.style.display === 'none' ? '(hidden)' : document.getElementById('voice-status').textContent));

const A = await player('Alice test', 16);
const B = await player('Bob test', 19);
await A.page.waitForTimeout(1500);
check('in the hallway: no voice, controls hidden', { A: await status(A), peers: (await peers(A)).length }, (await status(A)) === '(hidden)' && (await peers(A)).length === 0);

// Both into room 1
await goto(A, ...ROOM1);
await goto(B, ...ROOM1);
const tc = await waitConnected(A, 1);
await waitConnected(B, 1);
check('A and B in room 1 connect', { ms: tc, A: await status(A), B: await status(B) }, tc !== null && (await status(A)).includes('1/1 connected'));
await A.page.waitForTimeout(2000);
let pa = await peers(A), pb = await peers(B);
check('audio flows both ways (Opus)', { A: pa, B: pb }, pa[0]?.bytes > 1000 && pb[0]?.bytes > 1000 && pa[0]?.codec === 'audio/opus');
const [aHears] = await loudest(A), [bHears] = await loudest(B);
check('they can hear each other (incoming level > 0)', { A_hears: aHears, B_hears: bHears }, aHears > HEARD && bHears > HEARD);
check('one audio element per peer', { A: await audioEls(A), B: await audioEls(B) }, (await audioEls(A)) === 1 && (await audioEls(B)) === 1);
const glow = {
  remoteA: await glowSeen(B, (aid) => window.__house.remotes.get(aid)?.avatar.speaking, A.id),
  me: await glowSeen(B, () => window.__house.me.speaking),
};
check('speaking glow: B sees A glowing, and B glows itself', glow, glow.remoteA && glow.me);
const mic = await A.page.evaluate(() => (window.__house.voice.stream?.getAudioTracks() ?? []).map((t) => t.getSettings()));
check('mic has echo cancellation, noise suppression, auto gain on', mic.map((m) => [m.echoCancellation, m.noiseSuppression, m.autoGainControl]), mic[0]?.echoCancellation === true && mic[0]?.noiseSuppression === true && mic[0]?.autoGainControl === true);
await B.page.screenshot({ path: `${out}/p4_room.png` });

// Mute
await A.page.click('#mic-button');
await A.page.waitForTimeout(500);
const [mutedLevel] = await loudest(B);
const glowMuted = await glowSeen(B, (aid) => window.__house.remotes.get(aid)?.avatar.speaking, A.id, 1500);
check('A mutes: B hears silence, A stops glowing', { B_hears: mutedLevel, glow: glowMuted, A_btn: await A.page.getAttribute('#mic-button', 'aria-label') }, mutedLevel < SILENT && !glowMuted);
await A.page.click('#mic-button');
const [unmuted] = await loudest(B);
check('A unmutes: B hears again', unmuted, unmuted > HEARD);

// Push to talk (the switch lives in settings)
await A.page.click('#settings-button');
await A.page.click('#settings-tab-mic');
await A.page.waitForSelector('#ptt-toggle');
await A.page.check('#ptt-toggle');
await A.page.waitForTimeout(500);
const [pttOff] = await loudest(B);
await A.page.keyboard.down('Space');
const [pttOn] = await loudest(B);
await A.page.keyboard.up('Space');
await A.page.waitForTimeout(800);
const [pttAfter] = await loudest(B, 1500);
const stillPtt = await A.page.isChecked('#ptt-toggle');
await A.page.uncheck('#ptt-toggle');
await A.page.click('#settings-close');
check('push to talk: silent until Space is held, silent again after', { notHolding: pttOff, holding: pttOn, released: pttAfter, boxStillTicked: stillPtt }, pttOff < SILENT && pttOn > HEARD && pttAfter < SILENT && stillPtt);

// B steps into the hallway: audio stops within a second on both sides
await goto(B, ...HALL);
const t0 = Date.now();
let bGone = null, aGone = null;
while (Date.now() - t0 < 3000 && (bGone === null || aGone === null)) {
  if (bGone === null && (await peers(B)).length === 0 && (await audioEls(B)) === 0) bGone = Date.now() - t0;
  if (aGone === null && (await peers(A)).length === 0 && (await audioEls(A)) === 0) aGone = Date.now() - t0;
  await A.page.waitForTimeout(20);
}
check('B walks out: audio stops within 1 s on both sides', { B_ms: bGone, A_ms: aGone, B_status: await status(B), A_status: await status(A) }, bGone !== null && aGone !== null && bGone < 1000 && aGone < 1000 && (await status(B)) === '(hidden)');

// Different rooms don't connect
await goto(B, ...ROOM2);
await B.page.waitForTimeout(4000);
check('B in room 2, A in room 1: no connection', { A: (await peers(A)).length, B: (await peers(B)).length }, (await peers(A)).length === 0 && (await peers(B)).length === 0);

// Three in room 1; C has no mic (listen only)
const C = await player('Cara test', 18, { mic: false });
await goto(B, ...ROOM1);
await goto(C, ...ROOM1);
await waitConnected(A, 2);
await waitConnected(B, 2);
await waitConnected(C, 2);
await A.page.waitForTimeout(2000);
const [x, y, z] = [await peers(A), await peers(B), await peers(C)];
check('3 in a room: everyone connected to both others', { A: x.map((p) => p.state), B: y.map((p) => p.state), C: z.map((p) => p.state) }, [x, y, z].every((l) => l.length === 2 && l.every((p) => p.state === 'connected')));
const cHears = await loudest(C);
check('C without mic: listens only, hears both, status says mic blocked', { C_hears: cHears, status: await status(C) }, cHears.length === 2 && cHears.every((l) => l > HEARD) && (await status(C)).includes('Mic blocked'));
await C.ctx.close();
await B.ctx.close();
const tClose = Date.now();
while (Date.now() - tClose < 10000 && (await peers(A)).length) await A.page.waitForTimeout(100);
check('others close their tabs abruptly: A tidies up within 10 s', { left: (await peers(A)).length, ms: Date.now() - tClose }, (await peers(A)).length === 0);
await A.ctx.close();

// TURN-only connection (forced relay) through Twilio
const R1 = await player('Relay one', 16, { query: '?relay' });
const R2 = await player('Relay two', 17, { query: '?relay' });
await goto(R1, ...ROOM2);
await goto(R2, ...ROOM2);
const tr = await waitConnected(R1, 1, 25000);
await R1.page.waitForTimeout(2500);
const pr = await peers(R1);
const [relayLevel] = await loudest(R1);
check('forced through Twilio TURN: connects and carries audio', { ms: tr, R1: pr, level: relayLevel }, tr !== null && pr[0]?.route === 'relay' && pr[0]?.bytes > 1000 && relayLevel > HEARD);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
