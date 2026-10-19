import { chromium } from 'playwright-core';
// Animals (REDESIGN.md R4): animals live in the rooms that suit them and wander about without leaving
// their room; a pet follows its owner. Dev test mode. Set DH_CHROMIUM to use a Chromium.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Animals');
  localStorage.setItem('diesel-house.character', 'ninja.boy');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && window.__house.animals, null, { timeout: 30000 });

// 1. At least 10 kinds, each in its own room.
const a0 = await page.evaluate(() => window.__house.animals.state);
const kinds = new Set(a0.map((a) => a.key));
check('at least 10 kinds of animal live around the house, each in its room', { kinds: kinds.size, total: a0.length, wrong: a0.filter((a) => a.zone !== a.room) }, kinds.size >= 10 && a0.every((a) => a.zone === a.room));

// 2. They wander (some move within 20 s) and stay in their rooms.
await page.waitForTimeout(20000);
const a1 = await page.evaluate(() => window.__house.animals.state);
const moved = a1.filter((a, i) => Math.hypot(a.x - a0[i].x, a.y - a0[i].y) > 4).length;
check('animals wander about, and never leave their room', { moved, wrong: a1.filter((a) => a.zone !== a.room) }, moved >= 3 && a1.every((a) => a.zone === a.room));

// 3. A pet follows you: walk away and it catches up, a little behind.
await page.evaluate(() => window.__house.setMyPet('cat'));
const start = await page.evaluate(() => ({ pet: window.__house.me.petPos, me: { x: window.__house.player.x, y: window.__house.player.y } }));
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(1500);
await page.keyboard.up('ArrowUp');
await page.waitForTimeout(1500);
const after = await page.evaluate(() => ({ pet: window.__house.me.petPos, me: { x: window.__house.player.x, y: window.__house.player.y }, key: window.__house.me.petKey }));
const gap = Math.hypot(after.pet.x - after.me.x, after.pet.y - after.me.y);
check('your pet follows you and settles close by', { key: after.key, walked: Math.round(start.me.y - after.me.y), gap: Math.round(gap) }, after.key === 'cat' && start.me.y - after.me.y > 40 && gap < 24);
await page.evaluate(() => window.__house.setMyPet(null));
check('no pet: it goes home', { key: await page.evaluate(() => window.__house.me.petKey) }, (await page.evaluate(() => window.__house.me.petKey)) === null);

// 4. Profile → Pet: free pets at level 3, the rest "Shop soon".
await page.click('#xp-chip').catch(() => {});
const hasProfile = await page.locator('#profile-tab-pet').count();
if (hasProfile) {
  await page.click('#profile-tab-pet');
  const cards = await page.$$eval('#pet-grid [data-pet]', (bs) => bs.map((b) => [b.dataset.pet, b.disabled, b.querySelector('.st')?.textContent]));
  check('Profile → Pet lists every animal; shop ones are marked', { n: cards.length }, cards.length >= 20 && cards.some((c) => c[2] === 'Shop soon'));
}

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
