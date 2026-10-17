import { el } from '../ui/modal';
import { portrait } from '../ui/portrait';
import { play } from '../ui/sounds';
import { burst, buzz } from './juice';
import { cryptoInt } from './fair';
import { nameOf } from './kit';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Four in a row (UPDATE.md Phase 13): two players at a table, a 7 x 6 grid, simple pixel pieces drawn in
// CSS; everyone else at the table watches. Who goes first is random. If a player leaves, the other wins.
// Messages: 1 per host move, 2 per the other player's move (move + snapshot); a typical game is 30-45,
// only a completely full board (a draw) reaches 64.

export const COLS = 7;
export const ROWS = 6;

export type FourState = {
  phase: 'play' | 'done';
  rid: number;
  board: string; // ROWS x COLS, top row first: '.' empty, '0' / '1' the players' pieces
  turn: 0 | 1; // whose move: players[turn]
  last?: number; // the cell just played
  line?: number[]; // the winning four
  winner?: string | null; // null: a draw
  reason?: 'four' | 'full' | 'left';
  moves: number;
};
export type FourAct = { t: 'drop'; col: number; rid: number };

export const emptyBoard = () => '.'.repeat(COLS * ROWS);

// Where a piece dropped in `col` lands (the lowest empty cell), or -1 if the column is full.
export function landing(board: string, col: number) {
  if (col < 0 || col >= COLS) return -1;
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + col] === '.') return r * COLS + col;
  return -1;
}

