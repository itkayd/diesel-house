import { chromium } from 'playwright-core';
// Presence stays within Supabase's rate limit and recovers from a dropped channel. Needs `npm run dev` and
//   DH_TEST_OWNER="Name:password"   DH_TEST_VISITOR="Name:password"
// (Someone flipping between hallway and room in a doorway once got cut off: ClientPresenceRateLimitReached.)
const A_ = process.env.DH_TEST_OWNER?.split(':');
const B_ = process.env.DH_TEST_VISITOR?.split(':');
if (!A_ || !B_) {
  console.log('SKIP  presence-limits: set DH_TEST_OWNER and DH_TEST_VISITOR to run');
  process.exit(0);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
async function signIn([name, password]) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(() => localStorage.setItem('diesel-house.mic-ok', '1'));
  const page = await ctx.newPage();
  const tracks = { n: 0 };
  page.on('websocket', (ws) => ws.on('framesent', (f) => /"realtime:house","presence"/.test(String(f.payload)) && /"event":"track"/.test(String(f.payload)) && tracks.n++));
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await page.goto('http://localhost:5173/');
  await page.waitForSelector('#si-name');
  await page.fill('#si-name', name);
  await page.fill('#si-pass', password);
  await page.click('#signin .knock');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined', null, { timeout: 20000 });
  return { name, page, tracks, id: await page.evaluate(() => window.__house.presence.id) };
}
const A = await signIn(A_);
const B = await signIn(B_);
await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 15000 });

// 50 doorway flips in ~5 s.
await A.page.waitForTimeout(2500);
const before = A.tracks.n;
await A.page.evaluate(async () => {
  for (let i = 0; i < 50; i++) {
    window.__house.presence.update({ zone: i % 2 ? 'room_02' : 'hallway' });
    await new Promise((r) => setTimeout(r, 100));
  }
  window.__house.presence.update({ zone: 'hallway' });
});
await A.page.waitForTimeout(2500);
const sent = A.tracks.n - before;
const still = await A.page.evaluate(() => window.__house.presence.channel?.state);
check('50 doorway flips in 5 s send only a few presence updates, and the connection stays up', { sent, channel: still }, sent <= 5 && still === 'joined');

// Drop A's channel: it comes back by itself and B still sees A.
await A.page.evaluate(() => window.__house.presence.channel.unsubscribe());
await A.page.waitForFunction(() => /Offline|Connecting/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
const back = await A.page.waitForFunction(() => window.__house.presence.channel?.state === 'joined', null, { timeout: 20000 }).then(() => true, () => false);
await A.page.evaluate(() => window.__house.sendMove(true));
const seen = await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 10000 }).then(() => true, () => false);
const status = await A.page.evaluate(() => document.getElementById('status')?.textContent);
check('after the connection drops, it reconnects by itself and others still see you', { back, seen, status }, back && seen && /in the house/.test(status ?? ''));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
