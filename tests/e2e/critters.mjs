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
// supabase/tests/critters_test.sql MULTI: critters 0-3 of slots 14,600,000 … 14,600,009.
const MULTI = '-,-,-,-,bunny,medal,duck,dog,frog,fox,duck,dog,-,-,-,-,cat,bunny,dog,dog,owl,duck,dog,dog,duck,duck,dog,cat,dog,dog,dog,cat,-,-,-,-,frog,dog,dog,cat';
const js = await page.evaluate(async () => {
  const { critterFor } = await import('/src/critters/critters.ts');
  return Array.from({ length: 40 }, (_, i) => critterFor(14600000 + i) ?? '-').join(',');
});
const multi = await page.evaluate(async () => {
  const { critterAt } = await import('/src/critters/critters.ts');
  return Array.from({ length: 40 }, (_, i) => critterAt(14600000 + Math.floor(i / 4), i % 4) ?? '-').join(',');
});
check('the browser picks the same critters as the database, slot by slot and critter by critter', { js, multi }, js === SQL && multi === MULTI);

// 2. Pretend it's a slot with a fox: it shows up on its spot, in the hallway or a room.
const spawn = await page.evaluate(async () => {
  const { critterAt, SLOT_MS } = await import('/src/critters/critters.ts');
  const slot = 14600028; // a fox first (see the list above)
  window.__house.critters.now = () => slot * SLOT_MS + 5000;
  await new Promise((r) => setTimeout(r, 300));
  const list = window.__house.critters.current;
  return { first: list[0], count: list.length, expected: critterAt(slot, 0), places: window.__house.critters.places.length };
});
check('a critter turns up for its slot, on one of hundreds of free spots (alone: 1 or 2)', spawn,
  spawn.first?.id === 'fox' && spawn.expected === 'fox' && spawn.places > 100 && spawn.count >= 1 && spawn.count <= 2);

// 3. More people, more critters: with 3 in the house, 3 or 4, each on its own spot, all on screen.
const crowd = await page.evaluate(async () => {
  const { SLOT_MS, countFor } = await import('/src/critters/critters.ts');
  const c = window.__house.critters;
  c.h.people = () => 3;
  const counts = [];
  for (let slot = 14600040; slot < 14600060; slot++) {
    c.now = () => slot * SLOT_MS + 1000;
    await new Promise((r) => setTimeout(r, 120));
    if (c.current.length) counts.push({ n: c.current.length, want: countFor(slot, 3), spots: new Set(c.current.map((s) => `${s.x},${s.y}`)).size, sprites: c.sprites });
  }
  c.h.people = () => 1 + [...window.__house.remotes.values()].filter((r) => r.active).length;
  return counts;
});
check('with 3 people there are 3 or 4 critters, each on its own spot', { crowd },
  crowd.length > 5 && crowd.every((x) => (x.n === 3 || x.n === 4) && x.n === x.want && x.spots === x.n && x.sprites === x.n) && crowd.some((x) => x.n === 4) && crowd.some((x) => x.n === 3));

// 4. The map shows them.
await page.evaluate(async () => {
  const { SLOT_MS } = await import('/src/critters/critters.ts');
  window.__house.critters.now = () => 14600028 * SLOT_MS + 5000;
});
await page.waitForTimeout(200);
await page.tap('#map-button');
const map = await page.evaluate(() => ({ dots: document.querySelectorAll('#whos-where-map .dot.critter').length, note: document.getElementById('whos-where-critter')?.textContent }));
check('Who’s where shows the critters and how long they stay', map, map.dots >= 1 && /fox/.test(map.note ?? '') && /for another/.test(map.note ?? ''));
await page.tap('#whos-where-close');

// 5. Walk into the fox: caught (test mode: no XP), it's gone; any others stay.
await page.evaluate(() => {
  const toasts = (window.__critterToasts = []);
  new MutationObserver(() => document.querySelectorAll('#toasts .dh-toast').forEach((t) => toasts.includes(t.textContent) || toasts.push(t.textContent))).observe(document.getElementById('toasts'), { childList: true, subtree: true });
});
const before = await page.evaluate(() => window.__house.critters.current.length);
const fox = await page.evaluate(() => window.__house.critters.current.find((s) => s.id === 'fox'));
await page.evaluate(([x, y]) => window.__house.body.reset(x, y), [fox.x, fox.y]);
await page.waitForFunction(() => !window.__house.critters.current.some((s) => s.id === 'fox'), null, { timeout: 4000 }).catch(() => {});
const caught = await page.evaluate(() => ({ left: window.__house.critters.current.map((s) => s.id), toasts: window.__critterToasts }));
check('walking into one catches it: a toast, it hops away, the others stay', { before, ...caught },
  !caught.left.includes('fox') && caught.left.length === before - 1 && caught.toasts.some((t) => /You caught the fox/.test(t)));

// 6. Critters nobody caught, then a quiet slot: gone from the world AND the map.
const none = await page.evaluate(async () => {
  const { SLOT_MS } = await import('/src/critters/critters.ts');
  const c = window.__house.critters;
  c.now = () => 14600002 * SLOT_MS + 1000; // a frog first, not caught
  await new Promise((r) => setTimeout(r, 300));
  const before = c.current.map((s) => s.id);
  c.now = () => 14600003 * SLOT_MS + 1000; // nothing
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: c.current, sprites: c.sprites, map: window.__house.whosWhere().critters };
});
check('when a quiet slot starts, the critters leave the world and the map', none, none.before[0] === 'frog' && none.after.length === 0 && none.sprites === 0 && none.map.length === 0);

// 7. Noticeboard: "Today's catches" with counts, XP and what they caught.
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