// The four (or more) in a row through `cell`, if there is one.
export function lineThrough(board: string, cell: number): number[] | null {
  const me = board[cell];
  if (me === '.' || me === undefined) return null;
  const r0 = Math.floor(cell / COLS);
  const c0 = cell % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [cell];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === me) {
        line.push(r * COLS + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return null;
}

// A move by players[st.turn], or null if it isn't allowed.
export function drop(players: Seat[], st: FourState, col: number): FourState | null {
  if (st.phase !== 'play') return null;
  const cell = landing(st.board, col);
  if (cell < 0) return null;
  const board = st.board.slice(0, cell) + st.turn + st.board.slice(cell + 1);
  const next: FourState = { ...st, board, last: cell, moves: st.moves + 1, rid: st.rid + 1, turn: st.turn === 0 ? 1 : 0 };
  const line = lineThrough(board, cell);
  if (line) return { ...next, phase: 'done', line, winner: players[st.turn].id, reason: 'four', turn: st.turn };
  if (!board.includes('.')) return { ...next, phase: 'done', winner: null, reason: 'full' };
  return next;
}

// Host side.
export class FourHost implements TableHost {
  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  start(players: Seat[]) {
    const st: FourState = { phase: 'play', rid: 1, board: emptyBoard(), turn: cryptoInt(0, 1) as 0 | 1, moves: 0 };
    this.table.start('four', players.slice(0, 2), st);
  }

  // The host was a player and has gone, so the other player (us) wins.
  takeover(s: Snapshot) {
    if (s.game !== 'four' || (s.state as FourState).phase !== 'play') return;
    this.onPeople();
  }

  onAction(from: string, act: unknown) {
    const a = act as FourAct;
    const s = this.table.snap;
    const st = s?.state as FourState | undefined;
    if (!s || !st || s.game !== 'four' || a?.t !== 'drop' || a.rid !== st.rid || s.players[st.turn]?.id !== from) return;
    const next = drop(s.players, st, Math.floor(a.col));
    if (next) this.commit(next);
  }

  // A player left the table: the other one wins.
  onPeople() {
    const s = this.table.snap;
    const st = s?.state as FourState | undefined;
    if (!s || !st || s.game !== 'four' || st.phase !== 'play' || !this.table.isHost) return;
    const here = new Set([this.table.id, ...this.table.people.map((p) => p.id)]);
    const gone = s.players.find((p) => !here.has(p.id));
    if (!gone) return;
    const other = s.players.find((p) => p.id !== gone.id && here.has(p.id));
    this.commit({ ...st, phase: 'done', winner: other?.id ?? null, reason: 'left', rid: st.rid + 1 });
  }

  stop() {}

  private commit(next: FourState) {
    const s = this.table.snap!;
    this.table.update({ state: next });
    if (next.phase === 'done') this.record(s.players.map((p) => p.id), next.winner ? [next.winner] : [], { moves: next.moves, reason: next.reason });
  }
}

// Everyone's screen: the two players, the grid, and whose move it is.
export class FourView implements TableView {
  readonly root = el('div', 'v2-qd');
  private vs = el('div', 'v2-vs');
  private grid = el('div', 'v2-four');
  private status = el('div', 'v2-result');
  private rid = 0;
  private sent = 0;
  private dropped = -1; // the cell our own piece already fell into (don't animate it twice)

  constructor(
    private me: string,
    private act: (a: FourAct) => void,
    private names: Names,
  ) {
    this.grid.id = 'four-grid';
    this.grid.setAttribute('role', 'grid');
    this.grid.setAttribute('aria-label', 'Four in a row board');
    this.status.id = 'four-status';
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(this.vs, this.grid, this.status);
  }

  show(s: Snapshot) {
    const st = s.state as FourState;
    const fresh = st.rid !== this.rid;
    // Shown again with nothing new (the panel re-drawn): keep the buttons as they are, so a tap in
    // progress isn't lost to them being rebuilt.
    if (!fresh) return;
    this.rid = st.rid;
    const seat = s.players.findIndex((p) => p.id === this.me);
    const mine = st.phase === 'play' && seat === st.turn && this.sent !== st.rid;
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);

    // The two players, each with their piece colour; the one to move is lit.
    this.vs.replaceChildren();
    s.players.forEach((p, i) => {
      const side = el('div', 'side' + (st.phase === 'play' && st.turn === i ? ' turn' : '') + (st.winner === p.id ? ' won' : ''));
      side.dataset.player = p.id;
      const piece = el('i', `v2-piece p${i}`);
      side.append(portrait(this.names(p.id).character ?? p.character, 32), el('b', '', name(p.id)), piece);
      this.vs.append(side);
      if (i === 0) this.vs.append(el('span', 'x', 'vs'));
    });

    // The grid: tap anywhere in a column to drop a piece there.
    this.grid.replaceChildren();
    this.grid.classList.toggle('mine', mine);
    for (let c = 0; c < COLS; c++) {
      const col = el('button', 'col');
      col.type = 'button';
      col.dataset.col = String(c);
      col.disabled = !mine || landing(st.board, c) < 0;
      col.setAttribute('aria-label', `Column ${c + 1}`);
      for (let r = 0; r < ROWS; r++) {
        const i = r * COLS + c;
        const v = st.board[i];
        const cell = el('i', 'cell');
        if (mine && i === landing(st.board, c)) cell.classList.add('land', `p${seat}`); // ghost piece on hover
        if (v !== '.') {
          const falls = i === st.last && fresh && i !== this.dropped;
          cell.append(el('i', `v2-piece p${v}` + (falls ? ' drop' : '') + (st.line?.includes(i) ? ' win' : '')));
          if (falls) cell.style.setProperty('--fall', String(r + 1));
        }
        col.append(cell);
      }
      col.addEventListener('click', () => {
        if (!mine || this.sent === st.rid) return;
        this.sent = st.rid;
        this.grid.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
        this.grid.classList.remove('mine');
        // Show our piece falling straight away; the host's answer redraws the board a moment later.
        const at = landing(st.board, c);
        const r = Math.floor(at / COLS);
        const cell = at >= 0 ? (col.children[r] as HTMLElement | undefined) : undefined;
        if (cell) {
          this.dropped = at;
          cell.classList.remove('land');
          cell.style.setProperty('--fall', String(r + 1));
          cell.append(el('i', `v2-piece p${seat} drop`));
        }
        play('card_place', 0.6);
        buzz(10);
        this.act({ t: 'drop', col: c, rid: st.rid });
      });
      this.grid.append(col);
    }
    // (our own drop already clicked into place when we tapped)
    const lastBy = st.last !== undefined ? st.board[st.last] : null;
    if (fresh && st.last !== undefined && String(seat) !== lastBy) play('card_place', 0.7);
    if (fresh && mine && st.last !== undefined) buzz(10); // your move

    this.status.className = 'v2-result';
    if (st.phase === 'play') {
      this.status.textContent = mine ? 'Your move: tap a column' : seat < 0 ? `${name(s.players[st.turn].id)} to move · watching` : `${name(s.players[st.turn].id)} to move…`;
    } else {
      const won = st.winner === this.me;
      this.status.classList.add(won ? 'win' : seat >= 0 && st.winner ? 'lose' : 'x');
      const who = st.winner ? (won ? 'You win!' : `${name(st.winner)} wins`) : 'A draw!';
      const loser = s.players.find((p) => p.id !== st.winner);
      this.status.textContent = st.reason === 'left' ? `${loser ? name(loser.id) : 'Someone'} left · ${who}` : who;
      if (fresh && seat >= 0) play(won ? 'win' : 'lose', 0.7);
      if (fresh && won) {
        requestAnimationFrame(() => burst(this.status, 26));
        buzz([20, 40, 20]);
      }
    }
  }

  destroy() {}
}
