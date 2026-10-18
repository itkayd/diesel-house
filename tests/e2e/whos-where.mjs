import { chromium } from 'playwright-core';
// "Who's where" (design/game/v2.html): the map button opens a map of the house; tapping a room walks you
// there by yourself, around walls and furniture, on a phone; any move of your own stops it. Runs in dev
// test mode (and without Supabase too). Set DH_CHROMIUM to use a Chromium instead of Edge.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['microphone'] });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Walker');
  localStorage.setItem('diesel-house.character', '3');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && !document.getElementById('picker'), null, { timeout: 20000 });
const pos = () => page.evaluate(() => ({ x: Math.round(window.__house.player.x), y: Math.round(window.__house.player.y), zone: window.__house.zone, walking: !!window.__house.autoPath }));
const clearCards = () => page.evaluate(() => document.querySelectorAll('.dh-scrim:not(#whos-where)').forEach((s) => s.remove()));

await page.tap('#map-button');
const map = await page.evaluate(() => ({ rooms: document.querySelectorAll('#whos-where-map [data-go]').length, me: !!document.querySelector('#whos-where-map .dot.me') }));
check('the map button opens Who’s where: 7 rooms to tap and you on the map', map, map.rooms === 7 && map.me);

// Every room, so every door is walked through (the diagonal ones too). Headless runs at about 20 fps,
// so walking takes a while.
for (const room of ['library', 'disco', 'gaming', 'cafe', 'lounge', 'rooftop', 'garden']) {
  await clearCards();
  if (!(await page.locator('#whos-where').count())) await page.tap('#map-button');
  await page.tap(`#whos-where-map [data-go="${room}"]`);
  let p;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(400);
    await clearCards();
    p = await pos();
    if (p.zone === room && !p.walking) break;
  }
  check(`tap ${room} on the map: you walk into it by yourself`, p, p.zone === room && !p.walking);
}

await page.tap('#map-button');
await page.tap('#whos-where-map [data-go="cafe"]');
await page.waitForTimeout(500);
const walking = (await pos()).walking;
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(200);
await page.keyboard.up('ArrowUp');
const after = (await pos()).walking;
check('moving yourself stops walking by itself', { walking, after }, walking && !after);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
