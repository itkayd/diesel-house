import { chromium } from 'playwright-core';
// Walking by itself (tap a room on the map, Go next to a friend) keeps going when a card opens on top
// (the map, settings…); your own keys stay blocked while it's open. Needs `npm run dev`.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Ann');
  localStorage.setItem('diesel-house.character', 'ninja.villager2');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
const where = () => page.evaluate(() => ({ x: Math.round(window.__house.player.x), y: Math.round(window.__house.player.y), zone: window.__house.zone, walking: !!window.__house.autoPath }));

// Start walking to the Lounge, then open the map on the way.
await page.evaluate(() => window.__house.walkToRoom('lounge'));
await page.waitForTimeout(300);
const a = await where();
await page.click('#map-button');
await page.waitForSelector('#whos-where');
await page.waitForTimeout(700);
const b = await where();
check('the map opens while walking, and the walk carries on under it', { a, b }, b.walking && (a.x !== b.x || a.y !== b.y));
// Settings too, then wait to arrive with the card still open.
await page.keyboard.press('Escape');
await page.click('#settings-button');
await page.waitForSelector('#settings-sheet');
await page.waitForFunction(() => window.__house.zone === 'lounge' && !window.__house.autoPath, null, { timeout: 20000 }).catch(() => {});
const c = await where();
check('it arrives in the Lounge with Settings still open', c, c.zone === 'lounge' && !c.walking && !!(await page.$('#settings-sheet')));
// Your own keys still don't move you while a card is open.
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowRight');
const d = await where();
check('arrow keys don’t walk you while a card is open', { c, d }, c.x === d.x && c.y === d.y);

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
