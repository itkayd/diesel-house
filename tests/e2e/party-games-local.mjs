import { chromium } from 'playwright-core';
// G3, offline: plays Quiz night, Letter rush, Liar's dice and Sketch & guess end to end in one page
// (tests/e2e/harness.html), three players with their real game screens, the hosts talking through
// tests/e2e/fakeTable.ts instead of Supabase. Checks scoring, secrets (answers, dice, the word), the
// thumbs-down vote, a cup that doesn't match its seal, drawing reaching the others, near-miss guesses,
// players leaving, the fair-seed checks and the results the host would save.
// Needs `npm run dev`. Set DH_CHROMIUM to a Chromium path (otherwise Edge).
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

async function harness() {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
  await page.goto('http://localhost:5173/tests/e2e/harness.html');
  await page.waitForFunction(() => !!window.harness);
  return page;
}
const until = (page, f, arg, timeout = 20000) => page.waitForFunction(f, arg, { timeout });
const snap = (page, id = 'A') => page.evaluate((id) => window.harness.tables.get(id).snap, id);
const setup = (page, game) =>
  page.evaluate((game) => {
    const h = window.harness;
    for (const [id, n] of [['A', 'Ann'], ['B', 'Ben'], ['C', 'Cat']]) h.join(id, n, game);
    h.start('A', game, ['A', 'B', 'C']);
  }, game);

// ---- Quiz night --------------------------------------------------------------------------------
{
  const page = await harness();
  await setup(page, 'quiz');
  await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #quiz-0`)));
  const secret = await page.evaluate(() => ({ right: window.harness.tables.get('A').snap.state.right, picks: window.harness.tables.get('A').snap.state.picks }));
  check('quiz: the right answer and the picks are not in the snapshot while asking', secret, secret.right === undefined && secret.picks === undefined);
  let first = null;
  for (let round = 1; round <= 8; round++) {
    await until(page, (r) => window.harness.tables.get('A').snap.state.round === r && window.harness.tables.get('A').snap.state.phase === 'ask', round);
    const right = await page.evaluate(() => {
      const t = window.harness.tables.get('A');
      return t.host.qs[t.snap.state.round - 1].right;
    });
    // Ann right first, Ben wrong, Cat right second.
    await page.click(`#p-A #quiz-${right}:not([disabled])`);
    await until(page, () => window.harness.tables.get('A').snap.state.answered.includes('A'));
    await page.click(`#p-B #quiz-${(right + 1) % 4}:not([disabled])`);
    await until(page, () => window.harness.tables.get('A').snap.state.answered.includes('B'));
    await page.click(`#p-C #quiz-${right}:not([disabled])`);
    await until(page, (r) => window.harness.tables.get('A').snap.state.phase === 'reveal' && window.harness.tables.get('A').snap.state.round === r, round);
    if (round === 1) {
      await until(page, () => document.querySelector('#p-B .v2-quiz-opt.right'));
      first = await page.evaluate(() => ({
        gained: window.harness.tables.get('A').snap.state.gained,
        bStatus: document.querySelector('#p-B #quiz-status').textContent,
        rightShown: ['A', 'B', 'C'].map((p) => !!document.querySelector(`#p-${p} .v2-quiz-opt.right`)),
      }));
    }
  }
  check('quiz: first right answer 3, second 2, wrong 0; everyone sees the right answer', first, first.gained.A === 3 && first.gained.C === 2 && !first.gained.B && first.rightShown.every(Boolean) && /Not this time/.test(first.bStatus));
  await until(page, () => document.querySelector('#p-B #quiz-fair[data-fair]'), null, 15000);
  const end = await page.evaluate(() => ({
    points: window.harness.tables.get('A').snap.state.points,
    fair: document.querySelector('#p-B #quiz-fair').dataset.fair,
    title: document.querySelector('#p-B #quiz-result').textContent,
    rec: window.harness.records.find((r) => r.game === 'quiz'),
  }));
  check('quiz: 8 questions, Ann wins 24-16-0, the seed checks out, the result is saved', { points: end.points, fair: end.fair, title: end.title, winners: end.rec?.winners },
    end.points.A === 24 && end.points.C === 16 && end.points.B === 0 && end.fair === 'true' && /Ann wins/.test(end.title) && JSON.stringify(end.rec?.winners) === '["A"]' && !!end.rec?.seed);
  await page.context().close();
}

