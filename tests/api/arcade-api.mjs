// The score checker (api/arcade.ts) with the real SQL behind it (the local test database from
// supabase/tests/run.sh): a real run is replayed and saved; a changed score, a changed record, a sped-up
// game, someone else's run and a reused run are all refused, and show on the admin page.
// Run: supabase/tests/run.sh first, then  node tests/api/arcade-api.mjs
import { createServer } from 'vite';
import { NightRaid, RunLog, TICK, decodeInput, encodeInput, rng } from '../../src/games/nightRaidGame.ts';
import { fakeDb, sql } from './fakeDb.mjs';

const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);

const ME = '00000000-0000-0000-0000-0000000000d1';
const OTHER = '00000000-0000-0000-0000-0000000000d2';
for (const [id, email, name] of [[ME, 'raid@members.diesel-house.invalid', 'Raider'], [OTHER, 'raid2@members.diesel-house.invalid', 'Other']]) {
  sql(`insert into auth.users (id, email) values ('${id}', '${email}') on conflict do nothing`, 'postgres');
  sql(`insert into public.allowed_emails (email) values ('${email}') on conflict do nothing`, 'postgres');
  sql(`insert into public.profiles (id, display_name, character_index) values ('${id}', '${name}', 1) on conflict do nothing`, 'postgres');
}
sql(`delete from public.arcade_runs where user_id in ('${ME}', '${OTHER}')`, 'postgres');

// A run as the player: the database hands out the seed.
function startRun(who, email) {
  const r = sql(
    `select set_config('request.jwt.claims', '{"sub":"${who}","email":"${email}"}', false), set_config('request.jwt.claim.sub', '${who}', false); select public.arcade_start('nightraid')`,
    'authenticated',
  );
  return r.data;
}
// Plays it like the phone does (a bot that chases spooks and dodges a bit).
function play(seed) {
  const r = rng(seed ^ 0x5555);
  const g = new NightRaid(seed);
  const rec = new RunLog();
  let ticks = 0;
  while (!g.over && ticks < 60 * 60 * 30) {
    const near = g.fire.find((f) => f.y > 230 && Math.abs(f.x - g.x) < 12);
    const target = near ? g.x + (near.x < g.x ? 30 : -30) : (g.enemies[Math.floor(r() * Math.max(1, g.enemies.length))]?.x ?? g.x) + r();
    const code = encodeInput({ left: false, right: false, targetX: target });
    rec.input(ticks, code);
    if (g.ultReady && r() < 0.05) {
      rec.ult(ticks);
      g.useUlt();
    }
    g.step(TICK, decodeInput(code));
    ticks++;
  }
  return { score: g.score, waves: g.wave, ticks, log: rec.log };
}
const backdate = (run, seconds) => sql(`update public.arcade_runs set started_at = now() - make_interval(secs => ${seconds}) where id = '${run}'`, 'postgres');

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
const { handle } = await vite.ssrLoadModule('/api/arcade.ts');
const db = fakeDb({ users: { 'tok-me': { id: ME }, 'tok-other': { id: OTHER } } });
async function submit(body, token = 'tok-me') {
  const r = await handle(new Request('https://house.example/api/arcade', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), {}, { db });
  return { status: r.status, body: await r.json() };
}

// 1. A real run.
const t1 = startRun(ME, 'raid@members.diesel-house.invalid');
const g1 = play(t1.seed);
backdate(t1.run, Math.ceil(g1.ticks / 60) + 5);
const ok1 = await submit({ run: t1.run, seed: t1.seed, ...g1 });
check('a real run is replayed on the server and saved', { score: g1.score, saved: ok1.body.score, ok: ok1.body.ok }, ok1.body.ok === true && ok1.body.score === g1.score);
const reuse = await submit({ run: t1.run, seed: t1.seed, ...g1 });
check('the same run can’t be sent twice', reuse.body, reuse.body.ok === false && reuse.body.why === 'used');

// 2. A changed score.
const t2 = startRun(ME, 'raid@members.diesel-house.invalid');
const g2 = play(t2.seed);
backdate(t2.run, Math.ceil(g2.ticks / 60) + 5);
const bump = await submit({ run: t2.run, seed: t2.seed, ...g2, score: g2.score * 10 });
check('a run claiming 10× its score is rejected', bump.body, bump.body.ok === false && bump.body.why === 'rejected');

// 3. A made-up record (moves changed).
const t3 = startRun(ME, 'raid@members.diesel-house.invalid');
const g3 = play(t3.seed);
backdate(t3.run, Math.ceil(g3.ticks / 60) + 5);
const bent = g3.log.slice();
for (let i = 1; i < bent.length; i += 2) if (bent[i] <= 180) bent[i] = 180 - bent[i];
const changed = await submit({ run: t3.run, seed: t3.seed, ...g3, log: bent });
check('a run whose moves were changed is rejected', changed.body, changed.body.ok === false);

// 4. A sped-up game: 2 minutes of game sent 10 s after it started.
const t4 = startRun(ME, 'raid@members.diesel-house.invalid');
const g4 = play(t4.seed);
backdate(t4.run, 3);
const fast = await submit({ run: t4.run, seed: t4.seed, ...g4 });
check('a game played faster than real time is rejected', { game_s: Math.round(g4.ticks / 60), real_s: 3, why: fast.body.why }, fast.body.ok === false && fast.body.why === 'rejected');

// 5. Someone else's run.
const t5 = startRun(OTHER, 'raid2@members.diesel-house.invalid');
const g5 = play(t5.seed);
backdate(t5.run, Math.ceil(g5.ticks / 60) + 5);
const theirs = await submit({ run: t5.run, seed: t5.seed, ...g5 }, 'tok-me');
check('a run that isn’t yours is refused', theirs, theirs.body.ok === false);
const noAuth = await submit({ run: t5.run, seed: t5.seed, ...g5 }, 'nope');
check('no sign-in, no score', noAuth.status, noAuth.status === 401);

// 6. The admin page sees why.
const flags = sql(`select jsonb_agg(reason order by finished_at) from public.arcade_runs where user_id = '${ME}' and status = 'rejected'`, 'postgres').data;
check('rejected runs are kept with the reason, for the admin page', flags, Array.isArray(flags) && flags.length === 3 && flags.some((f) => /scored/.test(f)) && flags.some((f) => /in 3 s/.test(f)));

await vite.close();
console.log(res.join('\n'));
process.exitCode = res.some((r) => r.startsWith('FAIL')) ? 1 : 0;
