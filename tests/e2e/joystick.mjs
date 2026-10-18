import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Needs the dev server running (npm run dev). Screenshots go to tests/e2e/output.
const out = fileURLToPath(new URL('./output', import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
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
b = await pos(); check('dragging right walks right', b, b.x > a.x + 60 && Math.abs(b.y - a.y) < 3);
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
// Desktop: no joystick
const dp = await browser.newPage({ viewport: { width: 1366, height: 768 } }); await dp.addInitScript(() => (localStorage.setItem('diesel-house.character', '17'), localStorage.setItem('diesel-house.name', 'Phone')));
await dp.goto('http://localhost:5173/?test'); await dp.waitForFunction(() => window.__house?.player);
const n = await dp.evaluate(() => document.querySelectorAll('#joystick').length);
check('no joystick on desktop', n, n === 0);
console.log(res.join('\n')); console.log(errors.length ? 'ERRORS: ' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
