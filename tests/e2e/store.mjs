import { chromium } from 'playwright-core';
// STORE.md S2 on screen (test mode: a pretend wallet of 2,500 coins and 500 gems on this device, the same
// rules as buy_item()): the coins and gems beside the level, tapping them opens the Shop, the buy card's maths
// (you have, price, after), buying with coins and then wearing it, buying with gems, and "need … more" when
// it's too dear. Phone and desktop. Needs `npm run dev`. Set DH_CHROMIUM to use Chromium instead of Edge.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const text = (page, sel) => page.locator(sel).first().textContent();

for (const [label, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1280, height: 860 }, false]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem('diesel-house.name', 'Ann');
    localStorage.setItem('diesel-house.character', 'ninja.villager2');
    localStorage.setItem('diesel-house.mic-ok', '1');
    localStorage.setItem('diesel-house.guide-seen', '1');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  const tap = (sel) => (mobile ? page.tap(sel) : page.click(sel));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
  await page.waitForSelector('#wallet-chips:not([hidden])', { timeout: 10000 });
  const chips = await text(page, '#wallet-chips');
  check(`${label}: coins and gems beside the level (2,500 and 500)`, { chips }, /2,500/.test(chips) && /500/.test(chips));

  // The shop: opened from the wallet, Shop filter first, prices on the cards.
  await tap('#wallet-chips');
  await page.waitForSelector('#picker');
  const shop = await page.evaluate(() => ({
    title: document.querySelector('#picker-title')?.textContent,
    tab: document.querySelector('.cats [aria-selected="true"]')?.textContent,
    egg: document.querySelector('[data-character="ninja.eggboy"] .st')?.textContent,
    knight: document.querySelector('[data-character="ninja.knight"] .st')?.textContent,
    starters: document.querySelectorAll('#picker-grid [data-character="ninja.boy"]').length,
  }));
  check(`${label}: tapping the wallet opens the Shop: only things to buy, prices on the cards`, shop,
    shop.title === 'Shop' && shop.tab === 'Shop' && shop.egg === '2,000 coins' && shop.knight === '400 gems' && shop.starters === 0);

  // Egg Boy: the maths, then buy.
  await tap('[data-character="ninja.eggboy"]');
  const maths = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#picker-buy-box .maths .r')].map((r) => r.textContent),
    button: document.querySelector('#picker-buy')?.textContent,
    gold: !document.querySelector('#picker-buy').classList.contains('dh-btn--quiet') && document.querySelector('#picker-done').classList.contains('dh-btn--quiet'),
  }));
  check(`${label}: the buy card shows the maths (2,500 − 2,000 = 500) and one gold button`, maths,
    maths.rows.join('|') === 'You have2,500 coins|Price− 2,000|After500 coins' && maths.button === 'Buy for 2,000 coins' && maths.gold);
  await tap('#picker-buy');
  await page.waitForSelector('#bought');
  const after = await page.evaluate(() => ({
    toast: document.querySelector('#bought')?.textContent,
    card: document.querySelector('[data-character="ninja.eggboy"] .st')?.textContent ?? 'not in Shop list',
    wallet: document.querySelector('#picker-wallet')?.textContent,
    done: document.querySelector('#picker-done')?.textContent,
    box: document.querySelector('#picker-buy-box').hidden,
  }));
  check(`${label}: bought: “Egg Boy is yours”, 500 coins left, Done says “Wear Egg Boy”`, after,
    /Egg Boy is yours/.test(after.toast) && /500/.test(after.wallet) && after.done === 'Wear Egg Boy' && after.box);
  await tap('#picker-done');
  await page.waitForFunction(() => !document.querySelector('#picker'));
  const wearing = await page.evaluate(() => window.__house.character);
  const hud = await text(page, '#wallet-chips');
  check(`${label}: Done wears it; the top bar shows 500 coins`, { wearing, hud }, wearing === 'ninja.eggboy' && /^500/.test(hud.trim()));

  // Gems: a Rare for 400 (100 left), then an Epic for 800 is too dear.
  await tap('#wallet-chips');
  await page.waitForSelector('#picker');
  await tap('[data-character="ninja.knight"]');
  await tap('#picker-buy');
  await page.waitForSelector('#bought');
  await page.waitForTimeout(300);
  await tap('[data-character="ninja.knightgold"]');
  const dear = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#picker-buy-box .maths .r')].map((r) => r.textContent),
    button: document.querySelector('#picker-buy')?.textContent,
    disabled: document.querySelector('#picker-buy')?.disabled,
    note: document.querySelector('#picker-buy-box .v2-note')?.textContent,
  }));
  check(`${label}: an 800-gem Epic with 100 gems: “need 700 more”, Buy can’t be pressed`, dear,
    dear.rows[2] === 'Afterneed 700 more' && dear.button === 'Need 700 more gems' && dear.disabled && /Gem packs are coming soon/.test(dear.note ?? ''));
  await tap('[data-character="ninja.caveman"]');
  const coinsShort = await page.evaluate(() => ({ button: document.querySelector('#picker-buy')?.textContent, note: document.querySelector('#picker-buy-box .v2-note')?.textContent }));
  check(`${label}: a 2,000-coin Common with 500 coins: says how to earn coins`, coinsShort, coinsShort.button === 'Need 1,500 more coins' && /Earn coins by playing/.test(coinsShort.note ?? ''));
  if (label === 'phone') await page.screenshot({ path: 'tests/e2e/output/store-phone.png' });
  await ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
