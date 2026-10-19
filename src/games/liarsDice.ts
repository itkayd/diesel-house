import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { portrait } from '../ui/portrait';
import { dieIcon } from './dice';
import { burst, buzz, kick, timerBar } from './juice';
import { cryptoInt, randomSeed, sha256 } from './fair';
import { nameOf, winTitle } from './kit';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Liar's dice: 2-6 players, 5 dice each, hidden under your cup. Take turns to bid on how many of a face
// are on the whole table ("four 5s"), counting 1s as any face. Each bid must go up: more dice, or the
// same number of a higher face. Or call "Liar!" on the last bid: everyone lifts their cup. If there are
// at least that many, the caller loses a die; if not, the bidder does. Lose all five and you're out;
// the last one with dice wins.
//
// Nobody can peek, not even the host: each player rolls on their own phone and sends only a sealed hash
// of the roll (dice + a secret salt). When someone calls, everyone shows their dice and salt and the
// host checks them against the seals; a roll that doesn't match (or isn't shown in time) counts for
// nothing and costs that player a die. Messages per round: a seal and a "who's rolled" snapshot per
// player, one per bid, then the shows and the reveal.

export const START_DICE = 5;
const ROLL_MS = 12_000; // phones roll by themselves: this is only for someone who has gone quiet
const TURN_MS = 40_000; // then: "Liar!" on the last bid, or the lowest opening bid
const SHOW_MS = 8_000;
const REVEAL_MS = 7_000;

export type Bid = { q: number; f: number; by: string };
export type LDState = {
  phase: 'roll' | 'bid' | 'show' | 'reveal' | 'done';
  rid: number;
  gid: string; // this game (a roll belongs to a game and round, whoever is hosting)
  round: number;
  dice: Record<string, number>; // how many dice each player has left
  order: string[]; // players still in, in seat order
  seals: Record<string, string>; // this round's sealed rolls
  turn: string;
  bid: Bid | null;
  call?: { by: string; bid: Bid };
  shown?: Record<string, number[]>; // lifted cups (an empty list: didn't match its seal)
  count?: number; // how many of the bid's face (with 1s) were there
  loser?: string;
  winner?: string | null;
};
export type LDAct =
  | { t: 'seal'; rid: number; round: number; h: string }
  | { t: 'bid'; rid: number; q: number; f: number }
  | { t: 'call'; rid: number }
  | { t: 'show'; rid: number; round: number; d: number[]; s: string };

export const sealOf = (id: string, round: number, dice: number[], salt: string) => sha256(`liars:${id}:${round}:${dice.join('')}:${salt}`);

// Is `next` a legal raise on `last` (faces 2-6; 1s are wild and can't be bid)?
export const raises = (next: { q: number; f: number }, last: Bid | null, total: number) =>
  Number.isInteger(next.q) && Number.isInteger(next.f) && next.f >= 2 && next.f <= 6 && next.q >= 1 && next.q <= total && (!last || next.q > last.q || (next.q === last.q && next.f > last.f));

// The smallest legal bid after `last` (the time-out move with no bid to call).
export const lowestRaise = (last: Bid | null): { q: number; f: number } => (!last ? { q: 1, f: 2 } : last.f < 6 ? { q: last.q, f: last.f + 1 } : { q: last.q + 1, f: 2 });

// How many dice show `face`, counting 1s as any face.
export const countFace = (shown: Record<string, number[]>, face: number) => Object.values(shown).reduce((n, d) => n + d.filter((v) => v === face || v === 1).length, 0);

const total = (st: Pick<LDState, 'dice' | 'order'>) => st.order.reduce((n, id) => n + (st.dice[id] ?? 0), 0);
const after = (order: string[], id: string) => order[(order.indexOf(id) + 1) % order.length];

export class LiarsDiceHost implements TableHost {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  start(players: Seat[]) {
    const ids = players.map((p) => p.id);
    const st: LDState = { phase: 'roll', rid: 1, gid: randomSeed().slice(0, 8), round: 1, dice: Object.fromEntries(ids.map((id) => [id, START_DICE])), order: ids, seals: {}, turn: ids[0], bid: null };
    this.table.start('liars', players, st);
    this.arm(ROLL_MS);
  }

