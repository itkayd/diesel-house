import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { burst, buzz, floatText, kick, timerBar } from './juice';
import { checkSeed, randomSeed, rng, sha256 } from './fair';
import { nameOf, pointsRows, topScorers, winTitle } from './kit';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Higher or lower (UPDATE.md Phase 13): 2-8 players take turns at a table. A card is face up; the player
// whose turn it is guesses if the next one is higher or lower (aces high). Each right guess in a row is
// worth more (1, then 2, then 3 points); bank them and pass, or keep going and lose them all on a wrong
// guess. Same rank: safe, no points. Three guesses at most per turn (then it banks by itself), 3 rounds.
// The deck is shuffled from the host's seed, sealed (hashed) at the start and revealed at the end.
// Messages: per guess 1 move + 1 snapshot. A round (everyone has one turn) is at most 8 x 3 x 2 = 48.

export const HL_ROUNDS = 3;
export const HL_MAX_GUESSES = 3;
const TURN_MS = 30_000; // no move for this long: the turn banks (or passes) by itself

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUIT_MARK = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' } as const;

// Cards are 0-51: suit = floor(c / 13), rank = c % 13 (cards.png columns A, 2 … K). Aces are high.
export const cardValue = (c: number) => (c % 13 === 0 ? 14 : (c % 13) + 1);
export const cardFrame = (c: number) => `${SUITS[Math.floor(c / 13)]}_${RANKS[c % 13]}`;
export const cardName = (c: number) => `${RANKS[c % 13]}${SUIT_MARK[SUITS[Math.floor(c / 13)]]}`;

