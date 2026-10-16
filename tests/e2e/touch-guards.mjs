import { chromium } from 'playwright-core';
// Phones: holding the joystick never highlights text or opens the long-press menu, it can't get stuck,
// and a second finger on another button doesn't take it over. Runs in dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['microphone'] });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.character', '17');
  localStorage.setItem('diesel-house.name', 'Thumbs');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
const cdp = await ctx.newCDPSession(page);
const touches = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const centre = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
const pos = () => page.evaluate(() => ({ x: Math.round(window.__house.player.x), y: Math.round(window.__house.player.y) }));
const selected = () => page.evaluate(() => document.getSelection()?.toString() ?? '');
const joyVector = () => page.evaluate(() => ({ ...window.__house.joystick?.vector }));

const joy = await centre('#joystick');
const where = await centre('#where-zone');

// Hold the joystick, drag the thumb off it and across the HUD text, keep holding.
const a = await pos();
await touches('touchStart', [{ x: joy.x, y: joy.y, id: 1 }]);
await touches('touchMove', [{ x: joy.x + 40, y: joy.y, id: 1 }]);
for (let i = 1; i <= 10; i++) await touches('touchMove', [{ x: joy.x + 40 + ((where.x - joy.x - 40) * i) / 10, y: joy.y + ((where.y - joy.y) * i) / 10, id: 1 }]);
await page.waitForTimeout(1500);
const b = await pos();
check('dragging off the joystick over text: nothing highlighted, still walking', { sel: await selected(), moved: b.x !== a.x || b.y !== a.y }, (await selected()) === '' && (b.x !== a.x || b.y !== a.y));

// Long-press on HUD text: no menu.
const menu = await page.evaluate(() => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.getElementById('where-zone').dispatchEvent(ev);
  const sel = new Event('selectstart', { bubbles: true, cancelable: true });
  document.getElementById('where-zone').dispatchEvent(sel);
  return { menuBlocked: ev.defaultPrevented, selectBlocked: sel.defaultPrevented };
});
check('long-press on the HUD: no Copy/Search menu, no selection', menu, menu.menuBlocked && menu.selectBlocked);

// Switch apps while holding: joystick lets go and the player stops.
await page.evaluate(() => dispatchEvent(new Event('blur')));
await page.waitForTimeout(200);
const c = await pos();
await page.waitForTimeout(800);
const d = await pos();
const v = await joyVector();
await touches('touchEnd', []);
check('switching apps while holding: joystick lets go, player stops', { v, still: c.x === d.x && c.y === d.y }, v.x === 0 && v.y === 0 && c.x === d.x && c.y === d.y);

// Two thumbs: joystick held, then another finger on the HUD; the joystick keeps its finger.
await touches('touchStart', [{ x: joy.x, y: joy.y, id: 1 }]);
await touches('touchMove', [{ x: joy.x + 40, y: joy.y, id: 1 }]);
const other = await centre('#settings-button');
await touches('touchStart', [{ x: joy.x + 40, y: joy.y, id: 1 }, { x: other.x, y: other.y, id: 2 }]);
await touches('touchMove', [{ x: joy.x + 40, y: joy.y, id: 1 }, { x: other.x - 30, y: other.y + 30, id: 2 }]);
await page.waitForTimeout(300);
const held = await joyVector();
await touches('touchEnd', []);
check('a second finger elsewhere does not take over the joystick', { held }, held.x > 0.9 && Math.abs(held.y) < 0.1);

// Text you should be able to copy still can be: chat messages and the chat box.
const allowed = await page.evaluate(() => {
  const p = document.createElement('div');
  p.id = 'msgs';
  const t = document.createElement('div');
  t.className = 'text';
  t.textContent = 'copy me';
  p.append(t);
  document.getElementById('overlay').append(p);
  const ev = new Event('selectstart', { bubbles: true, cancelable: true });
  t.dispatchEvent(ev);
  p.remove();
  return { chatSelectable: !ev.defaultPrevented };
});
check('chat messages can still be selected and copied', allowed, allowed.chatSelectable);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
