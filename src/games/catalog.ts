// Which games there are, and which a spot offers (a table, or a sofa corner with only the games that need
// no table). Small on purpose: the games themselves (controller.ts and each game) load after the picker.

export type GameId = 'dice' | 'rps' | 'quickdraw' | 'higherlower' | 'wyr' | 'four' | 'quiz' | 'sketch' | 'liars' | 'letters';
export const ALL_GAMES: GameId[] = ['quiz', 'sketch', 'liars', 'letters', 'quickdraw', 'higherlower', 'wyr', 'four', 'dice', 'rps'];
// What can be switched on and off for a room's table in Settings > Room (a sofa corner: only SOFA_GAMES).
export const TABLE_GAMES: { id: GameId; label: string }[] = [
  { id: 'dice', label: 'Dice' },
  { id: 'rps', label: 'Rock paper scissors' },
  { id: 'quickdraw', label: 'Quick Draw' },
  { id: 'higherlower', label: 'Higher or lower' },
  { id: 'wyr', label: 'Would you rather' },
  { id: 'four', label: 'Four in a row' },
  { id: 'quiz', label: 'Quiz night' },
  { id: 'sketch', label: 'Sketch & guess' },
  { id: 'liars', label: 'Liar’s dice' },
  { id: 'letters', label: 'Letter rush' },
];
// Games that need no table, for rooms with a sofa corner instead.
export const SOFA_GAMES: GameId[] = ['dice', 'rps', 'wyr', 'quiz', 'sketch', 'letters'];
export const gamesFor = (kind: 'table' | 'sofa' | null) => (kind === 'sofa' ? TABLE_GAMES.filter((g) => SOFA_GAMES.includes(g.id)) : TABLE_GAMES);
