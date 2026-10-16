import { chromium } from 'playwright-core';
// Everyone can see who's muted and how good each person's connection is: a mic icon on name tags in
// rooms (green on, red crossed muted/off) and connection bars (Poor / Strong / Super strong) on every tag
// and in your own HUD pill. Runs in dev test mode (its own house, separate from real players).
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
async function player(name, character) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 650 }, permissions: ['microphone'] });
  await ctx.addInitScript(([n, c]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
    localStorage.setItem('diesel-house.mic-ok', '1');
  }, [name, String(character)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const goto = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const seen = (viewer, id, key) => viewer.page.evaluate(([id, key]) => window.__house.remotes.get(id)?.avatar[key] ?? null, [id, key]);
const waitSeen = (viewer, id, key, want, ms = 15000) =>
  viewer.page.waitForFunction(([id, key, want]) => (window.__house.remotes.get(id)?.avatar[key] ?? null) === want, [id, key, want], { timeout: ms }).catch(() => {});

const A = await player('Alice ind', 16);
const B = await player('Bob ind', 18);
await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 15000 });

// 1. Connection rating: everyone gets one, and others see it on the tag; your own shows in the HUD.
await A.page.waitForFunction(() => !!document.querySelector('#net'), null, { timeout: 30000 }).catch(() => {});
const hud = await A.page.evaluate(() => ({ q: document.querySelector('#net')?.dataset.net ?? null, text: document.querySelector('#net')?.textContent ?? null }));
const aRating = await A.page.evaluate(() => window.__house.me.net);
await B.page.waitForFunction((id) => !!window.__house.remotes.get(id)?.avatar.net, A.id, { timeout: 30000 }).catch(() => {});
const bSeesA = await seen(B, A.id, 'net');
check('your connection shows in the HUD, and others see your bars on your tag', { hud, aRating, bSeesA }, !!hud.q && ['Poor', 'Strong', 'Super strong'].includes(hud.text) && bSeesA === aRating);

// 2. Mic icon in a room: green when on, red when muted, gone in the hallway.
await goto(A, 272, 120);
await goto(B, 272, 120);
await B.page.waitForFunction((id) => window.__house.voice.debug().some((d) => d.id === id && d.state === 'connected'), A.id, { timeout: 20000 });
await waitSeen(B, A.id, 'mic', 'on');
const on = await seen(B, A.id, 'mic');
await A.page.click('#mic-button');
await waitSeen(B, A.id, 'mic', 'off');
const muted = await seen(B, A.id, 'mic');
const ownMuted = await A.page.evaluate(() => window.__house.me.mic);
await A.page.click('#mic-button');
await waitSeen(B, A.id, 'mic', 'on');
const back = await seen(B, A.id, 'mic');
check('in a room everyone sees your mic: on, muted (red), on again', { on, muted, ownMuted, back }, on === 'on' && muted === 'off' && ownMuted === 'off' && back === 'on');
await goto(A, 300, 256);
await waitSeen(B, A.id, 'mic', null);
check('in the hallway the mic icon is hidden (no voice there)', { mic: await seen(B, A.id, 'mic') }, (await seen(B, A.id, 'mic')) === null);

// 3. A bad line (high delay and lost audio) shows as Poor for everyone.
await A.page.evaluate(async () => (await import('/src/net/netQuality.ts')).net.setCallStats(900, 0.2));
await waitSeen(B, A.id, 'net', 'poor');
const poor = { b: await seen(B, A.id, 'net'), hud: await A.page.evaluate(() => document.querySelector('#net')?.textContent) };
check('a bad connection shows as Poor (1 red bar) on everyone\'s screen', poor, poor.b === 'poor' && poor.hud === 'Poor');

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
