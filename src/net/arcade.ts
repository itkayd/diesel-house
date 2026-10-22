import type { ArcadeResult, ArcadeRow } from '../games/nightRaid';
import { devTest } from './mode';
import type { Recorded } from './progress';
import { supabase } from './supabase';

// Arcade scores (supabase/migrations/20261107_arcade.sql): the database checks the score is believable,
// keeps your best and pays XP for new bests.
export async function submitArcade(score: number, waves: number, durationMs: number): Promise<ArcadeResult & { progress?: Recorded }> {
  if (!supabase || devTest) return { ok: false, why: 'offline' };
  const r = await send(score, waves, durationMs);
  // No connection (or the server didn't answer): keep it on this phone and try again later.
  if (!r.ok && r.why === 'error') {
    queue({ score, waves, ms: durationMs, at: Date.now() });
    return { ok: false, why: 'queued' };
  }
  return r;
}

async function send(score: number, waves: number, durationMs: number): Promise<ArcadeResult & { progress?: Recorded }> {
  try {
    const { data, error } = await supabase!.rpc('submit_arcade', { game: 'nightraid', score, waves, duration_ms: durationMs });
    if (error) {
      console.warn('Could not save the score', error.message);
      return { ok: false, why: 'error' };
    }
    const r = data as ArcadeResult & { progress?: Recorded };
    if (r.ok && r.progress) r.progress = { ...r.progress, xp: Number(r.progress.xp), week_xp: Number(r.progress.week_xp) };
    return r;
  } catch (e) {
    console.warn('Could not save the score', e);
    return { ok: false, why: 'error' };
  }
}

// Scores that couldn't be sent (a dropped connection, the page closing) wait on this phone, for up to a
// week, and go to the server one at a time the next time the arcade opens. The server checks them like
// any other score.
const PENDING = 'diesel-house.arcade-pending';
type Pending = { score: number; waves: number; ms: number; at: number };
function pending(): Pending[] {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING) ?? '[]') as Pending[];
    return all.filter((p) => Date.now() - p.at < 7 * 86_400_000);
  } catch {
    return [];
  }
}
function savePending(list: Pending[]) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(list.slice(-3)));
  } catch {
    // private browsing: nothing kept
  }
}
function queue(p: Pending) {
  savePending([...pending(), p]);
}

// Send what's waiting (best first). Returns the results that were saved, for XP and toasts.
export async function flushPendingArcade(): Promise<(ArcadeResult & { progress?: Recorded })[]> {
  if (!supabase || devTest) return [];
  const list = pending().sort((a, b) => b.score - a.score);
  const saved: (ArcadeResult & { progress?: Recorded })[] = [];
  const left: Pending[] = [];
  for (const [i, p] of list.entries()) {
    if (i > 0) await new Promise((ok) => setTimeout(ok, 8_500)); // the server keeps one score per 8 s
    const r = await send(p.score, p.waves, p.ms);
    if (r.ok) saved.push(r);
    else if (r.why === 'error' || r.why === 'too_soon') left.push(p); // try again another time
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
