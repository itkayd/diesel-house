import { chromium } from 'playwright-core';
// STORE.md S2 on screen (test mode: a pretend wallet of 2,500 coins and 500 gems on this device, the same
// rules as buy_item()): the coins and gems beside the level open the Shop (its own sheet: tabs, cards), the
// buy card's maths (you have, price, after), buying with coins and wearing it, buying with gems, "need … more"
// when it's too dear, the Owned filter and the Gems tab. Phone and desktop. Needs `npm run dev`. Set DH_CHROMIUM to use Chromium instead of Edge.
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

  // The Shop: its own sheet, opened from the wallet; tabs; This week's pick; cards with rarity and price.
  await tap('#wallet-chips');
  await page.waitForSelector('#store');
  const front = await page.evaluate(() => ({
    title: document.querySelector('#store-title')?.textContent,
    tabs: [...document.querySelectorAll('#store [role="tab"]')].map((t) => t.textContent),
    on: document.querySelector('#store [aria-selected="true"]')?.textContent,
    hero: !!document.querySelector('#store-hero'),
    daily: document.querySelectorAll('#store-body .dh-scard').length,
    earn: !!document.querySelector('#store-earn'),
    picker: !!document.getElementById('picker'),
    name: !!document.getElementById('player-name'),
  }));
  check(`${label}: the wallet opens the Shop (not the picker): Featured · Characters · Gems, a weekly pick, 3 daily picks, how to earn`, front,
    front.title === 'Shop' && front.tabs.join('|') === 'Featured|Characters|Gems' && front.on === 'Featured' && front.hero && front.daily === 3 && front.earn && !front.picker && !front.name);
  await tap('#store-tab-characters');
  const cards = await page.evaluate(() => ({
    sections: [...document.querySelectorAll('#store-body .dh-store-sect')].map((s) => s.textContent),
    egg: document.querySelector('[data-item="ninja.eggboy"]')?.textContent,
    knight: document.querySelector('[data-item="ninja.knight"]')?.textContent,
    starters: document.querySelectorAll('#store [data-item="ninja.boy"]').length,
  }));
  check(`${label}: Characters: Common / Rare / Epic sections with their price, cards show rarity + price, no free starters`, cards,
    cards.sections.join('|') === 'Common2,000 coins each|Rare400 gems each|Epic800 gems each' && cards.egg === 'CommonEgg Boy2,000' && cards.knight === 'RareKnight400' && cards.starters === 0);

  // Egg Boy: the buy card with the maths, then buy.
  await tap('[data-item="ninja.eggboy"]');
  await page.waitForSelector('#store-item');
  const maths = await page.evaluate(() => ({
    name: document.querySelector('#store-item-name')?.textContent,
    rows: [...document.querySelectorAll('#store-maths .r')].map((r) => r.textContent),
    button: document.querySelector('#store-buy')?.textContent,
    gold: !document.querySelector('#store-buy').classList.contains('dh-btn--quiet') && document.querySelector('#store-try').classList.contains('dh-btn--quiet'),
    moves: [...document.querySelectorAll('#store-item .moves button')].map((b) => b.textContent).join(' '),
  }));
  check(`${label}: the buy card: moves, the maths (2,500 − 2,000 = 500), Try on and one gold Buy`, maths,
    maths.name === 'Egg Boy' && maths.rows.join('|') === 'You have2,500 coins|Price− 2,000|After500 coins' && maths.button === 'Buy for 2,000 coins' && maths.gold && maths.moves === 'Walk Attack Jump');
  await tap('#store-buy');
  await page.waitForSelector('#store-yay');
  const after = await page.evaluate(() => ({
    yay: document.querySelector('#store-yay')?.textContent,
    wear: document.querySelector('#store-wear')?.textContent,
    wallet: document.querySelector('#store-wallet')?.textContent,
    card: document.querySelector('#store-body [data-item="ninja.eggboy"]')?.textContent,
  }));
  check(`${label}: bought: “Egg Boy is yours!”, Wear now, 500 coins left, the card says Owned`, after,
    /Egg Boy is yours/.test(after.yay) && after.wear === 'Wear now' && /^500/.test(after.wallet) && /Owned/.test(after.card));
  await tap('#store-wear');
  await page.waitForFunction(() => !document.querySelector('#store') && !document.querySelector('#store-item'));
  const wearing = await page.evaluate(() => window.__house.character);
  const hud = await text(page, '#wallet-chips');
  check(`${label}: Wear now wears it and closes the Shop; the top bar shows 500 coins`, { wearing, hud }, wearing === 'ninja.eggboy' && /^500/.test(hud.trim()));

  // Gems: a Rare for 400 (100 left), then an Epic for 800 is too dear.
  await tap('#wallet-chips');
  await page.waitForSelector('#store');
  await tap('#store-tab-characters');
  await tap('[data-item="ninja.knight"]');
  await tap('#store-buy');
  await page.waitForSelector('#store-yay');
  await tap('#store-item-close');
  await page.waitForFunction(() => !document.querySelector('#store-item'));
  await tap('[data-item="ninja.knightgold"]');
  const dear = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#store-maths .r')].map((r) => r.textContent),
    button: document.querySelector('#store-buy')?.textContent,
    disabled: document.querySelector('#store-buy')?.disabled,
    note: document.querySelector('#store-note')?.textContent,
  }));
  check(`${label}: an 800-gem Epic with 100 gems: “need 700 more”, Buy can’t be pressed`, dear,
    dear.rows[2] === 'Afterneed 700 more' && dear.button === 'Need 700 more' && dear.disabled && /Gem packs are coming soon/.test(dear.note ?? ''));
  await tap('#store-item-close');
  await page.waitForFunction(() => !document.querySelector('#store-item'));
  await tap('[data-item="ninja.caveman"]');
  const coinsShort = await page.evaluate(() => ({ button: document.querySelector('#store-buy')?.textContent, note: document.querySelector('#store-note')?.textContent }));
  check(`${label}: a 2,000-coin Common with 500 coins: says how to earn coins`, coinsShort, coinsShort.button === 'Need 1,500 more' && /Earn coins by playing/.test(coinsShort.note ?? ''));
  await tap('#store-item-close');
  // Owned filter, then the gem chip's "+" opens the Gems tab.
  await tap('[data-filter="owned"]');
  const mine = await page.$$eval('#store-body [data-item]', (cs) => cs.map((c) => c.dataset.item).sort());
  await tap('.dh-store-gems');
  const gems = await page.evaluate(() => ({ on: document.querySelector('#store [aria-selected="true"]')?.textContent, packs: document.querySelector('#store-packs')?.textContent }));
  check(`${label}: Owned shows what you bought; the gems “+” opens Gems (packs coming soon)`, { mine, gems }, JSON.stringify(mine) === '["ninja.eggboy","ninja.knight"]' && gems.on === 'Gems' && /coming soon/.test(gems.packs ?? ''));
  if (label === 'phone') await page.screenshot({ path: 'tests/e2e/output/store-phone.png' });
  await ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
