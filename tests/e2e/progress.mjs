import { chromium } from 'playwright-core';
// UPDATE.md Phase 14 + LEVELS.md on screen, on a phone: the level maths (same table as the SQL tests in
// supabase/tests/), the XP chip and Challenges button, the Challenges sheet, toasts and the level-up
// overlay (once, "Lv 22 → 24"), level and streak on the name tag (up to level 5,010), the profile's rank
// row and badges, and the noticeboard. The server's answer is fed in by hand (what record_events()
// returns), so this runs in dev test mode and without Supabase. Real XP is checked by the SQL tests.
const browser = await chromium.launch({ ...(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' }), headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('diesel-house.name', 'Leveller');
  localStorage.setItem('diesel-house.character', '5');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/?test');
await page.waitForFunction(() => !!window.__house?.player && !!document.getElementById('xp-chip'), null, { timeout: 20000 });

// 1. Level maths (LEVELS.md table and edges), identical to public.level_for_xp().
const maths = await page.evaluate(async () => {
  const L = await import('/src/challenges/levels.ts');
  const table = [[0, 1], [99, 1], [100, 2], [1000, 5], [4500, 10], [10500, 15], [19000, 20], [20999, 20], [21000, 21], [22999, 21], [23000, 22], [39000, 30], [79000, 50], [179000, 100], [10000000, 5010]];
  const bad = table.filter(([x, l]) => L.levelOf(x) !== l);
  let edges = true;
  for (let l = 2; l <= 6000; l++) if (L.levelOf(L.xpFor(l)) !== l || L.levelOf(L.xpFor(l) - 1) !== l - 1) edges = false;
  return { bad, edges, stars: [L.legendStars(49), L.legendStars(50), L.legendStars(100), L.legendStars(350)], rank: [1, 10, 29, 30, 50].map((l) => L.rankOf(l).title), p: L.progress(22500) };
});
check('levels: LEVELS.md table, every boundary to 6,000, ranks and Legend stars', maths,
  !maths.bad.length && maths.edges && JSON.stringify(maths.stars) === JSON.stringify(['', '★', '★★', '★ × 7']) && maths.rank.join() === 'Visitor,Housemate,Regular,Keyholder,Legend' && maths.p.intoLevel === 1500 && maths.p.levelSize === 2000);

// What record_events() sends back.
const result = (over = {}) => ({
  xp: 300, level: 3, level_before: 1, gained: 300, streak: 4, best_streak: 4, day: 'd:2026-10-17', week: 'w:2026-W42', week_xp: 300,
  completed: [{ id: 'd_emotes', title: 'Send 5 emotes', xp: 15 }],
  new_medals: [{ id: 'rank_visitor', xp: 0 }, { id: 'social', xp: 50 }],
  medals: [{ id: 'rank_visitor', at: '2026-10-17T10:00:00Z' }, { id: 'social', at: '2026-10-17T10:05:00Z' }],
  challenges: [
    { id: 'd_emotes', period: 'day', title: 'Send 5 emotes', goal: 5, xp: 15, progress: 5, done: true },
    { id: 'd_knock', period: 'day', title: 'Knock on a door and get let in', goal: 1, xp: 25, progress: 0, done: false },
    { id: 'd_voice', period: 'day', title: 'Spend 15 minutes in voice with 2+ friends', goal: 15, xp: 40, progress: 6, done: false },
    { id: 'w_rooms', period: 'week', title: 'Visit every room', goal: 8, xp: 150, progress: 3, done: false },
    { id: 'w_streak', period: 'week', title: 'Keep a 4-day streak', goal: 4, xp: 120, progress: 4, done: true },
    { id: 'w_qd', period: 'week', title: 'Win Quick Draw with a reaction under 250 ms', goal: 1, xp: 100, progress: 0, done: false },
  ],
  ...over,
});
const feed = (r) => page.evaluate((r) => window.__house.gotProgress(r), r);

// 2. First answer: chip, button with a dot, name tag. No level-up overlay on the very first answer from 1 → 1.
await feed(result({ level_before: 3, gained: 0, completed: [], new_medals: [] }));
const hud = await page.evaluate(() => ({
  chip: document.getElementById('xp-chip').textContent,
  level: document.getElementById('xp-chip').dataset.level,
  dot: !document.querySelector('#challenges-button .dh-badge-dot').hidden,
  tag: [window.__house.me.level, window.__house.me.streak],
  overlay: !!document.getElementById('level-up'),
}));
check('HUD: XP chip "Lv 3" with the streak, Challenges button with a dot, Lv 3 and streak 4 on your tag', hud, /Lv 3/.test(hud.chip) && /4/.test(hud.chip) && hud.level === '3' && hud.dot && hud.tag.join() === '3,4' && !hud.overlay);

// 3. Challenges sheet: Today and This week, done ones ticked.
await page.tap('#challenges-button');
await page.waitForSelector('#challenges');
const today = await page.evaluate(() => [...document.querySelectorAll('#challenges-list [data-challenge]')].map((r) => [r.dataset.challenge, r.classList.contains('done'), r.querySelector('.s').textContent]));
await page.tap('#challenges-tab-week');
const week = await page.evaluate(() => [...document.querySelectorAll('#challenges-list [data-challenge]')].map((r) => r.dataset.challenge));
check('Challenges: 3 for today (one done, 6 / 15 minutes), 3 this week', { today, week },
  today.length === 3 && today[0][1] === true && today.some((t) => t[2] === '6 / 15') && week.length === 3 && week.includes('w_rooms'));
await page.tap('#challenges-close');

// 4. Several level-ups at once: one overlay "Lv 22 → 24", toasts for the challenge and the medal, "!" over us.
await page.evaluate(() => {
  window.__seenToasts = [];
  new MutationObserver(() => document.querySelectorAll('#toasts .dh-toast').forEach((t) => window.__seenToasts.includes(t.textContent) || window.__seenToasts.push(t.textContent))).observe(document.getElementById('toasts'), { childList: true, subtree: true });
});
await feed(result({ xp: 25000, level: 24, level_before: 22, gained: 2015 }));
const emote = await page.evaluate(() => window.__house.me.emote);
await page.waitForSelector('#level-up', { timeout: 6000 });
const up = await page.evaluate(() => ({ text: document.querySelector('#level-up .n').textContent, overlays: document.querySelectorAll('#level-up').length }));
const toasts = await page.evaluate(() => window.__seenToasts);
check('level-up: shown once as "Lv 22 → 24", with challenge and medal toasts and "!" over your head', { up, toasts, emote },
  up.text === 'Lv 22 → 24' && up.overlays === 1 && toasts.some((t) => /Challenge done/.test(t)) && toasts.some((t) => /Social butterfly/.test(t) && /\+50 XP/.test(t)) && emote === 'exclamation');
await page.tap('#level-up-ok').catch(() => {});

// 5. No max level: 10,000,000 XP shows level 5,010 on the tag and the chip, and the chip still fits.
await feed(result({ xp: 10000000, level: 5010, level_before: 5010, gained: 0, completed: [], new_medals: [] }));
const big = await page.evaluate(() => {
  const c = document.getElementById('xp-chip').getBoundingClientRect();
  return { tag: window.__house.me.level, chip: document.getElementById('xp-chip').textContent, right: Math.round(c.right), width: innerWidth };
});
check('level 5,010: on the name tag and the chip ("Lv 5,010"), which still fits a 360 px phone', big, big.tag === 5010 && /Lv 5,010/.test(big.chip) && big.right <= big.width);

// 6. Profile: rank row (Legend with ★ × 100 stars → shown as "★ × 100"), badges earned / locked.
await page.evaluate(async () => {
  const { setUser } = await import('/src/net/profile.ts');
  setUser({ id: '00000000-0000-0000-0000-0000000000aa', email: 'test', guest: false, joinedAt: '2026-10-12T10:00:00Z', signedInAt: '2026-10-17T10:00:00Z' });
});
await feed(result({ xp: 179000, level: 100, level_before: 100, gained: 0, completed: [], new_medals: [], medals: [{ id: 'rank_visitor', at: 'x' }, { id: 'rank_housemate', at: 'x' }, { id: 'rank_regular', at: 'x' }, { id: 'rank_keyholder', at: 'x' }, { id: 'rank_landlord', at: 'x' }, { id: 'rank_legend', at: 'x' }, { id: 'social', at: 'x' }] }));
await page.evaluate(() => window.__house.openMyProfile());
await page.waitForSelector('#profile');
const chips = await page.locator('#profile-chips').textContent();
await page.tap('#profile-tab-badges');
const badges = await page.evaluate(() => ({
  ranks: [...document.querySelectorAll('#profile-ranks .v2-badge')].map((b) => [b.dataset.badge, !b.classList.contains('locked')]),
  legend: document.querySelector('#profile-ranks [data-badge="rank_legend"]').textContent,
  earned: [...document.querySelectorAll('.v2-badges .v2-badge:not(.locked)')].map((b) => b.dataset.badge),
  all: document.querySelectorAll('.v2-badges .v2-badge').length,
}));
check('profile: Lv 100 Legend ★★, all 6 rank medals, Legend shows ★★, 10 badges with Social butterfly earned', { chips, badges },
  /Lv 100/.test(chips) && /Legend ★★/.test(chips) && badges.ranks.length === 6 && badges.ranks.every(([, e]) => e) && /★★/.test(badges.legend) && badges.all === 10 && badges.earned.join() === 'social');
await page.tap('#profile-close');

// 7. Noticeboard: standing in front of it offers it; the board lists the week with ranks.
await page.evaluate(() => window.__house.body.reset(175, 240));
const prompt = await page.waitForSelector('#board-prompt', { timeout: 3000 }).then(() => true, () => false);
await page.evaluate(async () => {
  const { openNoticeboard } = await import('/src/ui/progressUi.ts');
  openNoticeboard([
    { user_id: 'a', display_name: 'Sami', character_index: 2, level: 31, xp_week: 1250, wins_week: 4, streak: 3, best_streak: 9 },
    { user_id: '00000000-0000-0000-0000-0000000000aa', display_name: 'Leveller', character_index: 5, level: 100, xp_week: 300, wins_week: 0, streak: 4, best_streak: 4 },
  ], '00000000-0000-0000-0000-0000000000aa', false, () => {});
});
const board = await page.evaluate(() => [...document.querySelectorAll('#board-list .v2-board-row')].map((r) => r.textContent));
check('noticeboard: "Noticeboard" offered at the board; this week’s XP with level and wins, you marked', { prompt, board },
  prompt && board.length === 2 && /Sami/.test(board[0]) && /1,250 XP/.test(board[0]) && /Lv 31/.test(board[0]) && /\(you\)/.test(board[1]));

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