  // Everything is in the snapshot (seals, bids, shown cups): just carry on, dropping anyone who has left.
  takeover(s: Snapshot) {
    const st = s.state as LDState;
    if (s.game !== 'liars' || st.phase === 'done') return;
    const here = new Set([this.table.id, ...this.table.people.map((p) => p.id)]);
    const order = st.order.filter((id) => here.has(id));
    if (order.length < 2) return this.finish({ ...st, order });
    const turn = order.includes(st.turn) ? st.turn : order[0];
    this.table.update({ state: { ...st, order, turn, rid: st.rid + 1 } });
    this.arm(st.phase === 'roll' ? ROLL_MS : st.phase === 'bid' ? TURN_MS : st.phase === 'show' ? SHOW_MS : REVEAL_MS / 2);
  }

  onAction(from: string, act: unknown) {
    const a = act as LDAct;
    const s = this.table.snap;
    const st = s?.state as LDState | undefined;
    if (!s || !st || s.game !== 'liars' || a?.rid !== st.rid || !st.order.includes(from)) return;
    if (a.t === 'seal' && st.phase === 'roll' && a.round === st.round && typeof a.h === 'string' && /^[0-9a-f]{64}$/.test(a.h) && !st.seals[from]) {
      const seals = { ...st.seals, [from]: a.h };
      if (st.order.every((id) => seals[id])) {
        this.table.update({ state: { ...st, phase: 'bid', seals, rid: st.rid + 1 } });
        this.arm(TURN_MS);
      } else this.table.update({ state: { ...st, seals } });
    } else if (a.t === 'bid' && st.phase === 'bid' && from === st.turn && raises(a, st.bid, total(st))) {
      this.table.update({ state: { ...st, bid: { q: a.q, f: a.f, by: from }, turn: after(st.order, from), rid: st.rid + 1 } });
      this.arm(TURN_MS);
    } else if (a.t === 'call' && st.phase === 'bid' && from === st.turn && st.bid) {
      this.call(st, from);
    } else if (a.t === 'show' && st.phase === 'show' && a.round === st.round && !st.shown?.[from]) {
      void this.show(st, from, a);
    }
  }