// The i-th card dealt from a seed: a fresh shuffled deck every 52 cards.
export function cardAt(seed: string, i: number) {
  const r = rng(`${seed}:deck${Math.floor(i / 52)}`);
  const deck = Array.from({ length: 52 }, (_, k) => k);
  for (let k = 51; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  return deck[i % 52];
}

export type Guess = 'hi' | 'lo';
export type HLState = {
  phase: 'turn' | 'done';
  commit: string;
  seed?: string; // revealed when done
  rid: number; // changes on every move
  card: number; // the face-up card
  dealt: number[]; // cards drawn from this seed so far (checked against it at the end)
  turnNo: number; // 0 .. players x HL_ROUNDS - 1; whose turn = players[turnNo % players]
  streak: number; // right guesses in a row this turn
  pot: number; // points won this turn, not yet banked
  guesses: number; // guesses this turn
  points: Record<string, number>;
  last?: { who: string; guess?: Guess; from?: number; to?: number; result: 'right' | 'wrong' | 'same' | 'bank' | 'timeout' | 'gone'; won?: number };
  takeovers?: number; // a new host took over (with a new seed) this many times
};
export type HLAct = { t: 'guess'; g: Guess; rid: number } | { t: 'bank'; rid: number };

export const turnOf = (s: { players: Seat[] }, st: HLState) => s.players[st.turnNo % s.players.length]?.id;

// The game's rules, without the network: a new game, and what a move does. Used by the host.
export function newHL(players: Seat[], commit: string, seed: string): HLState {
  const card = cardAt(seed, 0);
  return { phase: 'turn', commit, rid: 1, card, dealt: [card], turnNo: 0, streak: 0, pot: 0, guesses: 0, points: Object.fromEntries(players.map((p) => [p.id, 0])) };
}

// Next turn, skipping players who have left the table. Done after HL_ROUNDS turns each.
export function endTurn(players: Seat[], st: HLState, banked: boolean, here: (id: string) => boolean): HLState {
  const cur = players[st.turnNo % players.length]?.id;
  const points = { ...st.points };
  if (banked && cur) points[cur] = (points[cur] ?? 0) + st.pot;
  const total = players.length * HL_ROUNDS;
  let turnNo = st.turnNo + 1;
  while (turnNo < total && !here(players[turnNo % players.length].id)) turnNo++;
  const next: HLState = { ...st, points, turnNo, streak: 0, pot: 0, guesses: 0, rid: st.rid + 1 };
  if (turnNo >= total || players.filter((p) => here(p.id)).length < 1) next.phase = 'done';
  return next;
}

export function guess(players: Seat[], st: HLState, g: Guess, nextCard: number, here: (id: string) => boolean): HLState {
  const who = turnOf({ players }, st);
  const from = st.card;
  const a = cardValue(nextCard);
  const b = cardValue(from);
  const result = a === b ? 'same' : (a > b) === (g === 'hi') ? 'right' : 'wrong';
  const streak = result === 'right' ? st.streak + 1 : st.streak;
  const won = result === 'right' ? streak : 0;
  let next: HLState = {
    ...st,
    card: nextCard,
    dealt: [...st.dealt, nextCard],
    streak,
    pot: result === 'wrong' ? 0 : st.pot + won,
    guesses: st.guesses + 1,
    rid: st.rid + 1,
    last: { who, guess: g, from, to: nextCard, result, won },
  };
  if (result === 'wrong') next = endTurn(players, next, false, here);
  else if (next.guesses >= HL_MAX_GUESSES) next = endTurn(players, next, true, here);
  return next;
}

// Host side.
export class HigherLowerHost implements TableHost {
  private seed = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    const st = newHL(players, await sha256(this.seed), this.seed);
    this.table.start('higherlower', players, st);
    this.arm();
  }

  // The previous host left: carry on from their last snapshot with a new seed (theirs left with them).
  async takeover(s: Snapshot) {
    const st = s.state as HLState;
    if (s.game !== 'higherlower' || st.phase !== 'turn') return;
    this.seed = randomSeed();
    const next: HLState = { ...st, commit: await sha256(this.seed), seed: undefined, dealt: [], rid: st.rid + 1, takeovers: (st.takeovers ?? 0) + 1 };
    this.table.update({ state: next });
    this.onPeople();
    this.arm();
  }

  onAction(from: string, act: unknown) {
    const a = act as HLAct;
    const s = this.table.snap;
    const st = s?.state as HLState | undefined;
    if (!s || !st || s.game !== 'higherlower' || st.phase !== 'turn' || a?.rid !== st.rid || turnOf(s, st) !== from) return;
    if (a.t === 'guess' && (a.g === 'hi' || a.g === 'lo')) {
      this.commit(guess(s.players, st, a.g, cardAt(this.seed, st.dealt.length), this.here()));
    } else if (a.t === 'bank' && st.pot > 0) {
      this.commit(endTurn(s.players, { ...st, last: { who: from, result: 'bank', won: st.pot } }, true, this.here()));
    }
  }

  // Someone left: if it was their turn, the turn passes (unbanked points are lost).
  onPeople() {
    const s = this.table.snap;
    const st = s?.state as HLState | undefined;
    if (!s || !st || s.game !== 'higherlower' || st.phase !== 'turn' || !this.table.isHost) return;
    const cur = turnOf(s, st);
    if (cur && !this.here()(cur)) this.commit(endTurn(s.players, { ...st, last: { who: cur, result: 'gone' } }, false, this.here()));
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private here() {
    const ids = new Set(this.table.people.map((p) => p.id));
    ids.add(this.table.id);
    return (id: string) => ids.has(id);
  }

  private commit(next: HLState) {
    const s = this.table.snap!;
    if (next.phase === 'done') {
      this.stop();
      next = { ...next, seed: this.seed };
      this.table.update({ state: next });
      this.record(
        s.players.map((p) => p.id),
        topScorers(next.points),
        { points: next.points, cards: next.dealt.length },
        this.seed,
      );
      return;
    }
    this.table.update({ state: next });
    this.arm();
  }

  // A player who has wandered off doesn't hold everyone up: bank what they have, or pass.
  private arm() {
    this.stop();
    this.timer = setTimeout(() => {
      const s = this.table.snap;
      const st = s?.state as HLState | undefined;
      if (!s || !st || st.phase !== 'turn') return;
      const who = turnOf(s, st)!;
      this.commit(endTurn(s.players, { ...st, last: { who, result: 'timeout', won: st.pot } }, true, this.here()));
    }, TURN_MS);
  }
}

// A pixel playing card from the cards pack (cards.png: 32 px cells, the card is 22 x 30 in the middle).
export function cardEl(card: number | null, scale = 3) {
  const i = el('i', 'v2-card');
  const [x, y] = card === null ? [448, 32] : [(card % 13) * 32, Math.floor(card / 13) * 32];
  i.style.cssText = `width:${22 * scale}px;height:${30 * scale}px;background-image:url(assets/games/cards.png);background-size:${480 * scale}px ${160 * scale}px;background-position:-${(x + 5) * scale}px -${(y + 1) * scale}px`;
  if (card !== null) {
    i.dataset.card = cardFrame(card);
    i.setAttribute('aria-label', cardName(card));
  } else i.setAttribute('aria-label', 'Face-down card');
  i.setAttribute('role', 'img');
  return i;
}

// Everyone's screen.
export class HigherLowerView implements TableView {
  readonly root = el('div', 'v2-qd');
  private note = el('p', 'v2-note');
  private cards = el('div', 'v2-cards');
  private status = el('div', 'v2-result');
  private acts = el('div', 'v2-hl-acts');
  private list = el('div', 'v2-list');
  private rid = 0;

  constructor(
    private me: string,
    private act: (a: HLAct) => void,
    private names: Names,
  ) {
    this.note.id = 'hl-note';
    this.cards.id = 'hl-cards';
    this.status.id = 'hl-status';
    this.status.setAttribute('aria-live', 'polite');
    this.acts.id = 'hl-acts';
    this.list.id = 'hl-list';
    this.root.append(this.note, this.cards, this.status, this.acts, this.list);
  }

  show(s: Snapshot) {
    const st = s.state as HLState;
    const fresh = st.rid !== this.rid;
    // Shown again with nothing new (the panel re-drawn): keep the buttons as they are, so a tap in
    // progress isn't lost to them being rebuilt.
    if (!fresh) return;
    this.rid = st.rid;
    const playing = s.players.some((p) => p.id === this.me);
    const cur = turnOf(s, st);
    const mine = st.phase === 'turn' && cur === this.me;
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);
    const round = Math.min(HL_ROUNDS, Math.floor(st.turnNo / s.players.length) + 1);

    this.note.textContent =
      st.phase === 'done' ? 'Game over.' : `Round ${round} of ${HL_ROUNDS}${playing ? '' : ' · watching'}. Aces high. Bank your points before you bust.`;

    // The face-up card, and the deck (face down) it came from.
    const up = cardEl(st.card, 4);
    up.id = 'hl-card';
    if (fresh && st.last?.to !== undefined) up.classList.add('flip');
    if (st.last?.result === 'right') up.classList.add('right');
    if (st.last?.result === 'wrong') up.classList.add('bust');
    const deck = el('div', 'v2-deck');
    deck.append(cardEl(null, 4), cardEl(null, 4));
    // Guesses this turn, one pip each (gold once it's paid off).
    const pips = el('div', 'v2-pips');
    pips.id = 'hl-pips';
    for (let i = 0; i < HL_MAX_GUESSES; i++) pips.append(el('i', i < st.guesses ? (i < st.streak ? 'on' : 'safe') : ''));
    this.cards.replaceChildren(deck, up, pips);
    if (fresh && st.last) {
      if (st.last.to !== undefined) play('card_flip', 0.7);
      if (st.last.result === 'wrong' && st.last.who === this.me) play('error', 0.5);
      if (st.last.result === 'right') play(st.last.who === this.me ? 'coin' : 'card_place', 0.5);
      // After the card has flipped over: points float off it, or it shakes on a bust.
      const l = st.last;
      const byMe = l.who === this.me;
      setTimeout(() => {
        if (l.result === 'right') floatText(up, `+${l.won}`, 'good');
        if (l.result === 'wrong') {
          kick(up, 'v2-shake');
          floatText(up, 'Bust!', 'bad');
        }
        if (l.result === 'bank' && l.won) floatText(this.status, `+${l.won} banked`, 'gold');
      }, 360);
      if (byMe) buzz(l.result === 'wrong' ? [50, 40, 50] : l.result === 'right' ? 15 : 0);
    }

    // What just happened, and whose turn it is.
    this.status.className = 'v2-result';
    const l = st.last;
    let line = '';
    if (l?.result === 'right') line = `${cardName(l.to!)}: right! +${l.won}`;
    else if (l?.result === 'same') line = `${cardName(l.to!)}: same rank, safe`;
    else if (l?.result === 'wrong') line = `${cardName(l.to!)}: bust!`;
    else if (l?.result === 'bank') line = `${name(l.who)} banked ${l.won}`;
    else if (l?.result === 'timeout') line = `${name(l.who)} ran out of time`;
    else if (l?.result === 'gone') line = `${name(l.who)} left the table`;
    if (l?.result === 'right') this.status.classList.add('win');
    if (l?.result === 'wrong') this.status.classList.add('lose');
    this.status.textContent = line;

    this.acts.replaceChildren();
    if (st.phase === 'done') {
      void this.done(s, st, fresh);
    } else {
      const turn = el('p', 'v2-note', mine ? `Your turn: is the next card higher or lower than ${cardName(st.card)}?` : `${name(cur!)}'s turn.`);
      turn.id = 'hl-turn';
      const pot = st.pot ? ` · ${st.pot} pt${st.pot === 1 ? '' : 's'} at stake` : '';
      turn.textContent += ` Guess ${st.guesses + 1} of ${HL_MAX_GUESSES}${pot}.`;
      this.acts.append(turn, timerBar(TURN_MS, 'hl-timer'));
      if (mine) {
        const row = el('div', 'v2-hl-btns');
        // Rough odds by rank (2 to ace): how many of the other 12 ranks are above / below this one.
        const v = cardValue(st.card);
        const odds = { hi: Math.round(((14 - v) / 12) * 100), lo: Math.round(((v - 2) / 12) * 100) };
        for (const [g, label, ic] of [['hi', 'Higher', 'arrow-up'], ['lo', 'Lower', 'arrow-down']] as const) {
          const b = el('button', 'dh-btn');
          b.type = 'button';
          b.id = `hl-${g}`;
          b.append(icon(ic), document.createTextNode(label), el('small', 'odds', `${odds[g]}%`));
          b.addEventListener('click', () => this.send({ t: 'guess', g, rid: st.rid }));
          row.append(b);
        }
        this.acts.append(row);
        if (st.pot > 0) {
          const bank = el('button', 'dh-btn dh-btn--quiet');
          bank.type = 'button';
          bank.id = 'hl-bank';
          bank.append(icon('check'), document.createTextNode(`Bank ${st.pot} & pass`));
          bank.addEventListener('click', () => this.send({ t: 'bank', rid: st.rid }));
          this.acts.append(bank);
        }
        if (fresh) play('click', 0.4);
      }
    }
    this.list.replaceChildren(
      ...pointsRows(s.players, st.points, this.me, this.names, { mark: st.phase === 'turn' ? cur : undefined, chip: (id) => (id === cur && st.pot && st.phase === 'turn' ? `+${st.pot}?` : '') }),
    );
  }

  private send(a: HLAct) {
    buzz(8);
    this.acts.querySelectorAll('button').forEach((b) => (b.disabled = true));
    this.act(a);
  }

  private async done(s: Snapshot, st: HLState, fresh: boolean) {
    const winners = topScorers(st.points);
    const title = winTitle(winners, this.me, this.names, s.players);
    const sub = el('p', 'v2-note', 'Checking the deck was fair…');
    sub.id = 'hl-fair';
    const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), title);
    this.acts.replaceChildren(res, sub);
    if (fresh && s.players.some((p) => p.id === this.me)) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
    if (fresh && winners.includes(this.me)) {
      requestAnimationFrame(() => burst(res, 24));
      buzz([20, 40, 20]);
    }
    // Fair check: the seed matches the hash shown at the start, and deals the very same cards.
    const ok = !!st.seed && (await checkSeed(st.seed, st.commit)) && st.dealt.every((c, i) => c === cardAt(st.seed!, i));
    sub.textContent = ok
      ? `Fair: ${st.takeovers ? 'since the last host change, ' : ''}every card matches the host’s sealed shuffle.`
      : 'Couldn’t check the deck.';
    sub.dataset.fair = String(ok);
  }

  destroy() {}
}
