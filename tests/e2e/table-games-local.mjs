import { chromium } from 'playwright-core';
// UPDATE.md Phase 13, offline: plays Higher or lower, Would you rather and Four in a row end to end in one
// page (tests/e2e/harness.html), with each player's real game screen and the hosts talking through
// tests/e2e/fakeTable.ts instead of Supabase. Checks turns, secret votes, spectators, the host leaving
// mid-game, the fair-seed check, the results the host would save, and the message budget (< 60 a round).
// Needs `npm run dev`. Uses Edge like the other tests; set DH_CHROMIUM to a Chromium path to use that.
// The same games over real Realtime between two browsers: tests/e2e/table-games.mjs.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

async function harness(viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
  await page.goto('http://localhost:5173/tests/e2e/harness.html');
  await page.waitForFunction(() => !!window.harness);
  return page;
}
const sent = (page) => page.evaluate(() => window.harness.ch.sent);
const until = (page, f, arg, timeout = 15000) => page.waitForFunction(f, arg, { timeout });

// ---- Higher or lower ----------------------------------------------------------------------------
{
  const page = await harness();
  await page.evaluate(() => {
    const h = window.harness;
    for (const [id, n] of [['A', 'Ann'], ['B', 'Ben'], ['C', 'Cat']]) h.join(id, n, 'higherlower');
    h.start('A', 'higherlower', ['A', 'B', 'C']);
  });
  await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #hl-card`)));
  const first = await page.evaluate(() => ({
    cards: ['A', 'B', 'C'].map((p) => document.querySelector(`#p-${p} #hl-card`).dataset.card),
    buttons: ['A', 'B', 'C'].map((p) => !!document.querySelector(`#p-${p} #hl-hi`)),
    turn: document.querySelector('#p-B #hl-turn').textContent,
  }));
  check('higher or lower: everyone sees the same card; only the player whose turn it is gets the buttons', first,
    new Set(first.cards).size === 1 && JSON.stringify(first.buttons) === '[true,false,false]' && /Ann's turn/.test(first.turn));

  // Play: guess sensibly; bank after two right guesses. Count messages per round of turns.
  const s0 = await sent(page);
  let perRound = [];
  let lastRoundStart = s0;
  let lastRound = 1;
  let leftAt = null;
  for (let step = 0; step < 200; step++) {
    const st = await page.evaluate(() => {
      const t = [...window.harness.tables.values()][0];
      const s = t.snap;
      return { phase: s.state.phase, turnNo: s.state.turnNo, n: s.players.length, cur: s.players[s.state.turnNo % s.players.length]?.id, rid: s.state.rid, pot: s.state.pot, card: s.state.card, host: s.host };
    });
    if (st.phase === 'done') break;
    const round = Math.floor(st.turnNo / st.n) + 1;
    if (round !== lastRound) {
      const now = await sent(page);
      perRound.push(now - lastRoundStart);
      lastRoundStart = now;
      lastRound = round;
    }
    // Midway, the host (Ann) gets up and leaves: Ben carries on as host.
    if (st.turnNo === 4 && !leftAt) {
      leftAt = st.turnNo;
      await page.evaluate(() => window.harness.leave('A'));
      await until(page, () => window.harness.tables.get('B').isHost);
      continue;
    }
    const value = st.card % 13 === 0 ? 14 : (st.card % 13) + 1;
    const sel = st.pot >= 3 ? `#p-${st.cur} #hl-bank` : `#p-${st.cur} #hl-${value <= 8 ? 'hi' : 'lo'}`;
    await page.waitForSelector(`${sel}:not([disabled])`, { timeout: 5000 });
    await page.click(sel);
    await until(page, ([rid]) => [...window.harness.tables.values()].every((t) => t.snap.state.rid > rid), [st.rid]);
  }
  await until(page, () => ['B', 'C'].every((p) => document.querySelector(`#p-${p} #hl-fair[data-fair]`)), null, 10000);
  const end = await page.evaluate(() => ({
    fair: ['B', 'C'].map((p) => document.querySelector(`#p-${p} #hl-fair`).dataset.fair),
    titles: ['B', 'C'].map((p) => document.querySelector(`#p-${p} .v2-hl-acts .v2-result`).textContent),
    points: window.harness.tables.get('B').snap.state.points,
    records: window.harness.records,
  }));
  const top = Math.max(...Object.values(end.points));
  const winners = Object.keys(end.points).filter((id) => end.points[id] === top && top > 0);
  check('higher or lower: host leaves mid-game, Ben takes over, the game finishes with a fair deck on both screens', { fair: end.fair, titles: end.titles },
    end.fair.every((f) => f === 'true') && end.titles.every((t) => t.length > 0));
  check('higher or lower: one result saved, winners = top score', { records: end.records.length, winners: end.records[0]?.winners, expected: winners },
    end.records.length === 1 && JSON.stringify([...end.records[0].winners].sort()) === JSON.stringify(winners.sort()) && !!end.records[0].seed);
  check('higher or lower: every round of turns under 60 messages', { perRound }, perRound.length >= 1 && perRound.every((n) => n < 60));
  await page.context().close();
}

// ---- Would you rather ---------------------------------------------------------------------------
{
  const page = await harness();
  const own = ['Live on a boat|Live in a castle'];
  await page.evaluate((own) => {
    const h = window.harness;
    for (const [id, n] of [['A', 'Ann'], ['B', 'Ben'], ['C', 'Cat'], ['D', 'Dan']]) h.join(id, n, 'wyr', own);
    h.start('A', 'wyr', ['A', 'B', 'C', 'D'], own);
  }, own);
  await until(page, () => ['A', 'B', 'C', 'D'].every((p) => document.querySelector(`#p-${p} #wyr-a`)));
  const card = await page.evaluate(() => document.querySelector('#p-B #wyr-card').textContent);
  check('would you rather: round 1 is the room’s own prompt', { card }, /this room’s/.test(card) && /boat/.test(card) && /castle/.test(card));
  const s0 = await sent(page);
  // Round 1: A, B, C pick A; D picks B. Before everyone has voted nobody sees anybody's pick.
  await page.click('#p-A #wyr-a');
  await page.click('#p-B #wyr-a');
  await until(page, () => /voted/.test(document.querySelector('#p-D #wyr-list').textContent));
  const secret = await page.evaluate(() => ({
    bars: document.querySelectorAll('#p-D .v2-side .bar').length,
    status: document.querySelector('#p-C #wyr-status').textContent,
    state: JSON.stringify(window.harness.tables.get('D').snap.state),
  }));
  check('would you rather: while voting, others only see who has voted, never what', secret, secret.bars === 0 && !/"votes"/.test(secret.state) && /Pick one/.test(secret.status));
  await page.click('#p-C #wyr-a');
  await page.click('#p-D #wyr-b');
  await until(page, () => document.querySelectorAll('#p-D .v2-side .bar').length === 2);
  const reveal = await page.evaluate(() => ({
    counts: [...document.querySelectorAll('#p-B .v2-side .n')].map((n) => n.dataset.count),
    faces: [...document.querySelectorAll('#p-B .v2-side')].map((s) => s.getAttribute('aria-label')),
    mine: document.querySelector('#p-D #wyr-status').textContent,
    yours: document.querySelector('#p-A #wyr-status').textContent,
  }));
  const round1 = (await sent(page)) - s0;
  check('would you rather: the reveal shows 3 vs 1 with names, majority +1', reveal,
    JSON.stringify(reveal.counts) === '["3","1"]' && /Ann/.test(reveal.faces[0]) && /You/.test(reveal.faces[0]) && /Dan/.test(reveal.faces[1]) && /minority/.test(reveal.mine) && /majority: \+1/.test(reveal.yours));
  check('would you rather: one prompt with 4 players stays under 60 messages', { sent: round1 }, round1 < 60);

  // Round 2: the host (Ann) leaves mid-vote; voting starts again under Ben.
  await until(page, () => /Prompt 2 /.test(document.querySelector('#p-B #wyr-note').textContent), null, 15000);
  await page.click('#p-C #wyr-b');
  await until(page, () => window.harness.tables.get('C').snap.state.voted.includes('C'));
  await page.evaluate(() => window.harness.leave('A'));
  await until(page, () => { const s = window.harness.tables.get('C').snap; return s.host === 'B' && s.state.voted.length === 0; });
  const again = await page.evaluate(() => !document.querySelector('#p-C #wyr-b').disabled);
  check('would you rather: the host leaves mid-vote, Ben takes over and the vote reopens', { again }, again);
  // Play out the rest: everyone picks A.
  for (let round = 2; round <= 5; round++) {
    await until(page, (r) => new RegExp(`Prompt ${r} `).test(document.querySelector('#p-B #wyr-note').textContent), round, 20000);
    for (const p of ['B', 'C', 'D']) {
      await page.waitForSelector(`#p-${p} #wyr-a:not([disabled])`, { timeout: 5000 });
      await page.click(`#p-${p} #wyr-a`);
    }
    await until(page, () => document.querySelectorAll('#p-C .v2-side .bar').length === 2);
  }
  await until(page, () => !!document.querySelector('#p-C #wyr-result'), null, 20000);
  const end = await page.evaluate(() => ({ title: document.querySelector('#p-C #wyr-result').textContent, records: window.harness.records, points: window.harness.tables.get('C').snap.state.points }));
  check('would you rather: 5 prompts, then a winner; Ben (host) saves the result once', end,
    end.records.length === 1 && end.records[0].game === 'wyr' && end.points.B === 5 && end.points.C === 5 && /Shared win/.test(end.title));
  await page.context().close();
}

// ---- Four in a row ------------------------------------------------------------------------------
{
  const page = await harness();
  await page.evaluate(() => {
    const h = window.harness;
    for (const [id, n] of [['A', 'Ann'], ['B', 'Ben'], ['C', 'Cat']]) h.join(id, n, 'four');
    h.start('A', 'four', ['A', 'B']);
  });
  await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #four-grid`)));
  const s0 = await sent(page);
  // Each player drops in their own column: whoever goes first gets four up first.
  let moves = 0;
  for (; moves < 10; moves++) {
    const st = await page.evaluate(() => { const s = window.harness.tables.get('A').snap; return { phase: s.state.phase, cur: s.players[s.state.turn].id, rid: s.state.rid, first: s.players[0].id }; });
    if (st.phase === 'done') break;
    if (moves === 0) {
      const spectator = await page.evaluate(() => ({ enabled: document.querySelectorAll('#p-C #four-grid .col:not([disabled])').length, status: document.getElementById('p-C').querySelector('#four-status').textContent }));
      const other = st.cur === 'A' ? 'B' : 'A';
      const waiting = await page.evaluate((o) => document.querySelectorAll(`#p-${o} #four-grid .col:not([disabled])`).length, other);
      check('four in a row: only the player to move can drop; Cat watches', { spectator, waiting }, spectator.enabled === 0 && /watching/.test(spectator.status) && waiting === 0);
    }
    const col = st.cur === 'A' ? 2 : 4;
    await page.click(`#p-${st.cur} #four-grid .col[data-col="${col}"]`);
    await until(page, (rid) => ['A', 'B', 'C'].every((p) => window.harness.tables.get(p).snap.state.rid > rid), st.rid);
  }
  const end = await page.evaluate(() => {
    const s = window.harness.tables.get('C').snap;
    return { winner: s.state.winner, line: s.state.line, status: ['A', 'B', 'C'].map((p) => document.querySelector(`#p-${p} #four-status`).textContent), blinking: document.querySelectorAll('#p-C .v2-piece.win').length, records: window.harness.records };
  });
  const n = (await sent(page)) - s0;
  check('four in a row: four in a column wins on every screen, line lit for the spectator', end,
    moves === 7 && end.line?.length === 4 && end.blinking === 4 && end.status.filter((t) => t === 'You win!').length === 1 && /wins/.test(end.status[2]) && end.records.length === 1 && end.records[0].winners[0] === end.winner);
  check('four in a row: the game used under 60 messages', { sent: n }, n < 60);

  // Host leaves mid-game: Ben (the other player) takes over and wins.
  await page.evaluate(() => window.harness.start('A', 'four', ['A', 'B']));
  await until(page, () => window.harness.tables.get('C').snap.state.phase === 'play' && window.harness.tables.get('C').snap.state.moves === 0);
  await page.evaluate(() => window.harness.leave('A'));
  await until(page, () => window.harness.tables.get('C').snap.state.phase === 'done');
  const left = await page.evaluate(() => ({ status: document.querySelector('#p-C #four-status').textContent, mine: document.querySelector('#p-B #four-status').textContent, records: window.harness.records.length }));
  check('four in a row: the host leaves mid-game, so Ben wins and the result is saved', left, /Ann left · Ben wins/.test(left.status) && left.mine === 'Ann left · You win!' && left.records === 2);
  await page.context().close();
}

// ---- Phone width: nothing spills sideways ---------------------------------------------------------
{
  const page = await harness({ width: 360, height: 760 });
  await page.evaluate(() => {
    const h = window.harness;
    h.join('A', 'Ann', 'four');
    h.join('B', 'Ben', 'four');
    h.start('A', 'four', ['A', 'B']);
  });
  await until(page, () => !!document.querySelector('#p-A #four-grid'));
  await page.evaluate(() => document.querySelectorAll('.player').forEach((p) => (p.style.width = 'auto')));
  const fits = await page.evaluate(() => {
    const g = document.querySelector('#p-A #four-grid').getBoundingClientRect();
    return { right: Math.round(g.right), width: window.innerWidth, scroll: document.documentElement.scrollWidth };
  });
  check('phone (360 px): the Four in a row board fits without sideways scrolling', fits, fits.right <= fits.width && fits.scroll <= fits.width);
  await page.screenshot({ path: 'output/table-games-phone.png', fullPage: false }).catch(() => {});
  await page.context().close();
}

// ---- Dice panel ------------------------------------------------------------------------------
{
  const page = await harness({ width: 390, height: 800 });
  const names = await page.evaluate(async () => {
    const { rollName } = await import('/src/games/dice.ts');
    return [[1, 1], [6, 6], [3, 3], [2, 5], [4, 4, 4], [2, 3, 4], [5], [1, 6, 2]].map((v) => rollName(v));
  });
  check('dice: snake eyes, boxcars, doubles, triples and runs are named', names,
    JSON.stringify(names) === JSON.stringify(['Snake eyes!', 'Boxcars!', 'Doubles!', null, 'Triples!', 'A run!', null, null]));
  await page.evaluate(async () => {
    localStorage.removeItem('diesel-house.dice');
    const { diceView } = await import('/src/games/dice.ts');
    window.rolls = [];
    const col = document.createElement('div');
    col.className = 'player dh-panel';
    col.append(diceView((r) => window.rolls.push(r)));
    document.getElementById('players').append(col);
  });
  await page.click('#dice-count [data-n="3"]');
  await page.click('#dice-faces');
  await until(page, () => window.rolls.length === 1);
  await page.waitForTimeout(700);
  await page.click('#dice-roll');
  await until(page, () => window.rolls.length === 2);
  const got = await page.evaluate(() => ({
    n: window.rolls.map((r) => r.values.length),
    faces: document.querySelectorAll('#dice-faces .v2-die').length,
    result: document.getElementById('dice-result').textContent,
    total: window.rolls[1].total,
    history: [...document.querySelectorAll('#dice-history .v2-xpchip')].map((c) => c.textContent),
    saved: localStorage.getItem('diesel-house.dice'),
  }));
  check('dice: pick 3 dice (remembered), tap the tray or Roll, total shown, last rolls listed newest first', got,
    got.n.join() === '3,3' && got.faces === 3 && got.result.startsWith(String(got.total)) && got.history.length === 2 && got.history[0] === String(got.total) && got.saved === '3');
  await page.context().close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