// ---- Letter rush -------------------------------------------------------------------------------
{
  const page = await harness();
  await setup(page, 'letters');
  await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #lr-in-3`)));
  const L = (await page.textContent('#p-A #lr-letter')).trim().toLowerCase();
  // Ann: four good answers. Ben: the same first answer as Ann, then one with the wrong letter. Cat: nothing.
  const ann = [`${L}ollipop`, `${L}ighthouse`, `${L}antern one`, `${L}ucky dip`];
  for (let i = 0; i < 4; i++) await page.fill(`#p-A #lr-in-${i}`, ann[i]);
  await page.fill('#p-B #lr-in-0', ann[0].toUpperCase());
  await page.fill('#p-B #lr-in-1', L === 'q' ? 'xylophone' : 'qwerty');
  await page.click('#p-A #lr-done');
  await until(page, () => window.harness.tables.get('B').snap.state.done.includes('A'));
  const hidden = await page.evaluate(() => ({ answers: window.harness.tables.get('B').snap.state.answers, chips: document.querySelector('#p-B #lr-list').textContent }));
  check('letter rush: answers stay secret until everyone is done (others just see "done")', hidden, hidden.answers === undefined && /done/.test(hidden.chips));
  await page.click('#p-B #lr-done');
  await page.click('#p-C #lr-done');
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'judge');
  await until(page, () => document.querySelector('#p-C [data-down="A:1"]'));
  // Cat rules out Ann's second answer.
  await page.click('#p-C [data-down="A:1"]');
  await until(page, () => (window.harness.tables.get('B').snap.state.downs?.['A:1'] ?? []).includes('C'));
  const judging = await page.evaluate(() => ({
    outInB: document.querySelector('#p-B [data-key="A:1"]').classList.contains('out'),
    ownButton: !!document.querySelector('#p-A [data-down^="A:"]'),
    wrongLetterOut: document.querySelector('#p-A [data-key="B:1"]').classList.contains('out'),
  }));
  check('letter rush: a thumbs-down from half the others rules an answer out; no voting on your own; a wrong first letter is out', judging, judging.outInB && !judging.ownButton && judging.wrongLetterOut);
  for (const p of ['A', 'B', 'C']) await page.click(`#p-${p} #lr-ok`);
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'result');
  const r1 = await page.evaluate(() => window.harness.tables.get('A').snap.state.got);
  check('letter rush: shared answer 1 each, unique 2, ruled out 0', r1, JSON.stringify(r1.A) === '[1,0,2,2]' && JSON.stringify(r1.B) === '[1,0,0,0]' && JSON.stringify(r1.C) === '[0,0,0,0]');
  // Two quick rounds with nothing written.
  for (let round = 2; round <= 3; round++) {
    await until(page, (r) => window.harness.tables.get('A').snap.state.round === r && window.harness.tables.get('A').snap.state.phase === 'write', round, 15000);
    await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #lr-done:not([disabled])`)));
    for (const p of ['A', 'B', 'C']) await page.click(`#p-${p} #lr-done`);
    await until(page, () => window.harness.tables.get('A').snap.state.phase === 'judge');
    for (const p of ['A', 'B', 'C']) await page.click(`#p-${p} #lr-ok`);
  }
  await until(page, () => document.querySelector('#p-C #lr-fair[data-fair]'), null, 15000);
  const end = await page.evaluate(() => ({ points: window.harness.tables.get('A').snap.state.points, fair: document.querySelector('#p-C #lr-fair').dataset.fair, rec: window.harness.records.find((r) => r.game === 'letters') }));
  check('letter rush: 3 rounds, Ann wins 5-1-0, the seed checks out, the result is saved', end, end.points.A === 5 && end.points.B === 1 && end.fair === 'true' && JSON.stringify(end.rec?.winners) === '["A"]');
  await page.context().close();
}

