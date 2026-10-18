import { chromium } from 'playwright-core';
// UI extras (G2b): the room title on the way in, player counts and faces in the games menu, quick lines
// in the chat, M for Who's where (with room headcounts), and the outline of you behind furniture.
// Dev test mode. Set DH_CHROMIUM to use a Chromium.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Extras');
  localStorage.setItem('diesel-house.character', '6');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
await page.waitForTimeout(1000);

// 1. M opens Who's where; Escape closes it.
await page.keyboard.press('m');
const map = await page.locator('#whos-where').count();
const hallLabel = await page.locator('#whos-where-map .zone.hall .lab').first().textContent().catch(() => null);
await page.keyboard.press('Escape');
const mapGone = await page.locator('#whos-where').count();
check('M opens Who’s where (the hall is labelled Great Hall), Escape closes it', { map, hallLabel, mapGone }, map === 1 && hallLabel === 'Great Hall' && mapGone === 0);

// 2. Games menu: a players tag on every game, and who's sitting here.
await page.evaluate(() => { const h = window.__house; h.body.reset(723, 525); h.player.setPosition(723, 525); h.sendMove(true); });
await page.waitForSelector('#game-prompt', { timeout: 5000 });
await page.keyboard.press('e');
await page.waitForSelector('#games');
const tags = await page.$$eval('#games .v2-game .tag', (t) => t.map((x) => x.textContent));
const seated = await page.locator('#games-seated').textContent();
check('games menu: each game says how many can play, and who is at the table', { tags, seated }, tags.length >= 6 && tags.every((t) => /^\d/.test(t ?? '')) && /Just you/.test(seated ?? ''));
await page.keyboard.press('Escape');

// 3. Walking into a room: its name across the screen for a moment.
await page.evaluate(() => window.__house.walkToRoom('lounge'));
const banner = await page.waitForSelector('#room-banner', { timeout: 20000 }).then((b) => b.textContent(), () => null);
await page.waitForTimeout(3200);
const bannerGone = await page.locator('#room-banner').count();
check('walking into the Lounge shows "Lounge" across the screen, then it goes', { banner, bannerGone }, /^Lounge/.test(banner ?? '') && bannerGone === 0);

// 4. Behind the sofa: a faint outline of you on top.
const ghost = await page.evaluate(() => { const h = window.__house; return { hides: h.look.hides(h.player.x, h.player.y, h.player.depth), shown: !!h.me.ghost?.visible }; });
check('standing behind the Lounge sofa, your outline shows through', ghost, ghost.hides === ghost.shown);

// 5. Enter opens the chat ready to type; quick lines are there; Escape closes it.
await page.keyboard.press('Enter');
await page.waitForSelector('#chat', { timeout: 3000 });
const focused = await page.evaluate(() => document.activeElement?.id);
const quick = await page.locator('#chat-quick button').count();
const sendOff = await page.locator('#chat-send').isDisabled();
await page.keyboard.type('x');
const sendOn = await page.locator('#chat-send').isEnabled();
await page.fill('#chat-input', '');
await page.keyboard.press('Escape');
const chatGone = await page.locator('#chat').count();
check('Enter opens the room chat with the cursor in the box, quick lines, Send only with text, Escape closes', { focused, quick, sendOff, sendOn, chatGone }, focused === 'chat-input' && quick >= 4 && sendOff && sendOn && chatGone === 0);

// 6. Settings → More lists the keyboard shortcuts.
await page.click('#settings-button');
await page.click('#settings-tab-more');
const keys = await page.locator('#settings-keys kbd').count();
check('Settings → More lists the keyboard shortcuts', { keys }, keys >= 8);

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
