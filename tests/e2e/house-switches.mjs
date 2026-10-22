import { chromium } from 'playwright-core';
// The admin page's house switches, as the game sees them (src/net/houseSettings.ts; test mode flips them
// without a database): animals hide (all, or one room), pets hide, critters go, a game switched off shows
// "Switched off for now", Night Raid's prompt and card go, and the announcement banner shows and hides.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Switchy');
  localStorage.setItem('diesel-house.character', 'ninja.villager2');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && !!window.__houseSettings, null, { timeout: 30000 });
const flip = (k, v) => page.evaluate(([k, v]) => window.__houseSettings(k, v), [k, v]);
const frames = (n = 10) => page.waitForTimeout(n * 40);

// Animals.
const visible = () => page.evaluate(() => window.__house.animals.list.map((w) => ({ room: w.room, on: w.img.visible })));
const before = await visible();
await flip('animals', { enabled: false, rooms_off: [] });
await frames();
const allOff = await visible();
const someRoom = before[0]?.room;
await flip('animals', { enabled: true, rooms_off: [someRoom] });
await frames();
const oneOff = await visible();
await flip('animals', { enabled: true, rooms_off: [] });
check('animals: all hidden when off; one room off hides only that room’s', { room: someRoom }, before.every((a) => a.on) && allOff.every((a) => !a.on) && oneOff.every((a) => a.on === (a.room !== someRoom)));

// Critters.
await flip('critters', { enabled: false });
await frames();
const crit = await page.evaluate(() => window.__house.critters?.shown?.size ?? 0);
await flip('critters', { enabled: true });
check('critters switched off: none on screen', crit, crit === 0);

// A game switched off, and Night Raid.
await flip('games_off', ['quiz']);
await flip('arcade', { enabled: false });
await page.evaluate(() => { const h = window.__house; h.body.reset(723, 525); h.player.setPosition(723, 525); });
await page.waitForSelector('#game-prompt', { timeout: 5000 });
await page.tap('#game-prompt');
await page.waitForSelector('[data-game="quiz"]');
const quiz = await page.evaluate(() => { const b = document.querySelector('[data-game="quiz"]'); return { disabled: b.disabled, text: b.textContent }; });
const arcadeCard = await page.$('#games-arcade');
check('a game switched off for the house: greyed, “Switched off for now”; the Night Raid card is gone', { quiz, arcadeCard: !!arcadeCard }, quiz.disabled && /Switched off for now/.test(quiz.text) && !arcadeCard);
await page.keyboard.press('Escape');
await flip('games_off', []);
await flip('arcade', { enabled: true });

// Announcement.
await flip('announcement', { text: 'Quiz night in the Lounge at 8!', until: new Date(Date.now() + 3600_000).toISOString() });
const shown = await page.waitForSelector('#announcement', { timeout: 3000 }).then((e) => e.textContent(), () => null);
await page.screenshot({ path: process.env.DH_SHOTS ? `${process.env.DH_SHOTS}/announcement.png` : '/dev/null' }).catch(() => {});
await page.tap('#announcement button');
const gone = !(await page.$('#announcement'));
await flip('announcement', { text: 'Old news', until: new Date(Date.now() - 1000).toISOString() });
const expired = !(await page.$('#announcement'));
check('announcement: shows for everyone, ✕ hides it, an expired one never shows', { shown, gone, expired }, shown?.includes('Quiz night') && gone && expired);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
