import { chromium } from 'playwright-core';
// UPDATE.md Phase 10: hallway voice. Whisper next to someone (muffled, fading out by ~4 tiles), the
// walkie-talkie (whole hallway, radio sound, one talker at a time), rooms never hear the hallway, and
// standing still costs no Realtime messages. Dev test mode (its own house), fake mics.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 650 }, permissions: ['microphone'] });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
    localStorage.setItem('diesel-house.mic-ok', '1');
  }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  await page.mouse.click(450, 120); // a tap: unlocks sound
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const at = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const link = (p, other) => p.page.evaluate((id) => window.__house.voice.debug().find((d) => d.id === id) ?? null, other.id);
const waitLink = (p, other, test, ms = 15000) =>
  p.page.waitForFunction(([id, src]) => { const d = window.__house.voice.debug().find((x) => x.id === id) ?? null; return new Function('d', `return ${src}`)(d); }, [other.id, test], { timeout: ms }).then(() => true, () => false);
const space = (p) => p.page.evaluate(() => window.__house.voice.space);

const A = await player('Alice hall');
const B = await player('Bob hall');
const C = await player('Cara room');
await C.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 15000 });

// 1. Next to each other in the hallway: whisper.
await at(A, 300, 270);
await at(B, 316, 270);
await at(C, 272, 120); // in room 2
await A.page.waitForFunction(() => window.__house.voice.space === 'hallway', null, { timeout: 8000 });
const near = await waitLink(B, A, "d && d.state === 'connected' && d.hear && d.hear.whisper > 0.2");
await B.page.waitForTimeout(1500); // the whisper volume eases in
const aToB = await link(A, B);
const bHears = await link(B, A);
// Furniture can nudge people, so compare with the real distance: half volume up to 24 px, easing out by 64.
const gap0 = await B.page.evaluate((id) => { const h = window.__house; const s = h.remotes.get(id).avatar.sprite; return Math.hypot(s.x - h.player.x, s.y - h.player.y); }, A.id);
const expect0 = gap0 <= 24 ? 0.5 : 0.25 * (1 + Math.cos((Math.PI * (gap0 - 24)) / 40));
const ui = await A.page.evaluate(() => ({ walkie: !document.getElementById('walkie-button').hidden, mic: getComputedStyle(document.getElementById('voice-controls')).display }));
check('next to each other in the hallway: connected, A whispers to B, B hears it muffled (about half volume)', { near, gap: Math.round(gap0), sending: aToB?.sending, hear: bHears?.hear, expect: expect0, ui },
  near && gap0 < 40 && aToB?.sending && Math.abs(bHears.hear.whisper - expect0) < 0.03 && bHears.hear.radio === 0 && ui.walkie && ui.mic === 'none');

// 2. Step away: fades, then nothing at ~4 tiles.
await at(B, 340, 270); // about 3 tiles (furniture can nudge people, so measure the real distance)
await B.page.waitForTimeout(800);
const mid = (await link(B, A))?.hear?.whisper ?? null;
const gap = await B.page.evaluate((id) => { const h = window.__house; const s = h.remotes.get(id).avatar.sprite; return Math.hypot(s.x - h.player.x, s.y - h.player.y); }, A.id);
// Expected: half volume up to 24 px, easing to nothing at 64 px (src/scenes/hallway.ts).
const expect = gap <= 24 ? 0.5 : gap >= 64 ? 0 : 0.25 * (1 + Math.cos((Math.PI * (gap - 24)) / 40));
await at(B, 372, 270); // 72 px: out of whisper range, still connected (drops past 128)
await B.page.waitForTimeout(800);
const far = await link(B, A);
const aSends = (await link(A, B))?.sending;
// Out of range, A sends B no audio at all (saves bandwidth and TURN).
const outBytes = () => A.page.evaluate(async (id) => {
  const d = window.__house.voice.debug().find((x) => x.id === id);
  let n = 0;
  if (d) (await d.pc.getStats()).forEach((s) => s.type === 'outbound-rtp' && s.kind === 'audio' && (n += s.bytesSent));
  return n;
}, B.id);
const o0 = await outBytes();
await A.page.waitForTimeout(1500);
const sentOut = (await outBytes()) - o0;
check('out of whisper range: A sends B no audio at all', { bytesOut1500ms: sentOut }, sentOut < 200);
check('stepping away: quieter at 3 tiles, silent past 4 tiles (and A sends B nothing)', { gap: Math.round(gap), mid, expect, far: far?.hear?.whisper, aSends }, gap > 30 && gap < 64 && Math.abs(mid - expect) < 0.03 && mid < 0.45 && far?.hear?.whisper < 0.01 && aSends === false);

