import { devTest } from './mode';
import type { Recorded } from './progress';
import { supabase } from './supabase';

// Catching critters (supabase/migrations/20261028_critters.sql). The database decides who was first.
export type CatchResult =
  | { ok: true; critter: string; name: string; xp: number; progress: Recorded }
  | { ok: false; why: 'taken' | 'gone' | 'nothing' | 'enough' | 'error'; by?: string };
export type CatchRow = { user_id: string; display_name: string; character_index: number; level: number; caught: number; xp: number; critters: string[] };

export const canCatch = () => !!supabase && !devTest;

export async function catchCritter(slot: number, idx: number): Promise<CatchResult> {
  const { data, error } = await supabase!.rpc('catch_critter_at', { at_slot: slot, idx });
  if (error) {
    console.warn('Could not catch', error.message);
    return { ok: false, why: 'error' };
  }
  const r = data as CatchResult;
  if (r.ok) r.progress = { ...r.progress, xp: Number(r.progress.xp), week_xp: Number(r.progress.week_xp) };
  return r;
}

// Who caught the critters of these slots (for a late arrival).
export async function caughtSlots(fromSlot: number): Promise<{ slot: number; idx: number; user_id: string }[]> {
  if (!supabase || devTest) return [];
  const { data } = await supabase.from('critter_catches').select('slot, idx, user_id').gte('slot', fromSlot);
  return (data ?? []).map((r) => ({ slot: Number(r.slot), idx: Number(r.idx ?? 0), user_id: r.user_id as string }));
}

export async function catchBoard(): Promise<CatchRow[] | null> {
  if (!canCatch()) return null;
  const { data, error } = await supabase!.rpc('catch_board');
  if (error) {
    console.warn('Could not load today’s catches', error.message);
    return null;
  }
  return (data as CatchRow[]).map((r) => ({ ...r, caught: Number(r.caught), xp: Number(r.xp) }));
}
