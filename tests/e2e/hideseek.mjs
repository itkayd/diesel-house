import { chromium } from 'playwright-core';
// Hide and seek (src/house/hideSeek.ts), test mode: you host, two pretend friends (Zara, Bo) join over the
// "network" (messages handed straight to the host). Round 1 you seek: eyes shut while counting, then the torch;
// walking into Bo finds him, searching Zara's cupboard finds her, and the seeker wins. Round 2 you hide: the
// Hide button by furniture, frozen and see-through inside, and you win when time runs out. Phone size.
// Needs `npm run dev`. Set DH_CHROMIUM to use Chromium instead of Edge.
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
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && window.__house.canMove && !!window.__hs, null, { timeout: 30000 });
const ev = (f, a) => page.evaluate(f, a);
// Two friends in the hall, a little away from us.
await ev(() => {
  const h = window.__house;
  for (const [id, name, ch, dx] of [['zara-1', 'Zara', 'ninja.princess', 120], ['bo-2', 'Bo', 'ninja.oldman', -120]]) {
    h.addRemote({ id, name, character: ch, zone: 'hallway', lv: 3, st: 1 });
    h.receiveMove({ id, x: h.player.x + dx, y: h.player.y, vx: 0, vy: 0, dir: 'down', zone: 'hallway', t: Date.now() });
  }
});
await page.waitForTimeout(400);
const state = () => ev(() => window.__hs.s && { phase: window.__hs.s.phase, players: window.__hs.s.players.length, seeker: window.__hs.s.seeker, found: window.__hs.s.found, hidden: window.__hs.s.hidden, winners: window.__hs.s.winners });
const join = (id, name) => ev(([id, name]) => window.__hs.receive({ k: 'act', from: id, a: { t: 'join', name } }), [id, name]);
const timeUp = () => ev(() => { window.__hs.host.deadline = Date.now() - 1; });
const me = () => ev(() => ({ x: Math.round(window.__house.player.x), y: Math.round(window.__house.player.y) }));
const put = (x, y) => ev(([x, y]) => { const h = window.__house; h.body.reset(x, y); h.player.setPosition(x, y); }, [x, y]);
// A cupboard or bookcase (somewhere you can stand just below it).
const spot = await ev(() => {
  const s = window.__house.look.hideSpots.find((s) => /cupboard|bookcase/.test(s.kind)) ?? window.__house.look.hideSpots[0];
  return { id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, n: window.__house.look.hideSpots.length };
});
check('the house has hiding places (cupboards, sofas, bookcases, plants…)', spot, spot.n >= 15);

// ---- The games panel has it ----
const card = await ev(() => {
  window.__house.games?.open?.('hall');
  return !!document.getElementById('games-hideseek');
});
await ev(() => document.getElementById('games-close')?.click());

