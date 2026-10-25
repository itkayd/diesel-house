import { chromium } from 'playwright-core';
// UX-RULES U6: Settings → More → Text size. Biggest makes panel text 1.3× (and the HUD, chat and games
// with it), it's remembered after a reload, and Normal puts it back. Screenshots of the phone at Biggest
// go to tests/e2e/output/ to check nothing overflows. Needs `npm run dev`.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Ann');
  localStorage.setItem('diesel-house.character', 'ninja.villager2');
  localStorage.setItem('diesel-house.mic-ok', '1');
  localStorage.setItem('diesel-house.guide-seen', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const ready = () => page.waitForFunction(() => !!window.__house?.player && window.__house.canMove, null, { timeout: 30000 });
await page.goto('http://localhost:5173/?test');
await ready();
const size = (sel) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), sel);

await page.tap('#settings-button');
await page.tap('#settings-tab-more');
const before = await size('#text-size [data-size="normal"]');
const noteBefore = await size('#settings-sheet .v2-note');
await page.tap('#text-size [data-size="biggest"]');
const after = await page.evaluate(() => ({
  ts: getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(),
  checked: document.querySelector('#text-size [aria-checked="true"]')?.dataset.size,
}));
const noteAfter = await size('#settings-sheet .v2-note');
check('Biggest: --ts is 1.3, the button is ticked, panel text grows 1.3×', { after, noteBefore, noteAfter, before },
  after.ts === '1.3' && after.checked === 'biggest' && Math.abs(noteAfter / noteBefore - 1.3) < 0.05);
await page.screenshot({ path: 'tests/e2e/output/text-biggest-settings.png' });

// Remembered after a reload; the HUD and the games panel at Biggest (screenshots).
await page.reload();
await ready();
const kept = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ts').trim());
check('remembered after a reload', { kept }, kept === '1.3');
await page.waitForTimeout(600);
await page.screenshot({ path: 'tests/e2e/output/text-biggest-hud.png' });
const hudFits = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const pill = r('#overlay .dh-hud-tl > :first-child');
  const row2 = r('#overlay .v2-progress');
  const btns = r('#overlay .dh-hud-tr');
  return { pillRight: Math.round(pill?.right ?? 0), buttonsLeft: Math.round(btns?.left ?? 0), row2Top: Math.round(row2?.top ?? 0), row2Right: Math.round(row2?.right ?? 0), buttonsBottom: Math.round(btns?.bottom ?? 0), width: innerWidth, scrollW: document.documentElement.scrollWidth };
});
check('HUD at Biggest: the pill fits beside the top-right buttons, the level / wallet row sits below them, no sideways scroll', hudFits,
  hudFits.pillRight <= hudFits.buttonsLeft + 1 && hudFits.row2Top >= hudFits.buttonsBottom - 1 && hudFits.row2Right <= hudFits.width && hudFits.scrollW <= hudFits.width);
await page.evaluate(() => {
  const h = window.__house;
  const s = h.spots.spots.find((x) => x.id === 'hall');
  h.body.reset(s.x, s.y);
  h.player.setPosition(s.x, s.y);
});
await page.waitForSelector('#game-prompt', { timeout: 8000 });
await page.tap('#game-prompt');
await page.waitForSelector('#games [data-game]');
await page.screenshot({ path: 'tests/e2e/output/text-biggest-games.png' });
const games = await page.evaluate(() => {
  const p = document.querySelector('#games .dh-panel');
  return { panel: Math.round(p.getBoundingClientRect().width), scroll: p.scrollWidth, client: p.clientWidth };
});
check('games panel at Biggest: nothing wider than the panel', games, games.scroll <= games.client + 1);
await page.keyboard.press('Escape');

// Back to Normal.
await page.tap('#settings-button');
await page.tap('#settings-tab-more');
await page.tap('#text-size [data-size="normal"]');
const back = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ts').trim());
check('Normal puts it back', { back }, back === '1');

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
