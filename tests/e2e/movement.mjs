import { chromium } from 'playwright-core';
// Message budget and smoothness of other players' movement (NEXT.md 3.1). Needs `npm run dev`.
// B watches with ?lag=200, which delays every incoming movement message by 150-250 ms.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});

async function player(name, character, { query = '', phone = false } = {}) {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1000, height: 700 } },
  );
  await ctx.addInitScript(([n, c]) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', c);
  }, [name, String(character)]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test' + query.replace('?', '&'));
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { ctx, page, id: await page.evaluate(() => window.__house.presence.id) };
}
const sentMoves = (p) => p.page.evaluate(() => window.__house.msgStats.totals['sent:move'] ?? 0);
// Teleport (test only) and tell everyone, as a real move would.
const tp = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const truePos = (p) => p.page.evaluate(() => ({ x: window.__house.player.x, y: window.__house.player.y }));
const hold = async (p, key, ms) => {
  await p.page.keyboard.down(key);
  await p.page.waitForTimeout(ms);
  await p.page.keyboard.up(key);
};

const A = await player('Mover', 16);
const B = await player('Watcher', 17, { query: '?lag=200' });
await B.page.waitForFunction((id) => window.__house.remotes.get(id)?.active, A.id, { timeout: 20000 });
const seen = () => B.page.evaluate((id) => {
  const s = window.__house.remotes.get(id).avatar.sprite;
  return { x: s.x, y: s.y, anim: s.anims.currentAnim?.key };
}, A.id);

// 1. Budget: a 10 s walk (east along the hallway; the wall stops it near the end).
await tp(A, 48, 270); // y=270 keeps clear of the hallway lamps' bases
await A.page.waitForTimeout(600);
let before = await sentMoves(A);
await hold(A, 'ArrowRight', 10_000);
await A.page.waitForTimeout(300);
const walkMsgs = (await sentMoves(A)) - before;
check('10 s walk sends at most 25 movement messages (was ~100 at 10/s)', { messages: walkMsgs, reduction: `${(100 / walkMsgs).toFixed(1)}x` }, walkMsgs <= 25 && 100 / walkMsgs >= 4);

// 2. Smoothness with 200 ms lag: sample B's view of A every frame-ish while A walks west.
await tp(A, 600, 270);
await B.page.waitForTimeout(1500);
const samples = [];
const errs = [];
await A.page.keyboard.down('ArrowLeft');
const t0 = Date.now();
while (Date.now() - t0 < 3000) {
  const [v, a] = await Promise.all([seen(), truePos(A)]);
  samples.push(v);
  if (Date.now() - t0 > 500) errs.push(Math.abs(v.x - a.x));
  await B.page.waitForTimeout(16);
}
await A.page.keyboard.up('ArrowLeft');
let jumps = 0;
let backwards = 0;
for (let i = 1; i < samples.length; i++) {
  const d = samples[i].x - samples[i - 1].x;
  if (Math.abs(d) > 8) jumps++;
  if (d >= 1) backwards++; // walking west, x should never increase by a visible (whole) pixel
}
const walking = samples.filter((s) => s.anim === 'char16-walk-left').length;
check('with 200 ms lag: smooth (no jumps > 8 px, never moves backwards)', { samples: samples.length, jumps, backwards }, jumps === 0 && backwards === 0);
check('with 200 ms lag: walk animation shows while walking', { walking, of: samples.length }, walking > samples.length * 0.8);
const maxErr = Math.max(...errs);
const avgErr = errs.reduce((a, b) => a + b, 0) / errs.length;
// B sees A ~one network delay in the past (no shared clock to know the one-way delay): steady, under the snap distance.
check('with 200 ms lag: B draws A steadily close behind where A really is', { avgPx: +avgErr.toFixed(1), maxPx: +maxErr.toFixed(1) }, maxErr < 24);
await B.page.waitForTimeout(1200);
let a = await truePos(A);
let v = await seen();
check('after stopping, B shows A exactly where A stopped, idle', { A: a, onB: v }, Math.abs(v.x - a.x) <= 1 && Math.abs(v.y - a.y) <= 1 && v.anim === 'char16-idle-left');

// 3. Walls: walking into the hallway wall (not at a door) stops on both screens at the same spot.
await tp(A, 140, 260);
await B.page.waitForTimeout(800);
await hold(A, 'ArrowUp', 1500);
await B.page.waitForTimeout(1200);
a = await truePos(A);
v = await seen();
check('walking into a wall: B shows A stopped at the wall, not inside it', { A: a, onB: v }, Math.abs(v.y - a.y) <= 1 && Math.abs(v.x - a.x) <= 1);

// 4. Turning corners keeps both screens in step.
await tp(A, 300, 240);
await B.page.waitForTimeout(800);
await hold(A, 'ArrowRight', 700);
await hold(A, 'ArrowDown', 500);
await hold(A, 'ArrowLeft', 600);
await B.page.waitForTimeout(1200);
a = await truePos(A);
v = await seen();
check('after turning corners, B ends at the same spot', { A: a, onB: v }, Math.abs(v.x - a.x) <= 1 && Math.abs(v.y - a.y) <= 1);

// 5. Joystick wobble on a phone: tiny thumb movements don't each send a message.
const P = await player('Thumb', 18, { phone: true });
const cdp = await P.ctx.newCDPSession(P.page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const box = await P.page.evaluate(() => {
  const r = document.getElementById('joystick').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await P.page.waitForTimeout(500);
before = await sentMoves(P);
await touch('touchStart', box.x, box.y);
for (let i = 0; i < 30; i++) {
  await touch('touchMove', box.x + 45 + (i % 3) * 2, box.y + ((i % 5) - 2) * 3); // right, wobbling a few px
  await P.page.waitForTimeout(100);
}
await touch('touchEnd');
await P.page.waitForTimeout(300);
const wobble = (await sentMoves(P)) - before;
check('3 s of wobbly joystick sends few messages (start, corrections, stop)', { messages: wobble }, wobble <= 10);

const stats = await A.page.evaluate(() => window.__house.msgStats.lastMinute);
res.push(`info  A's messages in the last minute: ${JSON.stringify(stats)}`);
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
