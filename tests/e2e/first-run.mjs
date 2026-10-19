import { chromium } from 'playwright-core';
// U2, the first minutes (design/review/UX-RULES.md §3, src/ui/hints.ts), on a phone, offline (?test&hints):
// standing still shows "Drag the joystick" next to the joystick; "Got it" closes it for good; walking
// into a room points at the mic; with nobody else in, the quiet-house card offers Night Raid; near a
// games table a tip points at Play games. Tips never sit on top of a pop-up.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Newbie');
  localStorage.setItem('diesel-house.character', 'ninja.boy');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test&hints');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
const teleport = (room) =>
  page.evaluate((room) => {
    const h = window.__house;
    const c = room ? h.zones.floorCentre(room) : room;
    h.body.reset(c.x, c.y);
    h.player.setPosition(c.x, c.y);
  }, room);

// 1. Standing still: the joystick tip, just above the joystick.
const move = await page.waitForSelector('#hint-move', { timeout: 10000 }).then(() => true, () => false);
const where = await page.evaluate(() => {
  const h = document.getElementById('hint-move')?.getBoundingClientRect();
  const j = document.getElementById('joystick')?.getBoundingClientRect();
  return h && j ? { hintBottom: Math.round(h.bottom), joyTop: Math.round(j.top), text: document.getElementById('hint-move').textContent } : null;
});
check('standing still: a tip says to drag the joystick, sitting just above it', where, move && where && where.hintBottom <= where.joyTop && /joystick/.test(where.text));

// 2. Got it: gone, and remembered.
await page.tap('#hint-move .dh-hint-ok');
const gone = await page.evaluate(() => ({ shown: !!document.getElementById('hint-move'), seen: JSON.parse(localStorage.getItem('diesel-house.hints-seen') ?? '[]') }));
check('"Got it" closes the tip and it never comes back', gone, !gone.shown && gone.seen.includes('move'));

// 3. Into a room: the mic tip (after a short gap between tips).
await teleport('lounge');
const mic = await page.waitForSelector('#hint-mic', { timeout: 15000 }).then(() => true, () => false);
const micText = mic ? await page.textContent('#hint-mic') : null;
check('walking into a room: a tip points at the mic', { micText }, mic && /mic/i.test(micText ?? ''));
await page.tap('#hint-mic .dh-hint-ok');

// 4. Nobody else in: the quiet-house card, with Night Raid.
const quiet = await page.waitForSelector('#quiet-card', { timeout: 30000 }).then(() => true, () => false);
const quietInfo = await page.evaluate(() => ({ arcade: !!document.getElementById('quiet-arcade'), invite: !!document.getElementById('quiet-invite'), map: !!document.getElementById('quiet-map') }));
check('alone in the house: a card offers Night Raid, inviting a friend and exploring', quietInfo, quiet && quietInfo.arcade && quietInfo.map);
await page.tap('#quiet-arcade');
const arcade = await page.waitForSelector('#arcade-play', { timeout: 5000 }).then(() => true, () => false);
// While a pop-up is open, no tip shows on top of it.
await page.waitForTimeout(7500);
const overPopup = await page.evaluate(() => document.querySelectorAll('.dh-hint').length);
check('"Play Night Raid" opens the arcade; no tip pops up over it', { arcade, overPopup }, arcade && overPopup === 0);
await page.tap('#arcade-close');

// 5. Near a games table: a tip on Play games.
await page.evaluate(() => {
  const h = window.__house;
  h.body.reset(723, 525);
  h.player.setPosition(723, 525);
});
const games = await page.waitForSelector('#hint-games', { timeout: 15000 }).then(() => true, () => false);
check('at a games table: a tip points at Play games', { games }, games);
await page.tap('#game-prompt');
const lobby = await page.waitForSelector('[data-game="quiz"]', { timeout: 5000 }).then(() => true, () => false);
const tipGone = await page.evaluate(() => !document.getElementById('hint-games'));
check('opening the games closes the tip; the games list is one tap away', { lobby, tipGone }, lobby && tipGone);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
