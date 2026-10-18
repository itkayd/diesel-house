import { chromium } from 'playwright-core';
// UPDATE.md Phase 12: the games corner and mini-games (Phase 13's table games: tests/e2e/table-games.mjs). Walking onto the hallway games table offers
// "Play games"; Dice shows on everyone's screen; Quick Draw runs a full 5-round game between a desktop and a
// phone player (early tap = out, fair seed check, under the 60-message budget), and carries on when the
// host leaves; rock-paper-scissors duel from the friend menu with sealed picks, crown for the winner.
// Dev test mode (its own house and public game channels; nothing is saved to game_results).
const browser = await chromium.launch({ channel: 'msedge', headless: true });
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
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 900, height: 700 } });
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

const A = await player('Ann games');
const B = await player('Ben phone', true);
await at(A, 723, 525); // the hall's games table
await at(B, 732, 527);
await sees(A, B);
await sees(B, A);

// 1. The spot: "Play games", E opens the games table.
{
  const prompt = await A.page.waitForSelector('#game-prompt', { timeout: 3000 }).then(() => true, () => false);
  const label = await A.page.locator('#game-prompt').textContent().catch(() => null);
  await A.page.keyboard.press('e');
  const open = await A.page.waitForSelector('#games', { timeout: 3000 }).then(() => true, () => false);
  const list = await A.page.evaluate(() => [...document.querySelectorAll('#games [data-game]')].map((b) => [b.dataset.game, b.disabled]));
  check('at the games table: "Play games · E", E opens the panel with all 6 games', { prompt, label, open, list },
    prompt && /Play games/.test(label ?? '') && open && list.length === 6 && list.every(([, d]) => !d));
  await at(A, 520, 520);
  await A.page.waitForTimeout(400);
  const closed = !(await A.page.locator('#games').count()) && !(await A.page.locator('#game-prompt').count());
  check('walking away closes the panel and the prompt', { closed }, closed);
  await at(A, 723, 525);
  await A.page.waitForSelector('#game-prompt', { timeout: 3000 });
}

// 2. Dice: B (phone) rolls; both screens show the same dice over B's head.
{
  await B.page.waitForSelector('#game-prompt', { timeout: 3000 });
  await B.page.tap('#game-prompt');
  await B.page.tap('#games [data-game="dice"]');
  await B.page.tap('#dice-roll');
  await B.page.waitForFunction(() => !!window.__house.me.dice, null, { timeout: 4000 });
  const mine = await B.page.evaluate(() => window.__house.me.dice);
  const theirs = await A.page.waitForFunction((id) => window.__house.remotes.get(id)?.avatar.dice, B.id, { timeout: 3000 }).then((h) => h.jsonValue(), () => null);
  const shown = await B.page.locator('#dice-result').textContent();
  check('dice: the roll lands over the roller’s head on both screens, and in the panel', { mine, theirs, shown }, Array.isArray(mine) && mine.length === 2 && JSON.stringify(mine) === JSON.stringify(theirs) && shown.startsWith(String(mine[0] + mine[1])));
  const parsed = await B.page.evaluate(async () => {
    const { parseRoll } = await import('/src/games/dice.ts');
    return ['/roll', '/roll 2d6', '/roll d20', '/roll 3', '/roll 99d6', 'hello'].map((t) => parseRoll(t));
  });
  check('/roll, /roll 2d6, /roll d20 and /roll 3 are understood; too many dice and normal text are not', { parsed },
    JSON.stringify(parsed) === JSON.stringify([{ n: 2, sides: 6 }, { n: 2, sides: 6 }, { n: 1, sides: 20 }, { n: 3, sides: 6 }, null, null]));
  await B.page.tap('#games-back');
}

// 3. Quick Draw, A hosts, B on a phone. Round 1: B taps too soon. Then A is always quicker.
let gameSent;
{
  await A.page.keyboard.press('e');
  await A.page.click('#games [data-game="quickdraw"]');
  await B.page.tap('#games [data-game="quickdraw"]');
  await A.page.waitForFunction(() => /Start with 2/.test(document.getElementById('qd-start')?.textContent ?? ''), null, { timeout: 6000 });
  const s0 = (await sent(A, 'game')) + (await sent(B, 'game'));
  await A.page.click('#qd-start');
  for (let round = 1; round <= 5; round++) {
    await A.page.waitForFunction((r) => document.getElementById('qd-note')?.textContent?.startsWith(`Round ${r} `), round, { timeout: 15000 });
    if (round === 1) {
      await B.page.waitForSelector('#qd-box.ready', { timeout: 10000 });
      await B.page.tap('#qd-box');
      const foul = await B.page.locator('#qd-box').textContent();
      check('quick draw: tapping before DRAW! is too soon', { foul }, /Too soon/.test(foul ?? ''));
    }
    await A.page.waitForSelector('#qd-box.go', { timeout: 10000 });
    await A.page.click('#qd-box');
    if (round > 1) {
      await B.page.waitForSelector('#qd-box.go', { timeout: 3000 });
      await B.page.waitForTimeout(150);
      await B.page.tap('#qd-box');
    }
  }
  await Promise.all([A, B].map((p) => p.page.waitForSelector('#qd-box[data-fair]', { timeout: 15000 })));
  gameSent = (await sent(A, 'game')) + (await sent(B, 'game')) - s0;
  const end = await Promise.all([A, B].map((p) => p.page.evaluate(() => ({ title: document.querySelector('#qd-box b')?.textContent, fair: document.getElementById('qd-box').dataset.fair, rows: [...document.querySelectorAll('#qd-list .v2-board-row')].map((r) => r.textContent) }))));
  check('quick draw: 5 rounds, A wins on both screens, the waits match the sealed seed', { end }, end[0].title === 'You win!' && end[1].title === 'Ann games wins' && end.every((e) => e.fair === 'true') && /15 pts/.test(end[0].rows[0]));
  check('quick draw: a whole game uses fewer than 60 Realtime messages', { sent: gameSent }, gameSent < 60);
}

