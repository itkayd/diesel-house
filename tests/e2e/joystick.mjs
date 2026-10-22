import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => (localStorage.setItem('diesel-house.character', '17'), localStorage.setItem('diesel-house.name', 'Phone'), localStorage.setItem('diesel-house.mic-ok', '1')));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.player);
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const pos = () => page.evaluate(() => { const h = window.__house; return { x: Math.round(h.player.x), y: Math.round(h.player.y), zone: h.zone }; });
const res = []; const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const box = await page.evaluate(() => { const r = document.getElementById('joystick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
check('joystick shown on phone', box, box.w > 100);
// Touch elsewhere: should not move
let a = await pos(); await touch('touchStart', 300, 200); await page.waitForTimeout(1000); await touch('touchEnd'); let b = await pos();
check('touching the map does not move you', b, a.x === b.x && a.y === b.y);
// Drag joystick right (from an open part of the hall)
await page.evaluate(() => window.__house.body.reset(560, 520)); await page.waitForTimeout(300); a = await pos();
await touch('touchStart', box.x, box.y); await touch('touchMove', box.x + 25, box.y); await touch('touchMove', box.x + 50, box.y);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/joystick.png` });
b = await pos(); check('dragging right walks right', b, b.x > a.x + 40 && Math.abs(b.y - a.y) < 3);
await touch('touchEnd'); await page.waitForTimeout(150); const c = await pos(); await page.waitForTimeout(800); const d = await pos();
check('releasing stops you', d, c.x === d.x && c.y === d.y);
// Small push = slower
await touch('touchStart', box.x, box.y); await touch('touchMove', box.x - 15, box.y);
await page.waitForTimeout(1000); await touch('touchEnd'); const e = await pos();
check('small push walks slowly left', e, e.x < d.x && d.x - e.x < 50);
// Up through the door into the garden
await page.evaluate(() => window.__house.body.reset(656, 500));
await touch('touchStart', box.x, box.y); await touch('touchMove', box.x, box.y - 60); await page.waitForTimeout(3500); await touch('touchEnd');
const f = await pos(); check('joystick walks into the garden and walls still block', f, f.zone === 'garden' && f.y === 230); // stopped by the back hedge
// A lost "finger lifted" (iPhone Chrome): the joystick thinks an old finger still holds it, pushed right.
// A new touch on it must take over at once, and lifting that finger must stop you.
await page.evaluate(() => window.__house.body.reset(560, 520));
await page.evaluate(() => { const j = window.__house.joystick; j.pointerId = 999; j.vector.x = 1; j.vector.y = 0; });
await touch('touchStart', box.x, box.y); await touch('touchMove', box.x - 50, box.y);
await page.waitForTimeout(700);
const g0 = await pos(); await page.waitForTimeout(500); const g1 = await pos();
check('stuck from a lost touch: a new touch takes over (walks left, not right)', { g0, g1 }, g1.x < g0.x);
await touch('touchEnd'); await page.waitForTimeout(150); const g2 = await pos(); await page.waitForTimeout(600); const g3 = await pos();
check('…and lifting that finger stops you', { g2, g3 }, g2.x === g3.x && g2.y === g3.y);
// Stuck with no finger on the screen at all: it lets go by itself within a second.
await page.evaluate(() => { const j = window.__house.joystick; j.pointerId = 998; j.touchId = 5; j.vector.x = 1; j.vector.y = 0; j.startWatchdog(); });
await page.waitForTimeout(1300);
const freed = await page.evaluate(() => { const j = window.__house.joystick; return { active: j.active, v: { ...j.vector } }; });
check('stuck with no finger down: lets go by itself within a second', freed, !freed.active && freed.v.x === 0);
// Two fingers: one on the joystick, one tapping elsewhere (the mic). Lifting the other finger keeps you walking.
const cdp2 = cdp;
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1 }] });
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 50, y: box.y, id: 1 }] });
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 50, y: box.y, id: 1 }, { x: 300, y: 300, id: 2 }] });
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 300, y: 300, id: 2 }] }); // lifts finger 2
await page.waitForTimeout(300);
const two = await page.evaluate(() => ({ active: window.__house.joystick.active, x: window.__house.joystick.vector.x }));
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
const after2 = await page.evaluate(() => window.__house.joystick.active);
check('a second finger tapping elsewhere doesn’t stop the joystick; lifting both does', { two, after2 }, two.active && two.x > 0.5 && !after2);
// Walking into a room asks for the mic; if the finger went quiet meanwhile (iPhone permission sheet or
// audio switch), the joystick lets go.
const micCase = await page.evaluate(async () => {
  const j = window.__house.joystick;
  const hold = () => { j.pointerId = 997; j.touchId = 9; j.fingers = 1; j.vector.x = 1; j.lastEvent = Date.now() - 50; };
  // A quick, already-allowed mic (walking into a room): keep walking.
  hold();
  await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  const quick = j.active;
  // A slow one (a permission sheet you had to tap): the clock jumps a second while it's open.
  hold();
  const realNow = Date.now;
  const p = navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  Date.now = () => realNow() + 1000;
  await p;
  Date.now = realNow;
  const slow = { active: j.active, x: j.vector.x };
  j.release();
  return { quick, slow };
});
check('mic requests: a quick one keeps you walking; a slow one (permission sheet) that swallowed the touch lets go', micCase, micCase.quick && !micCase.slow.active && micCase.slow.x === 0);
// Movement switched off by mistake with nothing open: it comes back by itself.
await page.evaluate(() => { window.__house.starting = true; window.__house.canMove = false; });
await page.waitForTimeout(2500);
const healed = await page.evaluate(() => window.__house.canMove);
check('movement switched off with nothing open comes back by itself', { healed }, healed);
// Desktop: no joystick
const dp = await browser.newPage({ viewport: { width: 1366, height: 768 } }); await dp.addInitScript(() => (localStorage.setItem('diesel-house.character', '17'), localStorage.setItem('diesel-house.name', 'Phone')));
await dp.goto('http://localhost:5173/?test'); await dp.waitForFunction(() => window.__house?.player);
const n = await dp.evaluate(() => document.querySelectorAll('#joystick').length);
check('no joystick on desktop', n, n === 0);
console.log(res.join('\n')); console.log(errors.length ? 'ERRORS: ' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
