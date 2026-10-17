import { devTest } from './mode';
import { supabase } from './supabase';

// Game results (public.game_results, written only by record_game(); see supabase/migrations/*_games.sql).
// Called by the game's host. Members only: for guests (and dev test mode) nothing is saved.
export async function recordGame(game: string, spot: string, players: string[], winners: string[], score: unknown, seed?: string) {
  if (!supabase || devTest) return null;
  const { data, error } = await supabase.rpc('record_game', { game, spot, players, winner_ids: winners, score_json: score, seed: seed ?? null });
  if (error) console.warn('Could not save the game result', error.message);
  return error ? null : (data as number);
}

// How many games someone has won (profile). Members only (game_results RLS).
export async function gamesWon(userId: string) {
  if (!supabase || devTest) return null;
  const { count, error } = await supabase.from('game_results').select('id', { count: 'exact', head: true }).contains('winner_ids', [userId]);
  return error ? null : (count ?? 0);
}
