import { chromium } from 'playwright-core';
// Critters (supabase/migrations/20261028_critters.sql): the schedule matches the database's
// (supabase/tests/critters_test.sql prints the same list), a critter turns up on its spot for its 2-minute
// slot, walking into it catches it (test mode: no XP, the real catch is checked by the SQL tests), the map
// shows where it is, and the noticeboard has a "Today's catches" tab. On a phone, in dev test mode.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Catcher');
  localStorage.setItem('diesel-house.character', '7');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.critters, null, { timeout: 20000 });

// 1. Same schedule as the database (slots 14,600,000 … 14,600,039).
const SQL = '-,bunny,frog,-,cat,owl,duck,dog,-,frog,duck,-,cat,owl,dog,dog,cat,frog,duck,-,cat,bunny,-,dog,cat,frog,duck,-,fox,bunny,-,cat,bunny,-,duck,cat,owl,frog,-,cat';
const js = await page.evaluate(async () => {
  const { critterFor } = await import('/src/critters/critters.ts');
  return Array.from({ length: 40 }, (_, i) => critterFor(14600000 + i) ?? '-').join(',');
});
check('the browser picks the same critters as the database, slot by slot', { js }, js === SQL);

// 2. Pretend it's a slot with a fox: it shows up on its spot, in the hallway or a room.
const spawn = await page.evaluate(async () => {
  const { critterFor, SLOT_MS } = await import('/src/critters/critters.ts');
  let slot = 14600028; // a fox (see the list above)
  window.__house.critters.now = () => slot * SLOT_MS + 5000;
  await new Promise((r) => setTimeout(r, 300));
  const s = window.__house.critters.current;
  return s && { ...s, expected: critterFor(slot), places: window.__house.critters.places.length };
});
check('a critter turns up for its slot, on one of hundreds of free spots', spawn, spawn?.id === 'fox' && spawn.expected === 'fox' && spawn.places > 100);

// 3. The map shows it.
await page.tap('#map-button');
const map = await page.evaluate(() => ({ dot: !!document.querySelector('#whos-where-map .dot.critter'), note: document.getElementById('whos-where-critter')?.textContent }));
check('Who’s where shows the critter and how long it stays', map, map.dot && /A fox is in .* for another/.test(map.note ?? ''));
await page.tap('#whos-where-close');

// 4. Walk into it: caught (test mode: no XP), and it's gone.
await page.evaluate(() => {
  const toasts = (window.__critterToasts = []);
  new MutationObserver(() => document.querySelectorAll('#toasts .dh-toast').forEach((t) => toasts.includes(t.textContent) || toasts.push(t.textContent))).observe(document.getElementById('toasts'), { childList: true, subtree: true });
});
await page.evaluate(([x, y]) => window.__house.body.reset(x, y), [spawn.x, spawn.y]);
await page.waitForFunction(() => !window.__house.critters.current, null, { timeout: 4000 }).catch(() => {});
const caught = await page.evaluate(() => ({ current: window.__house.critters.current, toasts: window.__critterToasts }));
check('walking into it catches it: a toast, and it hops away', caught, !caught.current && caught.toasts.some((t) => /You caught the fox/.test(t)));

// 5. A slot with no critter: nothing there.
const none = await page.evaluate(async () => {
  const { SLOT_MS } = await import('/src/critters/critters.ts');
  window.__house.critters.now = () => 14600003 * SLOT_MS + 1000;
  await new Promise((r) => setTimeout(r, 300));
  return window.__house.critters.current;
});
check('a quiet slot has no critter', { none }, none === null);

// 6. Noticeboard: "Today's catches" with counts, XP and what they caught.
await page.evaluate(async () => {
  const { openNoticeboard } = await import('/src/ui/progressUi.ts');
  openNoticeboard([], [
    { user_id: 'a', display_name: 'Sami', character_index: 2, level: 12, caught: 6, xp: 58, critters: ['cat', 'dog', 'owl', 'cat', 'frog', 'fox'] },
    { user_id: 'b', display_name: 'Jo', character_index: 4, level: 3, caught: 2, xp: 10, critters: ['duck', 'cat'] },
  ], 'b', false, () => {}, 'catches');
});
const board = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#board-list .v2-board-row')].map((r) => r.textContent),
  pets: document.querySelectorAll('#board-list .v2-board-row')[0]?.querySelectorAll('.v2-critter').length,
  tab: document.querySelector('#board-tab-catches')?.getAttribute('aria-selected'),
}));
check('noticeboard "Today’s catches": how many, how much XP and which critters', board,
  board.tab === 'true' && /Sami/.test(board.rows[0]) && /6 caught/.test(board.rows[0]) && /\+58 XP/.test(board.rows[0]) && board.pets === 6 && /Jo \(you\)/.test(board.rows[1]));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
