import type { IconName } from '../ui/icons';

// The challenge pool and medals for the screen. What counts and how much XP it gives is decided on the
// server (public.challenge_defs and record_events() in supabase/migrations/20261027_challenges_xp.sql),
// so nobody can award themselves XP; this file only adds icons and words. Keep the ids in step.

export const CHALLENGE_ICONS: Record<string, IconName> = {
  d_hi_rooms: 'message-square',
  d_voice: 'users',
  d_rps: 'swords',
  d_walkie: 'radio',
  d_emotes: 'smile-plus',
  d_react: 'message-circle-heart',
  d_first: 'house',
  d_knock: 'footprints', // was the knock challenge; now "Visit 2 different rooms" (20261030_shared_rooms.sql)
  d_game: 'dice-5',
  d_whisper: 'audio-lines',
  w_rooms: 'door-open',
  w_wins: 'award',
  w_voice: 'headphones',
  w_host4: 'users',
  w_all_games: 'gamepad-2',
  w_streak: 'flame',
  w_guest: 'ticket',
  w_qd: 'zap',
  d_catch: 'paw-print',
  w_catch: 'paw-print',
};

// Achievement medals (LEVELS.md §7.3) and rank medals (§7.1). `cell`: the 48 px cell in
// public/assets/ui/medals.png (cells 8 and 9, the old level badges, are spare for later).
export type Medal = { id: string; name: string; how: string; xp: number; cell: number; rank?: number };
export const ACHIEVEMENTS: Medal[] = [
  // Rooms have no owners or doors to knock on any more: these two come back with new rules in the new
  // house (REDESIGN.md §2: House tour, Dance machine). Anyone who has them keeps them.
  { id: 'decor', name: 'Home maker', how: 'Coming back soon with the new house.', xp: 25, cell: 10 },
  { id: 'first_knock', name: 'First knock', how: 'Coming back soon with the new house.', xp: 25, cell: 0 },
  { id: 'social', name: 'Social butterfly', how: 'Send emotes to 3 different friends.', xp: 50, cell: 11 },
  { id: 'over_out', name: 'Over and out', how: 'Use the walkie 3 times.', xp: 50, cell: 5 },
  { id: 'night_owl', name: 'Night owl', how: 'Be in the house after midnight.', xp: 50, cell: 1 },
  { id: 'high_roller', name: 'High roller', how: 'Roll a double six.', xp: 75, cell: 2 },
  { id: 'fast_hand', name: 'Fastest hand', how: 'Win a round of Quick Draw.', xp: 75, cell: 4 },
  { id: 'duelist', name: 'Duelist', how: 'Win 3 rock-paper-scissors duels.', xp: 100, cell: 3 },
  { id: 'host', name: 'Party host', how: 'Be in a room when it reaches 4 people.', xp: 150, cell: 7 },
  { id: 'steady', name: 'Slow & steady', how: 'Keep a 7-day streak.', xp: 200, cell: 6 },
];
export const RANK_MEDALS: Medal[] = [
  { id: 'rank_visitor', name: 'Visitor', how: 'Your first visit.', xp: 0, cell: 12, rank: 1 },
  { id: 'rank_housemate', name: 'Housemate', how: 'Reach level 10.', xp: 0, cell: 13, rank: 10 },
  { id: 'rank_regular', name: 'Regular', how: 'Reach level 20.', xp: 0, cell: 14, rank: 20 },
  { id: 'rank_keyholder', name: 'Keyholder', how: 'Reach level 30.', xp: 0, cell: 15, rank: 30 },
  { id: 'rank_landlord', name: 'Landlord', how: 'Reach level 40.', xp: 0, cell: 16, rank: 40 },
  { id: 'rank_legend', name: 'Legend', how: 'Reach level 50. A star every 50 levels.', xp: 0, cell: 17, rank: 50 },
];
export const MEDAL_CELLS = 18;
export const medalById = (id: string) => [...ACHIEVEMENTS, ...RANK_MEDALS].find((m) => m.id === id);
