import { chromium } from 'playwright-core';
// The Disco's jukebox (R4): the button only shows in the Disco, the card lists the tracks, a track plays
// from where it should be in its loop (same moment for everyone), only inside the Disco, and stops
// outside. Dev test mode (no database: the track is set as if it came from the rooms table).
const browser = await chromium.launch({
  ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'DJ');
  localStorage.setItem('diesel-house.character', 'ninja.boy');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && window.__house.jukebox, null, { timeout: 30000 });
await page.mouse.click(640, 400); // a tap unlocks sound
const go = (room) => page.evaluate((r) => window.__house.walkToRoom(r), room);
const zone = (z) => page.waitForFunction((z) => window.__house.zone === z, z, { timeout: 20000 });

// 1. Hidden in the hall; shown in the Disco.
const hall = await page.locator('#jukebox-button').isVisible();
await go('disco');
await zone('disco');
await page.waitForTimeout(300);
const disco = await page.locator('#jukebox-button').isVisible();
check('the jukebox button only shows in the Disco', { hall, disco }, !hall && disco);

// 2. The card lists the 4 tracks.
await page.click('#jukebox-button');
const tracks = await page.$$eval('#jukebox [data-track]', (bs) => bs.map((b) => b.dataset.track));
check('the jukebox lists the 4 CC0 tracks, and says nothing is playing', { tracks, now: await page.locator('#jukebox-now').textContent() }, tracks.length === 4 && /Nothing playing/.test(await page.locator('#jukebox-now').textContent()));
await page.keyboard.press('Escape');

// 3. A track that started 10 s ago plays from 10 s in, for everyone.
await page.evaluate(() => {
  const h = window.__house;
  h.roomChanged({ ...h.rooms.get('disco'), id: 'disco', music: 'sun_tribe', music_at: new Date(Date.now() - 10_000).toISOString(), music_by: null });
});
const playing = await page.waitForFunction(() => window.__house.jukebox.now === 'sun_tribe', null, { timeout: 8000 }).then(() => true, () => false);
check('a track put on 10 s ago plays inside the Disco', { playing }, playing);
await page.click('#jukebox-button');
const now = await page.locator('#jukebox-now').textContent();
check('the card says what is playing', { now }, /Now playing: Sun Tribe/.test(now ?? ''));
await page.keyboard.press('Escape');

// 4. Out of the Disco, it stops (music never leaks into other rooms).
await go('gaming');
await zone('gaming');
await page.waitForTimeout(500);
const outside = await page.evaluate(() => ({ now: window.__house.jukebox.now, button: !document.getElementById('jukebox-button').hidden }));
check('leaving the Disco stops the music and hides the button', outside, outside.now === null && !outside.button);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
