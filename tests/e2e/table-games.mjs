import { chromium } from 'playwright-core';
// UPDATE.md Phase 13 over real Realtime: Higher or lower, Would you rather and Four in a row at the hallway
// games table, between a desktop player (Ann) and a phone player (Ben), with Cat watching Four in a row.
// Each game is played to the end on both screens, stays under 60 game messages a round, and Four in a row
// ends cleanly when its host leaves. Dev test mode (its own house and public game channels; nothing is
// saved to game_results). The offline version with host hand-overs for every game: table-games-local.mjs.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge', headless: true });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];
process.on('uncaughtException', async (e) => {
  console.log(res.join('\n'));
  console.log('CRASH', e.stack);
  await browser.close();
  process.exit(1);
});
async function player(name, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 900, height: 800 } });
  await ctx.addInitScript((n) => {
    localStorage.setItem('diesel-house.name', n);
    localStorage.setItem('diesel-house.character', '16');
  }, name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(name + ' console: ' + m.text()));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.presence?.channel?.state === 'joined');
  return { name, ctx, page, phone, id: await page.evaluate(() => window.__house.presence.id) };
}
const at = (p, x, y) => p.page.evaluate(([x, y]) => { window.__house.body.reset(x, y); window.__house.sendMove(true); }, [x, y]);
const sees = (p, other) => p.page.waitForFunction((id) => { const r = window.__house.remotes.get(id); return r?.active && r.avatar.sprite.visible; }, other.id, { timeout: 15000 });
const sent = (p, kind) => p.page.evaluate((k) => window.__house.msgStats.totals[`sent:${k}`] ?? 0, kind);
const click = (p, sel) => (p.phone ? p.page.tap(sel) : p.page.click(sel));
const snap = (p) => p.page.evaluate(() => { const s = window.__house.games.tables.get('hall')?.snap; return s ? { game: s.game, host: s.host, players: s.players.map((x) => x.id), state: s.state } : null; });
const gameSent = async (...ps) => (await Promise.all(ps.map((p) => sent(p, 'game')))).reduce((a, b) => a + b, 0);

const A = await player('Ann tables');
const B = await player('Ben phone', true);
await at(A, 83, 282); // the hallway games table
await at(B, 92, 284);
await sees(A, B);
await sees(B, A);
for (const p of [A, B]) {
  await p.page.waitForSelector('#game-prompt', { timeout: 5000 });
  await click(p, '#game-prompt');
  await p.page.waitForSelector('#games', { timeout: 3000 });
}
const pick = async (game) => {
  for (const p of [A, B]) {
    if (await p.page.locator('#games-back').count()) await click(p, '#games-back');
    await click(p, `#games [data-game="${game}"]`);
  }
};

// 1. Higher or lower: Ann hosts. Guess sensibly until the game ends.
{
  await pick('higherlower');
  await A.page.waitForFunction(() => /Start with 2/.test(document.getElementById('hl-start')?.textContent ?? ''), null, { timeout: 8000 });
  const s0 = await gameSent(A, B);
  await A.page.click('#hl-start');
  await B.page.waitForSelector('#hl-card', { timeout: 5000 });
  for (let i = 0; i < 40; i++) {
    const s = await snap(A);
    if (s.state.phase === 'done') break;
    const cur = s.players[s.state.turnNo % s.players.length] === A.id ? A : B;
    const v = s.state.card % 13 === 0 ? 14 : (s.state.card % 13) + 1;
    const sel = s.state.pot >= 3 ? '#hl-bank' : v <= 8 ? '#hl-hi' : '#hl-lo';
    await cur.page.waitForSelector(`${sel}:not([disabled])`, { timeout: 8000 });
    await click(cur, sel);
    await A.page.waitForFunction((rid) => window.__house.games.tables.get('hall').snap.state.rid > rid, s.state.rid, { timeout: 8000 });
  }
  const fair = await Promise.all([A, B].map((p) => p.page.waitForSelector('#hl-fair[data-fair]', { timeout: 10000 }).then(() => p.page.locator('#hl-fair').getAttribute('data-fair'), () => null)));
  const n = (await gameSent(A, B)) - s0;
  check('higher or lower: a full game (3 rounds) on desktop and phone, fair deck on both', { fair, sent: n }, fair.every((f) => f === 'true'));
  check('higher or lower: under 60 game messages a round (3 rounds)', { sent: n, perRound: n / 3 }, n / 3 < 60);
}

