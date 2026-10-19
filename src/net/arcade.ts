import type { ArcadeResult, ArcadeRow } from '../games/nightRaid';
import { devTest } from './mode';
import type { Recorded } from './progress';
import { supabase } from './supabase';

// Arcade scores (supabase/migrations/20261107_arcade.sql): the database checks the score is believable,
// keeps your best and pays XP for new bests.
export async function submitArcade(score: number, waves: number, durationMs: number): Promise<ArcadeResult & { progress?: Recorded }> {
  if (!supabase || devTest) return { ok: false, why: 'offline' };
  const { data, error } = await supabase.rpc('submit_arcade', { game: 'nightraid', score, waves, duration_ms: durationMs });
  if (error) {
    console.warn('Could not save the score', error.message);
    return { ok: false, why: 'error' };
  }
  const r = data as ArcadeResult & { progress?: Recorded };
  if (r.ok && r.progress) r.progress = { ...r.progress, xp: Number(r.progress.xp), week_xp: Number(r.progress.week_xp) };
  return r;
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