// 4. Host leaves mid-game: with C at the table too, A starts, then closes the page; B carries on.
{
  const C = await player('Cat games');
  await at(C, 716, 527);
  await sees(C, A);
  await C.page.waitForSelector('#game-prompt', { timeout: 3000 });
  await C.page.click('#game-prompt');
  await C.page.click('#games [data-game="quickdraw"]').catch(() => {});
  await A.page.waitForFunction(() => /Play again|Start with 3/.test(document.getElementById('qd-start')?.textContent ?? ''), null, { timeout: 8000 });
  await A.page.waitForFunction(() => window.__house.games.tables.get('hall').people.length === 3, null, { timeout: 8000 });
  await A.page.click('#qd-start');
  await C.page.waitForFunction(() => document.getElementById('qd-note')?.textContent?.startsWith('Round 1 '), null, { timeout: 8000 });
  await A.ctx.close(); // the host goes
  const took = await B.page.waitForFunction(() => window.__house.games.tables.get('hall').isHost, null, { timeout: 15000 }).then(() => true, () => false);
  // B and C play it out (B quicker).
  let rounds = 0;
  for (let i = 0; i < 6; i++) {
    const done = await C.page.evaluate(() => !!document.querySelector('#qd-box[data-fair]'));
    if (done) break;
    const go = await Promise.all([B, C].map((p) => p.page.waitForSelector('#qd-box.go', { timeout: 15000 }).then(() => true, () => false)));
    if (!go.every(Boolean)) break;
    await B.page.tap('#qd-box');
    await C.page.waitForTimeout(100);
    await C.page.click('#qd-box');
    rounds++;
    await C.page.waitForFunction(() => !document.querySelector('#qd-box.go'), null, { timeout: 8000 }).catch(() => {});
  }
  const end = await C.page.waitForSelector('#qd-box[data-fair]', { timeout: 20000 }).then(() => C.page.evaluate(() => ({ title: document.querySelector('#qd-box b')?.textContent, players: document.querySelectorAll('#qd-list .v2-board-row').length })), () => null);
  check('host leaves mid-game: the next player takes over and the game finishes for everyone left', { took, rounds, end }, took && end?.title === 'Ben phone wins' && end.players === 2);
  await C.ctx.close();
}

// 5. Rock paper scissors: B challenges D from the friend menu; D accepts; sealed picks; B wins 2-0.
{
  const D = await player('Dan duel');
  await at(D, 520, 520);
  await at(B, 550, 520);
  await sees(B, D);
  await B.page.tap('#games-close').catch(() => {});
  await B.page.waitForTimeout(800);
  const spot = await B.page.evaluate((id) => {
    const h = window.__house;
    const s = h.remotes.get(id).avatar.sprite;
    const cam = h.cameras.main;
    const c = h.game.canvas.getBoundingClientRect();
    return { x: c.left + (s.x - cam.worldView.x) * cam.zoom, y: c.top + (s.y - 12 - cam.worldView.y) * cam.zoom };
  }, D.id);
  await B.page.touchscreen.tap(spot.x, spot.y);
  await B.page.waitForSelector('#friend-duel:not([disabled])', { timeout: 3000 });
  const d0 = (await sent(B, 'duel')) + (await sent(D, 'duel'));
  await B.page.tap('#friend-duel');
  await D.page.waitForSelector('#duel-accept', { timeout: 5000 });
  await D.page.click('#duel-accept');
  await Promise.all([B, D].map((p) => p.page.waitForSelector('#duel', { timeout: 5000 })));
  for (let round = 1; round <= 2; round++) {
    await B.page.waitForSelector('#duel [data-hand="rock"]:not([disabled])', { timeout: 5000 });
    await B.page.tap('#duel [data-hand="rock"]');
    await D.page.waitForFunction(() => /has picked/.test(document.getElementById('duel-status')?.textContent ?? ''), null, { timeout: 5000 });
    const sealed = await D.page.evaluate(() => document.getElementById('duel-theirs').className.includes('hidden'));
    if (round === 1) check('duel: D is told B has picked, but not what', { sealed }, sealed);
    await D.page.click('#duel [data-hand="scissors"]');
    await Promise.all([B, D].map((p) => p.page.waitForFunction((r) => (document.getElementById('duel').querySelectorAll('.v2-score')[0]?.textContent ?? '') !== '' && /beats/.test(document.getElementById('duel-result')?.textContent ?? '') && (r === 2 || true), round, { timeout: 5000 })));
    if (round === 1) await B.page.waitForTimeout(1800);
  }
  const results = await Promise.all([B, D].map((p) => p.page.waitForFunction(() => /duel/.test(document.getElementById('duel-result')?.textContent ?? ''), null, { timeout: 5000 }).then(() => p.page.locator('#duel-result').textContent())));
  const crown = await D.page.waitForFunction((id) => window.__house.remotes.get(id)?.avatar.crowned, B.id, { timeout: 4000 }).then(() => true, () => false);
  const n = (await sent(B, 'duel')) + (await sent(D, 'duel')) - d0;
  check('duel: best of 3, B wins 2-0 on both screens, crown over B for everyone, about 15 messages', { results, crown, sent: n }, results[0] === 'You win the duel!' && results[1] === 'Ben phone wins the duel' && crown && n <= 20);
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
if (res.some((r) => r.startsWith('FAIL')) || errors.length) process.exitCode = 1;