// 3. Far apart: the walkie-talkie reaches the whole hallway.
await at(B, 650, 270);
const dropped = await waitLink(B, A, 'd === null', 8000);
await A.page.keyboard.down('t');
const radio = await waitLink(B, A, "d && d.state === 'connected' && d.hear && d.hear.radio > 0.9", 15000);
const bView = await B.page.evaluate(() => ({ strip: document.getElementById('walkie-strip').textContent, hidden: document.getElementById('walkie-strip').hidden, button: document.getElementById('walkie-button').dataset.state }));
const aView = await A.page.evaluate(() => ({ button: document.getElementById('walkie-button').dataset.state, label: document.querySelector('#walkie-button .lab').textContent }));
const aSendsWalkie = (await link(A, B))?.sending;
// Real audio arriving: B's received audio bytes from A grow while A is on air.
const audioIn = () => B.page.evaluate(async (id) => {
  const d = window.__house.voice.debug().find((x) => x.id === id);
  let n = 0;
  if (d) (await d.pc.getStats()).forEach((s) => s.type === 'inbound-rtp' && s.kind === 'audio' && (n += s.bytesReceived));
  return n;
}, A.id);
const b0 = await audioIn();
await B.page.waitForTimeout(1500);
const onAir = (await audioIn()) - b0;
check('on the walkie, real audio reaches B', { bytesIn1500ms: onAir }, onAir > 2000);
await A.page.keyboard.up('t');
const after = await waitLink(B, A, '!d || (d.hear && d.hear.radio < 0.05)', 5000);
check('far apart: holding T, B hears A on the radio at full volume; B sees "[radio] A" and Channel busy; letting go stops it',
  { dropped, radio, aSendsWalkie, bView, aView, after },
  dropped && radio && aSendsWalkie && !bView.hidden && bView.strip === 'Alice hall' && bView.button === 'busy' && aView.button === 'talking' && /^On air \d+s$/.test(aView.label) && after);

// 4. Rooms never hear the hallway.
const cSpace = await space(C);
const cLinks = await C.page.evaluate(() => window.__house.voice.debug().length);
const cStrip = await C.page.evaluate(() => document.getElementById('walkie-strip').hidden);
const aToC = await link(A, C);
check('someone in a room is not connected to the hallway and hears nothing from it', { cSpace, cLinks, cStripHidden: cStrip, aToC }, cSpace === 'room_02' && cLinks === 0 && cStrip && aToC === null);

// 5. Two people press at once: only one goes on air, the same on every screen.
await B.page.waitForTimeout(500);
await Promise.all([A.page.keyboard.down('t'), B.page.keyboard.down('t')]);
await A.page.waitForTimeout(1500);
const talkers = await Promise.all([A, B].map((p) => p.page.evaluate(() => ({ talker: window.__house.hallway.talkerId, button: document.getElementById('walkie-button').dataset.state }))));
await Promise.all([A.page.keyboard.up('t'), B.page.keyboard.up('t')]);
const one = talkers[0].talker && talkers[0].talker === talkers[1].talker;
const states = talkers.map((t) => t.button).sort();
check('two people press together: one is on air, the other sees Channel busy', { talkers, one }, one && states[0] === 'busy' && states[1] === 'talking');

// 6. Standing still costs no Realtime messages (whisper and walkie ride on positions already shared).
await at(B, 316, 270);
await waitLink(B, A, "d && d.state === 'connected'", 10000);
await B.page.waitForTimeout(3000);
const count = () => A.page.evaluate(() => Object.entries(window.__house.msgStats.totals).filter(([k]) => k.startsWith('sent:')).reduce((n, [, v]) => n + v, 0));
const before = await count();
await A.page.waitForTimeout(6000);
const sent = (await count()) - before;
check('standing still whispering for 6 s: no Realtime messages sent', { sent }, sent <= 1);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