  onPeople() {
    const s = this.table.snap;
    const st = s?.state as LDState | undefined;
    if (!s || !st || s.game !== 'liars' || st.phase === 'done') return;
    const here = new Set([this.table.id, ...this.table.people.map((p) => p.id)]);
    const gone = st.order.filter((id) => !here.has(id));
    if (!gone.length) return;
    // Someone left the table: they're out, and the round starts again without them.
    const order = st.order.filter((id) => here.has(id));
    const dice = { ...st.dice };
    for (const id of gone) dice[id] = 0;
    if (order.length < 2) return this.finish({ ...st, order, dice });
    this.newRound({ ...st, order, dice }, order.includes(st.turn) ? st.turn : order[0]);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(ms: number) {
    this.stop();
    this.timer = setTimeout(() => this.timeout(), ms);
  }

  private timeout() {
    const st = this.table.snap?.state as LDState | undefined;
    if (!st) return;
    if (st.phase === 'roll') {
      // Someone never rolled: they're out of the game.
      const order = st.order.filter((id) => st.seals[id]);
      const dice = { ...st.dice };
      for (const id of st.order) if (!st.seals[id]) dice[id] = 0;
      if (order.length < 2) return this.finish({ ...st, order, dice });
      this.table.update({ state: { ...st, order, dice, turn: order.includes(st.turn) ? st.turn : order[0], phase: 'bid', rid: st.rid + 1 } });
      this.arm(TURN_MS);
    } else if (st.phase === 'bid') {
      if (st.bid) this.call(st, st.turn);
      else {
        const b = lowestRaise(null);
        this.table.update({ state: { ...st, bid: { ...b, by: st.turn }, turn: after(st.order, st.turn), rid: st.rid + 1 } });
        this.arm(TURN_MS);
      }
    } else if (st.phase === 'show') {
      const shown = { ...(st.shown ?? {}) };
      for (const id of st.order) shown[id] ??= [];
      this.reveal({ ...st, shown });
    } else if (st.phase === 'reveal') this.afterReveal(st);
  }

  private call(st: LDState, by: string) {
    this.table.update({ state: { ...st, phase: 'show', call: { by, bid: st.bid! }, shown: {}, rid: st.rid + 1 } });
    this.arm(SHOW_MS);
  }

  private async show(st: LDState, from: string, a: Extract<LDAct, { t: 'show' }>) {
    const ok =
      Array.isArray(a.d) &&
      a.d.length === st.dice[from] &&
      a.d.every((v) => Number.isInteger(v) && v >= 1 && v <= 6) &&
      typeof a.s === 'string' &&
      (await sealOf(from, st.round, a.d, a.s)) === st.seals[from];
    // The game may have moved on while we checked.
    const now = this.table.snap?.state as LDState | undefined;
    if (!now || now.phase !== 'show' || now.round !== st.round || now.shown?.[from]) return;
    const shown = { ...(now.shown ?? {}), [from]: ok ? a.d : [] };
    if (now.order.every((id) => shown[id])) this.reveal({ ...now, shown });
    else this.table.update({ state: { ...now, shown } });
  }

  private reveal(st: LDState) {
    const bid = st.call!.bid;
    const count = countFace(st.shown ?? {}, bid.f);
    // A cup that didn't match its seal costs its owner a die (instead of the call's loser).
    const cheats = st.order.filter((id) => (st.shown?.[id] ?? []).length === 0);
    const loser = cheats[0] ?? (count >= bid.q ? st.call!.by : bid.by);
    this.table.update({ state: { ...st, phase: 'reveal', count, loser, rid: st.rid + 1 } });
    this.arm(REVEAL_MS);
  }

  private afterReveal(st: LDState) {
    const dice = { ...st.dice, [st.loser!]: Math.max(0, (st.dice[st.loser!] ?? 0) - 1) };
    const order = st.order.filter((id) => dice[id] > 0);
    if (order.length < 2) return this.finish({ ...st, dice, order });
    // The loser starts the next round (or the next player, if the loser is out).
    const starter = order.includes(st.loser!) ? st.loser! : after(st.order, st.loser!);
    this.newRound({ ...st, dice, order }, order.includes(starter) ? starter : order[0]);
  }

  private newRound(st: LDState, turn: string) {
    this.table.update({ state: { ...st, phase: 'roll', round: st.round + 1, seals: {}, turn, bid: null, call: undefined, shown: undefined, count: undefined, loser: undefined, rid: st.rid + 1 } });
    this.arm(ROLL_MS);
  }

  private finish(st: LDState) {
    this.stop();
    const winner = st.order.length === 1 ? st.order[0] : null;
    const s = this.table.snap!;
    this.table.update({ state: { ...st, phase: 'done', winner, rid: st.rid + 1 } });
    this.record(s.players.map((p) => p.id), winner ? [winner] : [], { dice: st.dice, rounds: st.round }, undefined);
  }
}

const FACES = [2, 3, 4, 5, 6];

export class LiarsDiceView implements TableView {
  readonly root = el('div', 'v2-qd v2-ld');
  private note = el('p', 'v2-note');
  private table = el('div', 'v2-ld-table');
  private cup = el('div', 'v2-ld-cup');
  private bidLine = el('div', 'v2-prompt v2-ld-bid');
  private acts = el('div', 'v2-ld-acts');
  private status = el('p', 'v2-note');
  private rid = 0;
  private key = '';
  // My roll this round (kept on this phone only, until I show it).
  private mine: { round: number; key: string; dice: number[]; salt: string } | null = null;
  private pick = { q: 1, f: 2 };

  constructor(
    private me: string,
    private act: (a: LDAct) => void,
    private names: Names,
  ) {
    this.note.id = 'ld-note';
    this.table.id = 'ld-table';
    this.cup.id = 'ld-cup';
    this.bidLine.id = 'ld-bid';
    this.acts.id = 'ld-acts';
    this.status.id = 'ld-status';
    this.status.setAttribute('aria-live', 'polite');
    this.root.append(this.note, this.table, this.bidLine, this.cup, this.acts, this.status);
  }

  // Testing: my dice this round.
  get myDice() {
    return this.mine?.dice ?? null;
  }

  show(s: Snapshot) {
    const st = s.state as LDState;
    const fresh = st.rid !== this.rid;
    this.rid = st.rid;
    const inGame = st.order.includes(this.me);
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);
    const all = total(st);
    this.note.textContent = st.phase === 'done' ? 'Game over.' : `Round ${st.round} · ${all} dice on the table · 1s count as any face.`;
    const roundKey = `${st.gid}:${st.round}`;

