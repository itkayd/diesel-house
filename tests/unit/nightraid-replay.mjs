// Night Raid runs replay to the same score (api/arcade.ts relies on it). Run: node --experimental-strip-types tests/unit/nightraid-replay.mjs
import { NightRaid, RunLog, TICK, encodeInput, decodeInput, replay, dsin, rng } from '../../src/games/nightRaidGame.ts';

let fails = 0;
const ok = (cond, what, info = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${info ? `  -> ${info}` : ''}`);
  if (!cond) fails++;
};

// Plays a game the way the phone does (fixed steps, a bot dodging about, Ults when ready), recording it.
function play(seed, style) {
  const r = rng(seed * 7 + 1);
  const g = new NightRaid(seed);
  const rec = new RunLog();
  const input = { left: false, right: false, targetX: null };
  let ticks = 0;
  while (!g.over && ticks < 60 * 60 * 20) {
    if (style === 'finger') {
      if (r() < 0.2) input.targetX = r() < 0.05 ? null : g.x + (r() - 0.5) * 60 + r() * 0.37; // fractional, like a real finger
    } else if (r() < 0.05) {
      input.left = r() < 0.5;
      input.right = !input.left && r() < 0.7;
    }
    const code = encodeInput(input);
    rec.input(ticks, code);
    if (g.ultReady && r() < 0.02) {
      rec.ult(ticks);
      g.useUlt();
    }
    g.step(TICK, decodeInput(code));
    ticks++;
  }
  return { g, rec, ticks };
}

for (const [seed, style] of [[12345, 'finger'], [987654321, 'keys'], [42, 'finger'], [2147483647, 'keys']]) {
  const { g, rec, ticks } = play(seed, style);
  const t0 = performance.now();
  const r = replay(seed, rec.log, ticks + 1);
  const ms = performance.now() - t0;
  ok(r.over && r.score === g.score && r.ticks === ticks && r.waves === g.wave && r.unread === 0, `seed ${seed} (${style}): the replay gets the same score`, `${g.score} in ${ticks} steps (${Math.round(ticks / 60)} s of game), replayed in ${Math.round(ms)} ms, log ${rec.log.length} numbers`);
}

// A changed record doesn't give the same score.
{
  const { g, rec, ticks } = play(777, 'finger');
  const bent = rec.log.slice();
  for (let i = 1; i < bent.length; i += 2) if (bent[i] <= 180) bent[i] = 90; // stand still in the middle
  const r = replay(777, bent, ticks + 1);
  ok(!(r.over && r.score === g.score && r.ticks === ticks), 'a changed record doesn’t replay to the claimed score', `claimed ${g.score}, replay ${r.score} over=${r.over}`);
  const other = replay(778, rec.log, ticks + 1);
  ok(!(other.over && other.score === g.score && other.ticks === ticks), 'another seed doesn’t give the same game');
}

// The game's own sine matches Math.sin closely (it only has to be the same everywhere, not exact).
let worst = 0;
for (let x = -50; x < 50; x += 0.0137) worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)));
ok(worst < 1e-9, 'dsin is a true sine', `worst error ${worst.toExponential(2)}`);

process.exit(fails ? 1 : 0);
