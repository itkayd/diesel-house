import { devTest } from './mode';
import { supabase } from './supabase';

// Challenges, XP, streaks and medals (UPDATE.md Phase 14, LEVELS.md). Everything is decided on the
// server by record_events() (supabase/migrations/20261027_challenges_xp.sql); this only sends what
// happened and gets back where you stand.

export type Challenge = { id: string; period: 'day' | 'week'; title: string; goal: number; xp: number; progress: number; done: boolean };
export type Progress = {
  xp: number;
  level: number;
  streak: number;
  best_streak: number;
  day: string; // 'd:2026-10-17' (your time zone)
  week: string;
  challenges: Challenge[];
  medals: { id: string; at: string }[];
  week_xp: number;
};
export type Recorded = Progress & {
  level_before: number;
  gained: number;
  completed: { id: string; title: string; xp: number }[];
  new_medals: { id: string; xp: number }[];
};
export type GameEvent = { k: string; n?: number; u?: string };
export type BoardRow = { user_id: string; display_name: string; character_index: number; level: number; xp_week: number; wins_week: number; streak: number; best_streak: number };

export const canRecord = () => !!supabase && !devTest;

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export async function recordEvents(events: GameEvent[]): Promise<Recorded | null> {
  if (!canRecord()) return null;
  const { data, error } = await supabase!.rpc('record_events', { events, tz: timeZone() });
  if (error) {
    console.warn('Could not record progress', error.message);
    throw error;
  }
  const r = data as Recorded;
  return { ...r, xp: Number(r.xp), week_xp: Number(r.week_xp) };
}

export async function weeklyBoard(): Promise<BoardRow[] | null> {
  if (!canRecord()) return null;
  const { data, error } = await supabase!.rpc('weekly_board');
  if (error) {
    console.warn('Could not load the noticeboard', error.message);
    return null;
  }
  return (data as BoardRow[]).map((r) => ({ ...r, xp_week: Number(r.xp_week), wins_week: Number(r.wins_week) }));
}
