import { el } from '../ui/modal';
import { portrait } from '../ui/portrait';
import type { Names, Seat } from './table';

// Little pieces the table games share: the points table and the "who won" line.

// Everyone with the top score (nobody if the top is 0).
export function topScorers(points: Record<string, number>) {
  const top = Math.max(0, ...Object.values(points));
  return top > 0 ? Object.keys(points).filter((id) => points[id] === top) : [];
}

// "You win!", "Shared win!", "Sami wins", "Sami & Jo win", "Nobody scored".
export function winTitle(winners: string[], me: string, names: Names, players: Seat[]) {
  if (!winners.length) return 'Nobody scored';
  if (winners.includes(me)) return winners.length > 1 ? 'Shared win!' : 'You win!';
  const who = winners.map((id) => names(id).name || players.find((p) => p.id === id)?.name || 'Someone');
  return `${who.join(' & ')} ${who.length > 1 ? 'win' : 'wins'}`;
}

// The points table (design/game/v2.html .v2-board-row), highest first. `chip` adds to the points label,
// `mark` highlights a row (whose turn it is).
export function pointsRows(
  players: Seat[],
  points: Record<string, number>,
  me: string,
  names: Names,
  opts: { chip?: (id: string) => string; mark?: string; gone?: Set<string> } = {},
) {
  const rows = players.map((p, i) => ({ p, i, pts: points[p.id] ?? 0 })).sort((a, b) => b.pts - a.pts || a.i - b.i);
  return rows.map((r, i) => {
    const row = el('div', 'v2-board-row' + (r.p.id === me ? ' me' : '') + (r.p.id === opts.mark ? ' turn' : '') + (opts.gone?.has(r.p.id) ? ' gone' : ''));
    row.dataset.player = r.p.id;
    const rk = el('span', 'rk' + (i === 0 && r.pts > 0 ? ' top' : ''), String(i + 1));
    const who = names(r.p.id);
    const extra = opts.chip?.(r.p.id) ?? '';
    const chip = el('span', 'v2-xpchip', `${r.pts} pt${r.pts === 1 ? '' : 's'}${extra ? ' · ' + extra : ''}`);
    row.append(rk, portrait(who.character ?? r.p.character, 32), el('b', '', r.p.id === me ? 'You' : who.name || r.p.name), chip);
    return row;
  });
}

// A name for messages: "You" or theirs.
export const nameOf = (id: string, me: string, names: Names, players: Seat[]) =>
  id === me ? 'You' : names(id).name || players.find((p) => p.id === id)?.name || 'Someone';
