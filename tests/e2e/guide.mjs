import { chromium } from 'playwright-core';
// "How the house works" (src/ui/guide.ts): opens by itself on a first visit, every step can be skipped,
// the topic chips jump to any step, "Skip intro" closes it for good, and the ? button and Settings bring
// it back. Dev test mode; ?guide lets it open under automation. Set DH_CHROMIUM to use a Chromium.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Newbie');
  localStorage.setItem('diesel-house.character', '6');
  localStorage.setItem('diesel-house.mic-ok', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test&guide');
const shown = await page.waitForSelector('#guide', { timeout: 30000 }).then(() => true, () => false);
const step = () => page.evaluate(() => ({ title: document.getElementById('guide-title')?.textContent, on: document.querySelector('.dh-guide-chip.on')?.dataset.step, back: !document.getElementById('guide-back')?.hidden }));
const first = await step();
const chips = await page.locator('.dh-guide-chip').count();
check('first visit: the guide opens by itself at Welcome, 11 topics, no Back', { shown, first, chips }, shown && first.on === 'welcome' && !first.back && chips === 11);

await page.click('#guide-next');
const second = await step();
await page.click('#guide-back');
const backAgain = await step();
check('Next skips to the next step, Back goes back', { second, backAgain }, second.on === 'move' && backAgain.on === 'welcome');

await page.click('[data-step="games"]');
const games = await step();
check('a topic chip jumps straight to its step', games, games.on === 'games' && /games/i.test(games.title ?? ''));
const phoneText = await page.locator('.dh-guide-lines').textContent();
check('on a phone it says tap, not E', phoneText, /tap Play games/.test(phoneText) && !/press E/.test(phoneText));

await page.click('[data-step="rules"]');
const last = { ...(await step()), next: await page.locator('#guide-next').textContent() };
check('the last step is the house rules, with "Let’s go"', last, last.on === 'rules' && last.next === 'Let’s go');

await page.click('[data-step="move"]');
await page.click('#guide-skip');
const closed = await page.locator('#guide').count();
check('Skip intro closes it from any step', { closed }, closed === 0);

await page.reload();
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const again = await page.locator('#guide').count();
check('once skipped, it doesn’t open by itself again', { again }, again === 0);

// On a phone the ? button is hidden to keep the top bar tidy (it's in Settings → More).
const qHidden = await page.locator('#guide-button').isHidden();
check('on a phone the ? button stays out of the top bar', { qHidden }, qHidden);
await page.click('#settings-button');
await page.click('#settings-tab-more').catch(() => {});
await page.click('#settings-guide');
const fromSettings = await page.locator('#guide').count();
const reopened = await step();
check('Settings → How the house works opens it again, at the start', { fromSettings, ...reopened }, fromSettings === 1 && reopened.on === 'welcome');

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
