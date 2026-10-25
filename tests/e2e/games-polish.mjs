import { chromium } from 'playwright-core';
// UX-RULES U5 (games polish), in one page: a second player (Ben) is seated at the hallway table by hand
// (no Realtime needed). Checks the ready step ("Ben is in for Four in a row · Join", In / Not in yet in
// the lobby, only people who are in get dealt in), a full Four in a row game with Ben's moves fed to the
// host, the end-of-game line (place, record tonight), Rematch with the same players, cheers (ours and
// Ben's float over the game), and that going back to the list takes us out of the game.
// Needs `npm run dev`. Set DH_CHROMIUM to a Chromium path to use that instead of Edge.
const browser = await chromium.launch(process.env.DH_CHROMIUM ? { executablePath: process.env.DH_CHROMIUM } : { channel: 'msedge' });
const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);
const errors = [];

// Feeds moves to the host until the game ends: Ann in column 0, Ben in column 1.
const playOut = (page) =>
  page.evaluate(async () => {
    const g = window.__house.games;
    const t = g.tables.get('hall');
    for (let i = 0; i < 20; i++) {
      const st = t.snap.state;
      if (st.phase === 'done') break;
      const who = t.snap.players[st.turn].id;
      g.host.onAction(who, { t: 'drop', col: who === t.id ? 0 : 1, rid: st.rid });
      await new Promise((r) => setTimeout(r, 30));
    }
    await new Promise((r) => setTimeout(r, 100));
    return { phase: t.snap.state.phase, winner: t.snap.state.winner === null ? null : t.snap.state.winner === t.id };
  });

for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => {
    localStorage.setItem('diesel-house.name', 'Ann');
    localStorage.setItem('diesel-house.character', 'ninja.villager2');
    localStorage.setItem('diesel-house.mic-ok', '1');
    localStorage.setItem('diesel-house.guide-seen', '1');
    localStorage.setItem('diesel-house.rules-seen', '["four"]');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto('http://localhost:5173/?test');
  await page.waitForFunction(() => window.__house?.games && window.__house.spots, null, { timeout: 30000 });
  // Stand at the hallway games table (walking away closes the panel).
  await page.evaluate(() => {
    const h = window.__house;
    const s = h.spots.spots.find((x) => x.id === 'hall');
    h.body.reset(s.x, s.y);
    h.player.setPosition(s.x, s.y);
  });
  await page.waitForSelector('#game-prompt', { timeout: 8000 });

  // Ann opens the hallway table; Ben sits down there too and opens Four in a row.
  await page.evaluate(() => {
    const g = window.__house.games;
    g.open('hall');
    const t = g.tables.get('hall');
    t.present.set(t.id, { ...t.seat(), at: 1 });
    t.present.set('ben', { id: 'ben', name: 'Ben', character: t.seat().character, at: 2 });
    t.present.set('cat', { id: 'cat', name: 'Cat', character: t.seat().character, at: 3 });
    t.h.onPeople(t.people);
    t.ready.set('ben', 'four');
    t.h.onReady();
  });
  const banner = await page.locator('#games [data-waiting="four"]').textContent().catch(() => null);
  check(`${label}: the list says "Ben is in for Four in a row" with Join`, { banner }, /Ben is in for Four in a row/.test(banner ?? '') && /Join/.test(banner ?? ''));

  await page.click('#join-four');
  const lobby = await page.evaluate(() => {
    const t = window.__house.games.tables.get('hall');
    return {
      rows: [...document.querySelectorAll('#four-lobby .v2-item')].map((r) => [r.dataset.player, r.textContent]),
      start: document.querySelector('#four-start')?.textContent,
      disabled: document.querySelector('#four-start')?.disabled,
      meIn: t.isReady(t.id, 'four'),
    };
  });
  check(`${label}: lobby: Ann and Ben are In, Cat is Not in yet; Start with 2 players`, lobby,
    lobby.meIn && lobby.rows.length === 3 && /In$/.test(lobby.rows[0][1]) && lobby.rows[1][0] === 'ben' && /In$/.test(lobby.rows[1][1]) && lobby.rows[2][0] === 'cat' && /Not in yet/.test(lobby.rows[2][1]) && /Start with 2 players/.test(lobby.start ?? '') && !lobby.disabled);

  await page.click('#four-start');
  await page.waitForFunction(() => window.__house.games.tables.get('hall').snap?.game === 'four');
  const players = await page.evaluate(() => window.__house.games.tables.get('hall').snap.players.map((p) => p.id));
  check(`${label}: only the people who were in are dealt in (Cat watches)`, { players }, players.length === 2 && players[1] === 'ben');

  // Play it out: Ann in column 0, Ben in column 1, until someone has four.
  const end = await playOut(page);
  const after = await page.evaluate(() => ({
    summary: document.querySelector('#games-summary')?.textContent,
    again: document.querySelector('#four-start.v2-again')?.textContent,
    cheers: document.querySelectorAll('#games-cheers button').length,
  }));
  check(`${label}: the game ends with four in a row`, end, end.phase === 'done' && end.winner !== null);
  check(`${label}: end line: "Tonight: N wins from 1"; Rematch · 2 players; cheers under the game`, after,
    new RegExp(`Tonight: ${end.winner ? '1 win' : '0 wins'} from 1`).test(after.summary ?? '') && /Rematch · 2 players/.test(after.again ?? '') && after.cheers === 4);

  // Cheers: ours, then Ben's, float over the game.
  await page.click('#games-cheers button');
  await page.evaluate(() => window.__house.games.tables.get('hall').h.onCheer('ben', '🔥'));
  const floats = await page.evaluate(() => [...document.querySelectorAll('#games .v2-cheer')].map((f) => f.textContent));
  check(`${label}: cheers float up, with who sent them`, { floats }, floats.some((f) => f.includes('👏') && f.includes('You')) && floats.some((f) => f.includes('🔥') && f.includes('Ben')));

  // Ben leaves the table: Rematch waits for a second player.
  await page.evaluate(() => {
    const t = window.__house.games.tables.get('hall');
    t.ready.delete('ben');
    t.h.onReady();
  });
  const waiting = await page.locator('#four-start.v2-again').textContent();
  check(`${label}: with Ben not in any more, Rematch waits for a second player`, { waiting }, /Waiting for a second player/.test(waiting));

  // Rematch with Ben back in: a new game with the same two.
  await page.evaluate(() => {
    const t = window.__house.games.tables.get('hall');
    t.ready.set('ben', 'four');
    t.h.onReady();
  });
  await page.click('#four-start.v2-again');
  const re = await page.evaluate(() => {
    const s = window.__house.games.tables.get('hall').snap;
    return { phase: s.state.phase, players: s.players.map((p) => p.id), gen: s.gen };
  });
  check(`${label}: Rematch starts a new game with the same players`, re, re.phase === 'play' && re.players.length === 2 && re.players[1] === 'ben' && re.gen === 2);

  if (label === 'phone') await page.screenshot({ path: 'tests/e2e/output/games-polish-phone.png' });
  // Finish the rematch, then back to the list: we're not in for anything any more.
  await playOut(page);
  const two = await page.locator('#games-summary').textContent();
  check(`${label}: after the rematch the record says 2 played`, { two }, /from 2/.test(two));
  await page.click('#games-back');
  const out = await page.evaluate(() => {
    const t = window.__house.games.tables.get('hall');
    return t.isReady(t.id, 'four');
  });
  check(`${label}: back on the list, Ann isn't in for a game any more`, { out }, out === false);
  await ctx.close();
}

console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(res.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