// ---- Round 1: start, friends join, you seek ----
await ev(() => window.__hs.start());
await page.waitForSelector('#hs-bar');
await page.screenshot({ path: 'tests/e2e/output/hideseek-lobby.png' });
const lobby = await ev(() => ({ bar: document.getElementById('hs-bar').textContent, start: document.getElementById('hs-start')?.disabled }));
check('starting asks the house; Start waits for a second player', { lobby, card }, /Hide and seek/.test(lobby.bar) && lobby.start === true);
await join('zara-1', 'Zara');
await join('bo-2', 'Bo');
await page.waitForTimeout(150);
const ready = await ev(() => document.getElementById('hs-start')?.textContent);
check('friends join: Start (3)', ready, ready === 'Start (3)');
await ev(() => { window.__hs.host.rand = () => 0; }); // you're first in the list: you seek
await page.click('#hs-start');
await page.waitForSelector('#hs-count');
let s = await state();
const a = await me();
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(400);
await page.keyboard.up('ArrowRight');
const b = await me();
const counting = await ev(() => document.getElementById('hs-count')?.textContent);
await page.screenshot({ path: 'tests/e2e/output/hideseek-counting.png' });
check('you seek: eyes shut (the counting screen) and you can’t move', { s, counting, a, b }, s.phase === 'hide' && /You’re the seeker/.test(counting) && a.x === b.x);
// Zara gets into the cupboard; Bo stays out in the open.
await ev((id) => window.__hs.receive({ k: 'act', from: 'zara-1', a: { t: 'hide', spot: id } }), spot.id);
await timeUp();
await page.waitForSelector('#hs-torch');
await page.waitForTimeout(200);
const seek = await ev(() => ({ phase: window.__hs.s.phase, zara: window.__house.remotes.get('zara-1').avatar.sprite.visible, bo: window.__house.remotes.get('bo-2').avatar.sprite.visible, count: !!document.getElementById('hs-count') }));
await page.screenshot({ path: 'tests/e2e/output/hideseek-torch.png' });
check('seeking: the torch; Zara (inside) and Bo (far off) can’t be seen', seek, seek.phase === 'seek' && !seek.zara && !seek.bo && !seek.count);
// Bo walks right up to you: found.
await ev(() => { const h = window.__house; h.receiveMove({ id: 'bo-2', x: h.player.x + 8, y: h.player.y, vx: 0, vy: 0, dir: 'down', zone: 'hallway', t: Date.now() }); });
await page.waitForFunction(() => window.__hs.s.found.includes('bo-2'), null, { timeout: 5000 }).catch(() => {});
s = await state();
check('walking into Bo finds him', s.found, JSON.stringify(s.found) === '["bo-2"]');
// Over to the cupboard, search it: Zara.
await put(spot.x + spot.w / 2, spot.y + spot.h + 6);
await page.waitForSelector('#hs-search', { timeout: 5000 }).catch(() => {});
const searchBtn = await ev(() => document.getElementById('hs-search')?.textContent ?? null);
await page.click('#hs-search').catch(() => {});
await page.waitForFunction(() => window.__hs.s?.phase === 'end', null, { timeout: 5000 }).catch(() => {});
s = await state();
const end1 = await ev(() => document.getElementById('hs-sub')?.textContent);
check(`next to ${spot.kind}: “Search” finds Zara; everyone found, the seeker wins`, { searchBtn, s, end1 }, /^Search/.test(searchBtn ?? '') && s.phase === 'end' && JSON.stringify(s.winners) === JSON.stringify([s.seeker]) && /You found everyone/.test(end1));

// ---- Round 2: you hide ----
await page.click('#hs-again');
await page.waitForSelector('#hs-start');
await join('zara-1', 'Zara');
await join('bo-2', 'Bo');
await ev(() => { window.__hs.host.rand = () => 0.4; }); // Zara seeks
await page.click('#hs-start');
await page.waitForFunction(() => window.__hs.s?.phase === 'hide');
await put(spot.x + spot.w / 2, spot.y + spot.h + 6);
await page.waitForSelector('#hs-hide', { timeout: 5000 }).catch(() => {});
const hideBtn = await ev(() => document.getElementById('hs-hide')?.textContent ?? null);
await page.click('#hs-hide').catch(() => {});
await page.waitForTimeout(200);
const c = await me();
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(400);
await page.keyboard.up('ArrowLeft');
const d = await me();
const inside = await ev(() => ({ hidden: Object.keys(window.__hs.s.hidden), alpha: window.__house.me.sprite.alpha, sub: document.getElementById('hs-sub')?.textContent, out: !!document.getElementById('hs-unhide') }));
await page.screenshot({ path: 'tests/e2e/output/hideseek-hiding.png' });
check('you hide: “Hide in …” by furniture; inside you’re see-through, can’t move, and can come out', { hideBtn, inside, c, d }, /^Hide in/.test(hideBtn ?? '') && inside.hidden.length === 1 && inside.alpha < 1 && c.x === d.x && c.y === d.y && inside.out && /hiding in/.test(inside.sub));
// Zara can't search where you are… time runs out: you (and Bo) win.
await timeUp();
await page.waitForFunction(() => window.__hs.s?.phase === 'seek');
await timeUp();
await page.waitForFunction(() => window.__hs.s?.phase === 'end');
s = await state();
const end2 = await ev(() => ({ sub: document.getElementById('hs-sub')?.textContent, alpha: window.__house.me.sprite.alpha, zara: window.__house.remotes.get('zara-1').avatar.sprite.visible }));
check('time’s up with you still hidden: the hiders win; everyone visible again', { s, end2 }, s.winners.length === 2 && !s.winners.includes('zara-1') && /win/.test(end2.sub) && end2.alpha === 1 && end2.zara);
await page.screenshot({ path: 'tests/e2e/output/hideseek-end.png' });
// After the results, the bar goes.
await timeUp();
await page.waitForFunction(() => !window.__hs.s && !document.getElementById('hs-bar'), null, { timeout: 5000 }).catch(() => {});
check('the results clear by themselves', await ev(() => !!document.getElementById('hs-bar')), !(await ev(() => !!document.getElementById('hs-bar'))));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
