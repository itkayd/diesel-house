import { chromium } from 'playwright-core';
// REDESIGN.md R3, the octagon house, in dev test mode (no Supabase needed): the 8 areas, the Disco's dance
// floor (you sway on it), the Library's quiet voice and shared study timer, the Café's special of the day,
// the outdoor sky, and Settings → Old rooms. (Walking into every room through its door: whos-where.mjs.)
// Set DH_CHROMIUM to use a Chromium instead of Edge.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Housey');
  localStorage.setItem('diesel-house.character', '4');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && !document.getElementById('picker'), null, { timeout: 30000 });
const tp = (x, y) => page.evaluate(([x, y]) => { const h = window.__house; h.player.setPosition(x, y); h.body.reset(x, y); }, [x, y]);
const waitZone = (z) => page.waitForFunction((z) => window.__house.zone === z, z, { timeout: 8000 }).catch(() => {});

await page.waitForFunction(() => window.__house.quietRooms.size > 0, null, { timeout: 15000 }).catch(() => {}); // set up once connected
const house = await page.evaluate(() => {
  const h = window.__house;
  return { zones: h.zones.ids, spawn: h.zones.at(h.spawnAt.x, h.spawnAt.y - 3), floors: h.danceFloors.length, quiet: [...h.quietRooms.keys()], sky: h.skyLight };
});
check('the hall and 7 rooms, you start on the porch (hall), one dance floor, the Library is quiet, the sky is set', house,
  house.zones.join(',') === 'hallway,garden,library,disco,gaming,cafe,lounge,rooftop' && house.spawn === 'hallway' && house.floors === 1 && house.quiet.join() === 'library' && !!house.sky);

// Disco: sway on the dance floor, stop off it.
const floor = await page.evaluate(() => window.__house.danceFloors[0]);
await tp(floor.x + floor.w / 2, floor.y + floor.h / 2);
await waitZone('disco');
await page.waitForTimeout(500);
const on = await page.evaluate(() => ({ zone: window.__house.zone, dancing: window.__house.me.dancing }));
await tp(floor.x - 40, floor.y + floor.h + 30);
await page.waitForTimeout(500);
const off = await page.evaluate(() => ({ zone: window.__house.zone, dancing: window.__house.me.dancing, angle: window.__house.player.angle }));
check('on the Disco floor you dance; off it you stop', { on, off }, on.zone === 'disco' && on.dancing && off.zone === 'disco' && !off.dancing && off.angle === 0);

// Library: the quiet-room note, and the study timer at the desk.
const desk = await page.evaluate(() => window.__house.timerAt);
await tp(desk.x + desk.w / 2, desk.y + desk.h + 12);
await waitZone('library');
await page.waitForSelector('#timer-prompt', { timeout: 6000 }).catch(() => {});
const prompt = await page.locator('#timer-prompt').textContent().catch(() => null);
await page.click('#timer-prompt').catch(() => {});
await page.waitForTimeout(400);
const running = await page.evaluate(() => ({ text: window.__house.timerText.text, shown: window.__house.timerText.visible }));
const stopLabel = await page.locator('#timer-prompt').textContent().catch(() => null);
await page.click('#timer-prompt').catch(() => {});
await page.waitForTimeout(300);
const stopped = await page.evaluate(() => window.__house.timerText.visible);
check('at the Library desk: start the 25-minute study timer, see it count, stop it', { prompt, running, stopLabel, stopped },
  /Study timer/.test(prompt ?? '') && running.shown && /^2[45]:\d\d$/.test(running.text) && /Stop/.test(stopLabel ?? '') && !stopped);
await tp(desk.x + desk.w / 2, desk.y + desk.h + 120);
await page.waitForTimeout(400);
check('walking away from the desk hides the timer button', null, !(await page.locator('#timer-prompt').count()));

// Café: the special of the day, pinned on the fridge.
const fridge = await page.evaluate(() => window.__house.specialAt);
await tp(fridge.x + fridge.w / 2, fridge.y + fridge.h + 10);
await waitZone('cafe');
await page.waitForSelector('#cafe-special', { timeout: 6000 }).catch(() => {});
const special = await page.locator('#cafe-special').textContent().catch(() => null);
check('by the Café fridge: today’s special', special, /Today’s special/.test(special ?? '') && special.length > 20);

// Settings → Old rooms: the 8 old rooms, read only.
await page.click('#settings-button');
await page.click('[data-tab="more"]').catch(() => {});
await page.waitForSelector('#old-room-pick', { timeout: 4000 }).catch(() => {});
const old = await page.evaluate(() => [...(document.getElementById('old-room-pick')?.options ?? [])].map((o) => o.value));
check('Settings has the old rooms’ chat (read only)', old, old.length === 8 && old[0] === 'room_01' && old[7] === 'room_08');

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
