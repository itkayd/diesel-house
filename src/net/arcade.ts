import type { ArcadeResult, ArcadeRow } from '../games/nightRaid';
import { devTest } from './mode';
import type { Recorded } from './progress';
import { supabase } from './supabase';
import { logIssue } from './errors';

// Arcade scores (supabase/migrations/20261113_arcade_verified.sql): each run starts with a seed from the
// database; at game over the record of what you did goes to /api/arcade, which plays the run again and
// saves the score it gets. Any score a real game can reach counts (no limits for pro players), and
// nothing else does.
export type RunTicket = { run: string; seed: number };
export type RunRecord = { run: string; seed: number; log: number[]; score: number; waves: number; ticks: number };

// A run id + seed from the database. null: a guest, test mode, or no connection (the game still plays).
export async function startRun(): Promise<RunTicket | null> {
  if (!supabase || devTest) return null;
  try {
    const { data, error } = await supabase.rpc('arcade_start', { game: 'nightraid' });
    if (error) {
      logIssue('problem', 'Night Raid run could not start (its score can’t be saved)', { extra: { error: error.message } });
      return null;
    }
    const r = data as { ok: boolean; run?: string; seed?: number };
    return r.ok && r.run ? { run: r.run, seed: Number(r.seed) } : null;
  } catch {
    return null;
  }
}

export async function submitArcade(rec: RunRecord): Promise<ArcadeResult & { progress?: Recorded }> {
  if (!supabase || devTest) return { ok: false, why: 'offline' };
  const r = await send(rec);
  // No connection (or the server didn't answer): keep it on this phone and try again later.
  if (!r.ok && r.why === 'error') {
    logIssue('problem', 'Night Raid score could not be sent (kept on the phone to retry)', { extra: { score: rec.score, waves: rec.waves, ticks: rec.ticks } });
    queue({ ...rec, at: Date.now() });
    return { ok: false, why: 'queued' };
  }
  if (!r.ok && r.why === 'rejected') logIssue('warning', 'Night Raid run did not replay to the same score', { extra: { score: rec.score, ticks: rec.ticks } });
  return r;
}

async function send(rec: RunRecord): Promise<ArcadeResult & { progress?: Recorded }> {
  try {
    const { data } = await supabase!.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, why: 'error' };
    const res = await fetch('/api/arcade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(rec),
    });
    if (res.status >= 500 || res.status === 429) return { ok: false, why: 'error' };
    const r = (await res.json()) as ArcadeResult & { progress?: Recorded };
    if (r.ok && r.progress) r.progress = { ...r.progress, xp: Number(r.progress.xp), week_xp: Number(r.progress.week_xp) };
    return r;
  } catch (e) {
    console.warn('Could not save the score', e);
    return { ok: false, why: 'error' };
  }
}

// Runs that couldn't be sent (a dropped connection, the page closing) wait on this phone, for up to a
// week, and go to the server the next time the arcade opens. The server replays them like any other run.
const PENDING = 'diesel-house.arcade-runs-pending';
type Pending = RunRecord & { at: number };
function pending(): Pending[] {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as Pending[];
    return all.filter((p) => Date.now() - p.at < 7 * 86_400_000 && Array.isArray(p.log));
  } catch {
    return [];
  }
}
function savePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(list.slice(-3)));
  } catch {
    // private browsing or full: nothing kept
  }
}
function queue(p: Pending) {
  savePending([...pending(), p]);
}

// Send what's waiting (best first). Returns the results that were saved, for XP and toasts.
export async function flushPendingArcade(): Promise<(ArcadeResult & { progress?: Recorded })[]> {
  if (!supabase || devTest) return [];
  try {
    localStorage.removeItem('diesel-house.arcade-pending'); // the old kind (a bare score) can't be checked
  } catch {
    // nothing to tidy
  }
  const list = pending().sort((a, b) => b.score - a.score);
  if (!list.length) return [];
  const saved: (ArcadeResult & { progress?: Recorded })[] = [];
  const left: Pending[] = [];
  for (const p of list) {
    const r = await send(p);
    if (r.ok) saved.push(r);
    else if (r.why === 'error') left.push(p); // try again another time
  }
  savePending(left);
  return saved;
}

// Your best saved score (all time), or null when it can't be checked.
export async function myArcadeBest(userId: string): Promise<number | null> {
  if (!supabase || devTest || !userId) return null;
  const { data, error } = await supabase.from('arcade_scores').select('score').eq('user_id', userId).eq('game', 'nightraid').order('score', { ascending: false }).limit(1);
  if (error) return null;
  return (data?.[0]?.score as number | undefined) ?? 0;
}

export async function arcadeBoard(): Promise<ArcadeRow[] | null> {
  if (!supabase || devTest) return [];
  const { data, error } = await supabase.rpc('arcade_board', { game: 'nightraid' });
  if (error) {
    console.warn('Could not load the arcade scores', error.message);
    return null;
  }
  return (data ?? []) as ArcadeRow[];
}