    // Roll for this round (on this phone) and send the seal.
    if (st.phase === 'roll' && inGame && this.mine?.key !== roundKey) {
      const dice = Array.from({ length: st.dice[this.me] }, () => cryptoInt(1, 6)).sort((a, b) => a - b);
      this.mine = { round: st.round, key: roundKey, dice, salt: randomSeed() };
      const m = this.mine;
      void sealOf(this.me, m.round, m.dice, m.salt).then((h) => this.act({ t: 'seal', rid: st.rid, round: m.round, h }));
      play('dice_shake', 0.6);
    } else if (st.phase === 'roll' && inGame && this.mine?.key === roundKey && !st.seals[this.me] && fresh) {
      // A new host after a blip: send the seal again.
      const m = this.mine;
      void sealOf(this.me, m.round, m.dice, m.salt).then((h) => this.act({ t: 'seal', rid: st.rid, round: m.round, h }));
    }
    // Someone called: lift my cup.
    if (st.phase === 'show' && inGame && !st.shown?.[this.me] && this.mine?.round === st.round && fresh) this.act({ t: 'show', rid: st.rid, round: st.round, d: this.mine.dice, s: this.mine.salt });

    // Everyone around the table: dice left (or what's under their cup, once lifted).
    this.table.replaceChildren(
      ...s.players.map((p) => {
        const row = el('div', 'v2-ld-seat' + (p.id === this.me ? ' me' : '') + (st.turn === p.id && st.phase === 'bid' ? ' turn' : '') + (st.order.includes(p.id) ? '' : ' out'));
        row.dataset.player = p.id;
        const who = this.names(p.id);
        const cups = el('span', 'dice');
        const shown = st.shown?.[p.id];
        const n = st.dice[p.id] ?? 0;
        if ((st.phase === 'reveal' || st.phase === 'show') && shown) {
          if (!shown.length && n) cups.append(el('span', 'cheat', 'Didn’t match its seal'));
          for (const v of shown) {
            const d = dieIcon(v, 22);
            if (st.call && (v === st.call.bid.f || v === 1)) d.classList.add('hit');
            cups.append(d);
          }
        } else for (let i = 0; i < n; i++) cups.append(dieIcon(p.id === this.me && this.mine?.key === roundKey ? this.mine.dice[i] : null, 22));
        const label = el('span', 'n', st.order.includes(p.id) ? (st.phase === 'roll' ? (st.seals[p.id] ? 'rolled' : 'rolling…') : `${n}`) : 'out');
        row.append(portrait(who.character ?? p.character, 28), el('b', '', p.id === this.me ? 'You' : who.name || p.name), cups, label);
        if (st.loser === p.id && st.phase === 'reveal') row.classList.add('lost');
        return row;
      }),
    );

    // The bid on the table.
    if (st.phase === 'done') this.bidLine.replaceChildren(el('span', 'k', 'Liar’s dice'), el('b', '', st.winner ? `${name(st.winner)} ${st.winner === this.me ? 'win' : 'wins'}!` : 'Nobody left'));
    else if (st.call) this.bidLine.replaceChildren(el('span', 'k', `${name(st.call.by)} called Liar!`), bidText(st.call.bid, name));
    else if (st.bid) this.bidLine.replaceChildren(el('span', 'k', 'Last bid'), bidText(st.bid, name));
    else this.bidLine.replaceChildren(el('span', 'k', st.phase === 'roll' ? 'Shaking the cups…' : 'Opening bid'), el('b', '', st.phase === 'roll' ? 'Everyone rolls in secret' : `${name(st.turn)} to start`));
    if (fresh && st.phase === 'reveal') kick(this.bidLine, 'v2-pop');

    // My cup.
    if (inGame && this.mine?.key === roundKey && st.phase !== 'done') {
      const tray = el('div', 'v2-ld-mine');
      for (const v of this.mine.dice) {
        const d = dieIcon(v, 40);
        if (st.bid && (v === st.bid.f || v === 1)) d.classList.add('hit');
        tray.append(d);
      }
      this.cup.replaceChildren(el('span', 'k', 'Under your cup'), tray);
    } else this.cup.replaceChildren();

    // My moves.
    const key = `${roundKey}:${st.phase}:${st.turn}:${st.bid?.q}:${st.bid?.f}`;
    if (key !== this.key || st.phase === 'done') {
      this.key = key;
      this.acts.replaceChildren();
      if (st.phase === 'bid' && st.turn === this.me) this.moves(st, all);
      else if (st.phase === 'bid') this.acts.append(timerBar(TURN_MS, 'ld-timer'));
      if (st.phase === 'done' && fresh) this.done(s, st);
      if (fresh && st.phase === 'bid' && st.turn === this.me) {
        play('challenge', 0.5);
        buzz(15);
      }
    }

