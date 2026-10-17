// Levels (LEVELS.md §1). No max level, ever. Keep these identical to public.xp_for_level() and
// public.level_for_xp() in supabase/migrations/20261027_challenges_xp.sql.
// Levels 1 → 21 cost 100, 200 … 2,000 XP each; from 21 on, every level costs 2,000 XP.

// Total XP needed to reach `level`.
export function xpFor(level: number) {
  return level <= 21 ? 50 * (level - 1) * level : 21000 + 2000 * (level - 21);
}

// The level for a total XP (a direct formula, then a nudge for rounding at the exact boundaries).
export function levelOf(xp: number) {
  const x = Math.max(0, Math.floor(xp));
  let l = x < 21000 ? Math.floor((1 + Math.sqrt(1 + 0.08 * x)) / 2) : 21 + Math.floor((x - 21000) / 2000);
  if (xpFor(l + 1) <= x) l++;
  else if (l > 1 && xpFor(l) > x) l--;
  return Math.max(1, l);
}

// Where you are within your level, for progress bars (never stalls at high levels).
export function progress(xp: number) {
  const level = levelOf(xp);
  const levelSize = xpFor(level + 1) - xpFor(level);
  const intoLevel = Math.max(0, xp - xpFor(level));
  return { level, intoLevel, levelSize, toGo: levelSize - intoLevel, pct: Math.min(100, (intoLevel / levelSize) * 100) };
}

// Ranks (LEVELS.md §3): a title every 10 levels, Legend from 50 with a star per 50 levels.
export const RANKS = [
  { id: 'rank_visitor', title: 'Visitor', from: 1, colour: '#fff4e0' },
  { id: 'rank_housemate', title: 'Housemate', from: 10, colour: '#f4b860' },
  { id: 'rank_regular', title: 'Regular', from: 20, colour: '#6fdc8c' },
  { id: 'rank_keyholder', title: 'Keyholder', from: 30, colour: '#9ec9ff' },
  { id: 'rank_landlord', title: 'Landlord', from: 40, colour: '#c99bff' },
  { id: 'rank_legend', title: 'Legend', from: 50, colour: '#ffd36b' },
] as const;
export type Rank = (typeof RANKS)[number];

export function rankOf(level: number): Rank {
  let r: Rank = RANKS[0];
  for (const x of RANKS) if (level >= x.from) r = x;
  return r;
}

// Legend stars: one per 50 levels ("★★" at 100). More than 5: "★ × 7".
export function legendStars(level: number) {
  const n = Math.floor(level / 50);
  if (n <= 0) return '';
  return n > 5 ? `★ × ${n}` : '★'.repeat(n);
}

export const formatXp = (n: number) => `${Math.round(n).toLocaleString()} XP`;
