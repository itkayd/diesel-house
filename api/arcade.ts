// Vercel function: POST /api/arcade, a finished Night Raid run -> the saved score.
// The phone sends the run's record (what the player did on each of the game's 60-a-second steps). This plays
// the same game again, with the seed the database chose when the run started, and saves the score that
// comes out (supabase/migrations/20261113_arcade_verified.sql). There's no limit on how good a score can
// be; a score that a real game didn't produce is rejected and listed on the admin page:
//  - the replay ends on a different score, or not at game over, or after a different number of steps
//    (a changed game, or a made-up record);
//  - the run took less real time than the game it claims (a sped-up game);
//  - the run isn't this player's, or was already used.
import { replay, ULT, W, NONE, RIGHT } from '../src/games/nightRaidGame.js';
import { adminDb, json, type Env } from './_server.js';

type Db = NonNullable<ReturnType<typeof adminDb>>;
type Body = { run?: unknown; log?: unknown; score?: unknown; waves?: unknown; ticks?: unknown };

const MAX_LOG = 4_000_000; // numbers (two per input change): far more than hours of play
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

// Steps in order, each code one the game makes.
function wellFormed(log: unknown[], ticks: number): log is number[] {
  if (log.length % 2) return false;
  let prev = 0;
  for (let i = 0; i < log.length; i += 2) {
    const t = log[i];
    const c = log[i + 1];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < prev || t >= ticks) return false;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || (c > W && c < NONE) || (c > RIGHT && c !== ULT)) return false;
    prev = t;
  }
  return true;
}

// `opts.db` lets the tests hand in a stand-in database (tests/api/).
export async function handle(request: Request, env: Env, opts: { db?: Db } = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = opts.db ?? adminDb(env);
  if (!db) return json({ error: 'Scores are switched off right now.' }, 503);
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const { data: who, error: authError } = await db.auth.getUser(token);
  if (authError || !who.user) return json({ error: 'Sign in first.' }, 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const runId = typeof body.run === 'string' && /^[0-9a-f-]{36}$/i.test(body.run) ? body.run : null;
  const claimed = int(body.score);
  const ticks = int(body.ticks);
  if (!runId || claimed === null || ticks === null || ticks < 1 || !Array.isArray(body.log) || body.log.length > MAX_LOG)
    return json({ ok: false, why: 'rejected' }, 400);

  const { data: run, error } = await db.from('arcade_runs').select('id, user_id, seed, status, started_at').eq('id', runId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!run || run.user_id !== who.user.id) return json({ ok: false, why: 'rejected' }, 404);
  if (run.status !== 'started') return json({ ok: false, why: 'used' });

  const realMs = Date.now() - new Date(run.started_at as string).getTime();
  const verdict = (ok: boolean, reason: string | null, r?: { score: number; waves: number; ticks: number }, flags: Record<string, unknown> | null = null) =>
    db.rpc('arcade_record', {
      run: runId,
      claimed,
      score: r?.score ?? 0,
      waves: r?.waves ?? 0,
      ticks: r?.ticks ?? ticks,
      real_ms: Math.min(realMs, 2_000_000_000),
      ok,
      reason,
      flags,
    });

  let why: string | null = null;
  let result: ReturnType<typeof replay> | undefined;
  if (!wellFormed(body.log, ticks)) why = 'the record is broken';
  else {
    result = replay(Number(run.seed), body.log, ticks + 1);
    if (!result.over) why = 'the replay didn’t end at game over';
    else if (result.ticks !== ticks) why = `the game ended after ${result.ticks} steps, not ${ticks}`;
    else if (result.score !== claimed) why = `the replay scored ${result.score}, not ${claimed}`;
    // Real time can't be shorter than the game (it's longer with pauses). A little slack for clocks.
    else if (realMs < (ticks * 1000) / 60 - 3000) why = `played ${Math.round(ticks / 60)} s of game in ${Math.round(realMs / 1000)} s`;
  }

  if (why) {
    const r = await verdict(false, why, result);
    if (r.error) return json({ error: r.error.message }, 500);
    return json({ ok: false, why: 'rejected' });
  }

  // Proven, so saved. A huge jump over the house record is still worth a look on the admin page.
  const { data: top } = await db.from('arcade_scores').select('score').eq('game', 'nightraid').order('score', { ascending: false }).limit(1);
  const record = (top?.[0]?.score as number | undefined) ?? 0;
  const flags = record >= 1000 && result!.score >= record * 3 ? { jump: `${(result!.score / record).toFixed(1)}× the house record` } : null;
  const r = await verdict(true, null, result, flags);
  if (r.error) return json({ error: r.error.message }, 500);
  return json(r.data);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}

export const maxDuration = 60; // a replay of a very long run still fits
