import { chromium } from 'playwright-core';
// The camera zoom stays put on phones: whole numbers only, unchanged when the address bar slides or the
// keyboard opens, re-fitted when the phone turns. Runs in dev test mode.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Zoom test');
  localStorage.setItem('diesel-house.character', '16');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
const zoom = () => page.evaluate(() => window.__house.cameraZoom);
const settle = () => page.waitForTimeout(500);

const start = await zoom();
check('zoom is a whole number between 2 and 4', { start }, Number.isInteger(start) && start >= 2 && start <= 4);

// Address bar sliding in and out: a ~10% height change, many times.
const seen = new Set([start]);
for (const h of [780, 844, 760, 844, 800]) {
  await page.setViewportSize({ width: 390, height: h });
  await settle();
  seen.add(await zoom());
}
check('address bar in/out: zoom never changes', { seen: [...seen] }, seen.size === 1);

// Chat keyboard: walk into a room, focus the chat box, the visible area halves.
await page.evaluate(() => { window.__house.body.reset(272, 120); window.__house.sendMove(true); });
await page.waitForSelector('#chat-button:not([hidden])', { timeout: 8000 });
await page.click('#chat-button');
await page.focus('#chat-input');
await page.setViewportSize({ width: 390, height: 430 });
await settle();
const typing = await zoom();
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#chat-close');
await settle();
const after = await zoom();
check('keyboard open for chat: zoom never changes', { typing, after, start }, typing === start && after === start);

// Turning the phone: re-fits to a whole number and keeps the player in view.
await page.setViewportSize({ width: 844, height: 390 });
await page.evaluate(() => dispatchEvent(new Event('orientationchange')));
await page.waitForTimeout(800);
const turned = await page.evaluate(() => {
  const h = window.__house;
  const v = h.cameras.main.worldView;
  return { zoom: h.cameraZoom, inView: v.contains(h.player.x, h.player.y) };
});
check('phone turned: re-fitted to a whole number, player still on screen', turned, Number.isInteger(turned.zoom) && turned.inView);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