// 2. Would you rather: 5 prompts, both vote; Ben's vote stays secret until Ann votes.
{
  await pick('wyr');
  await A.page.waitForFunction(() => /Start with 2/.test(document.getElementById('wyr-start')?.textContent ?? ''), null, { timeout: 8000 });
  const s0 = await gameSent(A, B);
  await A.page.click('#wyr-start');
  for (let round = 1; round <= 5; round++) {
    await Promise.all([A, B].map((p) => p.page.waitForFunction((r) => new RegExp(`Prompt ${r} `).test(document.getElementById('wyr-note')?.textContent ?? '') && !document.querySelector('#wyr-a')?.disabled, round, { timeout: 20000 })));
    await click(B, '#wyr-b');
    if (round === 1) {
      await A.page.waitForFunction(() => /voted/.test(document.getElementById('wyr-list')?.textContent ?? ''), null, { timeout: 5000 });
      const leak = await A.page.evaluate(() => JSON.stringify(window.__house.games.tables.get('hall').snap.state).includes('"votes"') || document.querySelectorAll('.v2-side .bar').length > 0);
      check('would you rather: Ann sees Ben has voted, not what', { leak }, !leak);
    }
    await click(A, round % 2 ? '#wyr-b' : '#wyr-a');
    await Promise.all([A, B].map((p) => p.page.waitForFunction(() => document.querySelectorAll('.v2-side .bar').length === 2, null, { timeout: 8000 })));
  }
  const end = await Promise.all([A, B].map((p) => p.page.waitForSelector('#wyr-result', { timeout: 20000 }).then(() => p.page.locator('#wyr-result').textContent(), () => null)));
  const n = (await gameSent(A, B)) - s0;
  check('would you rather: 5 prompts, reveal on both screens, Ann wins 3-2… or a share', { end }, end.every(Boolean));
  check('would you rather: under 60 game messages a prompt', { sent: n, perPrompt: n / 5 }, n / 5 < 60);
}

// 3. Four in a row: Ann vs Ben, Cat watches. Each drops in their own column; first to move wins.
{
  const C = await player('Cat watches');
  await at(C, 76, 284);
  await sees(C, A);
  await pick('four');
  await C.page.waitForSelector('#game-prompt', { timeout: 5000 });
  await C.page.click('#game-prompt');
  await C.page.click('#games [data-game="four"]');
  await A.page.waitForFunction(() => window.__house.games.tables.get('hall').people.length === 3, null, { timeout: 8000 });
  const lobby = await A.page.evaluate(() => document.querySelectorAll('#four-lobby .v2-item').length);
  const s0 = await gameSent(A, B, C);
  await A.page.click('#four-start');
  await C.page.waitForSelector('#four-grid', { timeout: 5000 });
  const watching = await C.page.evaluate(() => ({ enabled: document.querySelectorAll('#four-grid .col:not([disabled])').length }));
  for (let i = 0; i < 9; i++) {
    const s = await snap(A);
    if (s.state.phase === 'done') break;
    const cur = s.players[s.state.turn] === A.id ? A : B;
    await cur.page.waitForSelector('#four-grid .col:not([disabled])', { timeout: 8000 });
    await click(cur, `#four-grid .col[data-col="${cur === A ? 1 : 5}"]`);
    await A.page.waitForFunction((rid) => window.__house.games.tables.get('hall').snap.state.rid > rid, s.state.rid, { timeout: 8000 });
  }
  const status = await Promise.all([A, B, C].map((p) => p.page.waitForFunction(() => /win/.test(document.getElementById('four-status')?.textContent ?? ''), null, { timeout: 8000 }).then(() => p.page.locator('#four-status').textContent(), () => null)));
  const n = (await gameSent(A, B, C)) - s0;
  check('four in a row: 2 play, Cat watches (no moves), the win shows on all three screens', { lobby, watching, status },
    lobby === 2 && watching.enabled === 0 && status.filter((t) => t === 'You win!').length === 1 && /wins/.test(status[2] ?? ''));
  check('four in a row: a game under 60 game messages', { sent: n }, n < 60);

  // Host leaves mid-game: Ben wins, Cat sees it.
  await A.page.waitForSelector('#four-start.v2-again:not([disabled])', { timeout: 5000 });
  await A.page.click('#four-start');
  await C.page.waitForFunction(() => window.__house.games.tables.get('hall').snap?.state.moves === 0 && window.__house.games.tables.get('hall').snap?.state.phase === 'play', null, { timeout: 8000 });
  await A.ctx.close();
  const left = await Promise.all([B, C].map((p) => p.page.waitForFunction(() => /left/.test(document.getElementById('four-status')?.textContent ?? ''), null, { timeout: 20000 }).then(() => p.page.locator('#four-status').textContent(), () => null)));
  check('four in a row: the host leaves mid-game; Ben is told he wins, Cat sees it', { left }, left[0] === 'Ann tables left · You win!' && /Ann tables left · Ben phone wins/.test(left[1] ?? ''));
  await C.ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