// ---- Liar's dice -------------------------------------------------------------------------------
{
  const page = await harness();
  await setup(page, 'liars');
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'bid');
  const sealed = await page.evaluate(() => {
    const st = window.harness.tables.get('A').snap.state;
    const v = window.harness.views;
    return { seals: Object.keys(st.seals).length, mine: ['A', 'B', 'C'].map((p) => v.get(p).myDice?.length), shownB: document.querySelectorAll('#p-B [data-player="A"] .v2-die').length };
  });
  check('liar’s dice: everyone rolls 5 dice on their own phone and sends only a seal', sealed, sealed.seals === 3 && sealed.mine.every((n) => n === 5) && JSON.stringify(sealed).indexOf('"dice":[') === -1);
  const blank = await page.evaluate(() => document.querySelector('#p-B [data-player="A"] .v2-die').style.backgroundPosition);
  // Ann opens with the lowest bid; Ben calls Liar. Cat swaps a die after sealing (a cheat).
  await page.evaluate(() => {
    const m = window.harness.views.get('C').mine;
    m.dice = m.dice.map((d) => (d === 6 ? 5 : 6));
  });
  await page.click('#p-A #ld-go:not([disabled])');
  await until(page, () => window.harness.tables.get('B').snap.state.turn === 'B');
  await until(page, () => document.querySelector('#p-B #ld-liar:not([disabled])'));
  const turnB = await page.evaluate(() => ({ aHasMoves: !!document.querySelector('#p-A #ld-go'), bHasLiar: !!document.querySelector('#p-B #ld-liar:not([disabled])') }));
  check('liar’s dice: only the player whose turn it is can bid or call; other cups stay hidden', { turnB, blank }, !turnB.aHasMoves && turnB.bHasLiar && blank.startsWith('-132px'));
  await page.click('#p-B #ld-liar');
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'reveal');
  const rev = await page.evaluate(() => {
    const st = window.harness.tables.get('A').snap.state;
    return { shown: Object.fromEntries(Object.entries(st.shown).map(([k, v]) => [k, v.length])), loser: st.loser, count: st.count, cheat: !!document.querySelector('#p-A [data-player="C"] .cheat'), status: document.querySelector('#p-A #ld-status').textContent };
  });
  check('liar’s dice: cups go up; a cup that doesn’t match its seal counts for nothing and costs its owner the die', rev, rev.shown.A === 5 && rev.shown.B === 5 && rev.shown.C === 0 && rev.loser === 'C' && rev.cheat && /Cat loses a die/.test(rev.status));
  await until(page, () => window.harness.tables.get('A').snap.state.round === 2 && window.harness.tables.get('A').snap.state.phase === 'bid', null, 20000);
  const r2 = await page.evaluate(() => {
    const st = window.harness.tables.get('A').snap.state;
    return { dice: st.dice, turn: st.turn, cMine: window.harness.views.get('C').myDice?.length };
  });
  check('liar’s dice: the loser has 4 dice next round and starts the bidding', r2, r2.dice.C === 4 && r2.turn === 'C' && r2.cMine === 4);
  // An honest round: Cat bids, Ann calls; check the count against everyone's real dice.
  await page.click('#p-C #ld-more');
  await page.click('#p-C #ld-more');
  await page.click('#p-C #ld-go:not([disabled])');
  await until(page, () => document.querySelector('#p-A #ld-liar:not([disabled])'));
  await page.click('#p-A #ld-liar');
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'reveal' && window.harness.tables.get('A').snap.state.round === 2);
  const honest = await page.evaluate(() => {
    const st = window.harness.tables.get('A').snap.state;
    const dice = ['A', 'B', 'C'].map((p) => window.harness.views.get(p).myDice).flat();
    const f = st.call.bid.f;
    const real = dice.filter((d) => d === f || d === 1).length;
    return { bid: st.call.bid, count: st.count, real, loser: st.loser, expected: real >= st.call.bid.q ? 'A' : 'C' };
  });
  check('liar’s dice: the count includes 1s as wild, and the right player loses', honest, honest.count === honest.real && honest.loser === honest.expected);
  // Ben and Cat get up: Ann is the last one with dice.
  await page.evaluate(() => {
    window.harness.leave('B');
    window.harness.leave('C');
  });
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'done');
  const end = await page.evaluate(() => ({ winner: window.harness.tables.get('A').snap.state.winner, title: document.querySelector('#p-A #ld-result')?.textContent, rec: window.harness.records.find((r) => r.game === 'liars') }));
  check('liar’s dice: when the others leave, the last one with dice wins; the result is saved', end, end.winner === 'A' && /You win/.test(end.title ?? '') && JSON.stringify(end.rec?.winners) === '["A"]');
  await page.context().close();
}