    // What's happening.
    if (st.phase === 'roll') this.status.textContent = 'Everyone rolls under their cup. Only you can see yours.';
    else if (st.phase === 'bid') this.status.textContent = st.turn === this.me ? 'Your turn: raise the bid, or call Liar!' : `${name(st.turn)} is thinking…`;
    else if (st.phase === 'show') this.status.textContent = 'Cups up…';
    else if (st.phase === 'reveal' && st.call) {
      const b = st.call.bid;
      this.status.textContent = `There ${st.count === 1 ? 'was' : 'were'} ${st.count} × ${b.f} (1s count). ${name(st.loser!)} ${st.loser === this.me ? 'lose' : 'loses'} a die.`;
      if (fresh && st.loser === this.me) {
        play('error', 0.4);
        buzz([20, 40, 20]);
      } else if (fresh) play('dice_throw', 0.5);
    } else this.status.textContent = '';
  }

  private moves(st: LDState, all: number) {
    const low = lowestRaise(st.bid);
    if (!raises(this.pick, st.bid, all)) this.pick = { ...low };
    const qty = el('div', 'v2-ld-qty');
    const minus = el('button', 'dh-iconbtn');
    minus.type = 'button';
    minus.id = 'ld-less';
    minus.setAttribute('aria-label', 'Fewer');
    minus.append(icon('arrow-down'));
    const plus = el('button', 'dh-iconbtn');
    plus.type = 'button';
    plus.id = 'ld-more';
    plus.setAttribute('aria-label', 'More');
    plus.append(icon('arrow-up'));
    const q = el('b', 'q');
    q.id = 'ld-q';
    qty.append(minus, q, el('span', 'x', '×'), plus);
    const faces = el('div', 'v2-ld-faces');
    const fb = FACES.map((f) => {
      const b = el('button', 'v2-ld-face');
      b.type = 'button';
      b.dataset.face = String(f);
      b.setAttribute('aria-label', `${f}s`);
      b.append(dieIcon(f, 34));
      b.addEventListener('click', () => {
        this.pick.f = f;
        sync();
      });
      faces.append(b);
      return b;
    });
    const go = el('button', 'dh-btn');
    go.type = 'button';
    go.id = 'ld-go';
    const liar = el('button', 'dh-btn dh-btn--danger');
    liar.type = 'button';
    liar.id = 'ld-liar';
    liar.append(document.createTextNode('Liar!'));
    liar.disabled = !st.bid;
    const sync = () => {
      this.pick.q = Math.max(1, Math.min(all, this.pick.q));
      q.textContent = String(this.pick.q);
      const ok = raises(this.pick, st.bid, all);
      for (const b of fb) b.setAttribute('aria-pressed', String(Number(b.dataset.face) === this.pick.f));
      go.disabled = !ok;
      go.textContent = ok ? `Bid ${this.pick.q} × ${this.pick.f}s` : 'Raise the bid';
      minus.disabled = this.pick.q <= 1;
      plus.disabled = this.pick.q >= all;
    };
    minus.addEventListener('click', () => {
      this.pick.q--;
      sync();
    });
    plus.addEventListener('click', () => {
      this.pick.q++;
      sync();
    });
    go.addEventListener('click', () => {
      if (!raises(this.pick, st.bid, all)) return;
      go.disabled = liar.disabled = true;
      play('click', 0.5);
      this.act({ t: 'bid', rid: st.rid, q: this.pick.q, f: this.pick.f });
    });
    liar.addEventListener('click', () => {
      go.disabled = liar.disabled = true;
      play('confirm', 0.5);
      buzz([10, 30, 10]);
      this.act({ t: 'call', rid: st.rid });
    });
    sync();
    const row = el('div', 'v2-hl-btns');
    row.append(go, liar);
    this.acts.append(qty, faces, row, timerBar(TURN_MS, 'ld-timer'));
  }

  private done(s: Snapshot, st: LDState) {
    const winners = st.winner ? [st.winner] : [];
    const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), winTitle(winners, this.me, this.names, s.players));
    res.id = 'ld-result';
    this.acts.replaceChildren(res);
    if (s.players.some((p) => p.id === this.me)) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
    if (winners.includes(this.me)) requestAnimationFrame(() => burst(res, 24));
  }

  destroy() {}
}

// "Ben: 4 × [5]"
function bidText(b: Bid, name: (id: string) => string) {
  const line = el('b', 'v2-ld-bidtext');
  line.append(document.createTextNode(`${name(b.by)}: ${b.q} ×`), dieIcon(b.f, 26));
  return line;
}