// ---- Sketch & guess ----------------------------------------------------------------------------
{
  const page = await harness();
  await setup(page, 'sketch');
  await until(page, () => ['A', 'B', 'C'].every((p) => document.querySelector(`#p-${p} #sk-canvas`)));
  const word = await page.evaluate(() => window.harness.tables.get('A').host.words[0]);
  const shown = await page.evaluate(() => ({
    a: document.querySelector('#p-A #sk-word b').textContent,
    b: document.querySelector('#p-B #sk-word b').textContent,
    aTools: !document.querySelector('#p-A #sk-tools').hidden,
    bTools: !document.querySelector('#p-B #sk-tools').hidden,
    aGuess: !document.querySelector('#p-A .v2-sk-guess').hidden,
  }));
  check('sketch: the artist sees the word and the tools; the others see blanks and a guess box', { ...shown, word },
    shown.a === word && shown.b.replace(/\s/g, '').replace(/_/g, '').length === 0 && shown.aTools && !shown.bTools && !shown.aGuess);
  // Ann draws a line.
  const box = await page.locator('#p-A #sk-canvas').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 10, box.y + 30 + i * 6);
  await page.mouse.up();
  await until(page, () => window.harness.tables.get('B').snap.state.strokes.length > 0);
  const inked = await page.evaluate(() => {
    const c = document.querySelector('#p-B #sk-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  check('sketch: the drawing reaches the other players', { inked }, inked > 200);
  // Ben guesses wrong (everyone sees it); Cat is one letter off (only Cat and Ann see the text).
  await page.fill('#p-B #sk-input', 'definitely not it');
  await page.press('#p-B #sk-input', 'Enter');
  await until(page, () => window.harness.tables.get('A').snap.state.feed.length === 1);
  const near = word.length >= 3 ? word.slice(0, -1) + (word.endsWith('z') ? 'y' : 'z') : word + 'zz';
  await page.waitForTimeout(650);
  await page.fill('#p-C #sk-input', near);
  await page.press('#p-C #sk-input', 'Enter');
  await until(page, () => window.harness.tables.get('A').snap.state.feed.length === 2);
  await page.waitForTimeout(100);
  const feeds = await page.evaluate(() => ['A', 'B', 'C'].map((p) => document.querySelector(`#p-${p} #sk-feed`).textContent));
  check('sketch: wrong guesses show for everyone; a near miss shows its text only to the guesser and the artist', feeds,
    feeds.every((f) => /definitely not it/.test(f)) && /so close/.test(feeds[2]) && /so close/.test(feeds[0]) && !feeds[1].includes(near) && !/so close/.test(feeds[1]));
  await page.fill('#p-B #sk-input', word.toUpperCase());
  await page.press('#p-B #sk-input', 'Enter');
  await until(page, () => window.harness.tables.get('A').snap.state.got.includes('B'));
  await page.waitForTimeout(650);
  await page.fill('#p-C #sk-input', ` ${word} `);
  await page.press('#p-C #sk-input', 'Enter');
  await until(page, () => window.harness.tables.get('A').snap.state.phase === 'reveal');
  const r1 = await page.evaluate(() => window.harness.tables.get('A').snap.state.gained);
  check('sketch: first right guess 3, second 2, the artist 1 per right guess; it ends when everyone has it', r1, r1.B === 3 && r1.C === 2 && r1.A === 2);
  // The other five drawings: the two guessers get it straight away.
  for (let round = 2; round <= 6; round++) {
    await until(page, (r) => window.harness.tables.get('A').snap?.state.round === r && window.harness.tables.get('A').snap.state.phase === 'draw', round, 15000);
    const st = await snap(page);
    const w = await page.evaluate(() => {
      const t = [...window.harness.tables.values()].find((t) => t.isHost);
      return t.host.words[t.snap.state.round - 1];
    });
    for (const p of ['A', 'B', 'C'].filter((p) => p !== st.state.artist)) {
      await page.waitForSelector(`#p-${p} #sk-input:not([hidden])`).catch(() => {});
      await page.fill(`#p-${p} #sk-input`, w);
      await page.press(`#p-${p} #sk-input`, 'Enter');
      await page.waitForTimeout(80);
    }
  }
  await until(page, () => document.querySelector('#p-A #sk-fair[data-fair]'), null, 20000);
  const end = await page.evaluate(() => ({ points: window.harness.tables.get('A').snap.state.points, fair: document.querySelector('#p-A #sk-fair').dataset.fair, rec: window.harness.records.find((r) => r.game === 'sketch') }));
  check('sketch: 6 drawings with 3 players (each draws twice), the seed checks out, the result is saved', end, end.fair === 'true' && !!end.rec && Object.values(end.points).reduce((a, b) => a + b, 0) === 6 * 7);
  await page.context().close();
}

console.log(res.join('\n'));
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
process.exitCode = res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0;
