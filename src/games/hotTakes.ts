import { el } from '../ui/modal';
import { play } from '../ui/sounds';
import { burst, buzz, floatText, kick, timerBar } from './juice';
import { portrait } from '../ui/portrait';
import { randomSeed, rng, sha256 } from './fair';
import { nameOf, pointsRows, topScorers, winTitle } from './kit';
import PROMPTS from './prompts.json';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Would you rather / Hot takes (UPDATE.md Phase 13): any room, best with 3 or more. A prompt card shows
// ("Would you rather … or …?", or a hot take to agree or disagree with); everyone votes A or B in secret,
// then the reveal shows bars with names. A point for siding with the majority. 5 prompts a game.
// ~120 built-in prompts (prompts.json, family-friendly) plus the room owner's own (rooms.prompts,
// "option A|option B"), picked in an order from the host's seed.
// Messages per prompt: 1 vote + 1 "who has voted" snapshot per player, then the reveal and the next
// prompt: 8 players = 18.

export const WYR_ROUNDS = 5;
const VOTE_MS = 25_000; // then whoever hasn't voted sits this one out
const REVEAL_MS = 8_000; // bars on screen before the next prompt

export type Choice = 'a' | 'b';
export type Prompt = { take?: string; a: string; b: string; own?: boolean }; // take: a hot take (a = agree, b = disagree); own: the room's
export type WYRState = {
  phase: 'vote' | 'reveal' | 'done';
  rid: number;
  round: number; // 1..WYR_ROUNDS
  prompt: Prompt;
  voted: string[]; // who has voted (not what) while voting
  votes?: Record<string, Choice>; // revealed
  points: Record<string, number>;
  commit: string;
  seed?: string;
};
export type WYRAct = { t: 'vote'; rid: number; c: Choice };

// "A|B" (prompts.json and rooms.prompts) to a prompt.
export function parsePrompt(text: string, own = false): Prompt | null {
  const [a, b, more] = text.split('|').map((x) => x.trim());
  if (!a || !b || more !== undefined) return null;
  return own ? { a, b, own } : { a, b };
}

export const BUILT_IN = { wyr: PROMPTS.wyr as string[], takes: PROMPTS.takes as string[] };

// The prompts for a game, in an order fixed by the seed: the room's own first in line every other
// prompt (when there are any), otherwise built-in, with about one hot take in four.
export function pickPrompts(seed: string, own: string[], n = WYR_ROUNDS): Prompt[] {
  const r = rng(`${seed}:prompts`);
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [a[k], a[j]] = [a[j], a[k]];
    }
    return a;
  };
  const mine = shuffle(own.map((t) => parsePrompt(t, true)).filter((p): p is Prompt => !!p));
  const wyr = shuffle(BUILT_IN.wyr.map((t) => parsePrompt(t)!));
  const takes = shuffle(BUILT_IN.takes.map((take) => ({ take, a: 'Agree', b: 'Disagree' })));
  const out: Prompt[] = [];
  for (let i = 0; i < n; i++) {
    if (mine.length && i % 2 === 0) out.push(mine.shift()!);
    else if (takes.length && r() < 0.25) out.push(takes.shift()!);
    else out.push(wyr.shift()!);
  }
  return out;
}

// The majority's choice (null on a tie or no votes).
export function majority(votes: Record<string, Choice>): Choice | null {
  const a = Object.values(votes).filter((c) => c === 'a').length;
  const b = Object.values(votes).filter((c) => c === 'b').length;
  return a === b ? null : a > b ? 'a' : 'b';
}

// Host side. The host keeps the votes to itself until everyone has voted.
export class HotTakesHost implements TableHost {
  private seed = '';
  private prompts: Prompt[] = [];
  private votes: Record<string, Choice> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
    private own: () => string[],
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    this.prompts = pickPrompts(this.seed, this.own());
    const st: WYRState = { phase: 'vote', rid: 1, round: 1, prompt: this.prompts[0], voted: [], points: Object.fromEntries(players.map((p) => [p.id, 0])), commit: await sha256(this.seed) };
    this.votes = {};
    this.table.start('wyr', players, st);
    this.arm(VOTE_MS);
  }

  // The previous host left with the votes: this prompt's voting starts again, and later prompts come from a new seed.
  async takeover(s: Snapshot) {
    const st = s.state as WYRState;
    if (s.game !== 'wyr' || st.phase === 'done') return;
    this.seed = randomSeed();
    this.prompts = pickPrompts(this.seed, this.own());
    this.prompts[st.round - 1] = st.prompt;
    this.votes = {};
    const players = s.players.filter((p) => p.id === this.table.id || this.table.people.some((q) => q.id === p.id));
    if (st.phase === 'reveal') {
      this.table.update({ players, state: { ...st, commit: await sha256(this.seed), rid: st.rid + 1 } });
      this.arm(REVEAL_MS / 2);
    } else {
      this.table.update({ players, state: { ...st, commit: await sha256(this.seed), voted: [], rid: st.rid + 1 } });
      this.arm(VOTE_MS);
    }
  }

  onAction(from: string, act: unknown) {
    const a = act as WYRAct;
    const s = this.table.snap;
    const st = s?.state as WYRState | undefined;
    if (!s || !st || s.game !== 'wyr' || st.phase !== 'vote' || a?.rid !== st.rid || (a.c !== 'a' && a.c !== 'b')) return;
    if (!s.players.some((p) => p.id === from) || from in this.votes) return;
    this.votes[from] = a.c;
    if (this.waiting().length === 0) this.reveal();
    else this.table.update({ state: { ...st, voted: Object.keys(this.votes) } });
  }

  onPeople() {
    const st = this.table.snap?.state as WYRState | undefined;
    if (st?.phase === 'vote' && this.table.snap?.game === 'wyr' && Object.keys(this.votes).length && this.waiting().length === 0) this.reveal();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private waiting() {
    const s = this.table.snap!;
    const here = new Set(this.table.people.map((p) => p.id));
    here.add(this.table.id);
    return s.players.filter((p) => here.has(p.id) && !(p.id in this.votes));
  }

  private arm(ms: number) {
    this.stop();
    this.timer = setTimeout(() => {
      const st = this.table.snap?.state as WYRState | undefined;
      if (st?.phase === 'vote') this.reveal();
      else if (st?.phase === 'reveal') this.next();
    }, ms);
  }

  private reveal() {
    const s = this.table.snap!;
    const st = s.state as WYRState;
    const votes = { ...this.votes };
    const side = majority(votes);
    const points = { ...st.points };
    if (side && Object.keys(votes).length >= 2) for (const [id, c] of Object.entries(votes)) if (c === side) points[id] = (points[id] ?? 0) + 1;
    this.table.update({ state: { ...st, phase: 'reveal', votes, voted: Object.keys(votes), points, rid: st.rid + 1 } });
    this.arm(REVEAL_MS);
  }

  private next() {
    const s = this.table.snap!;
    const st = s.state as WYRState;
    this.votes = {};
    if (st.round >= WYR_ROUNDS) {
      this.stop();
      this.table.update({ state: { ...st, phase: 'done', seed: this.seed, rid: st.rid + 1 } });
      this.record(s.players.map((p) => p.id), topScorers(st.points), { points: st.points }, this.seed);
      return;
    }
    const round = st.round + 1;
    this.table.update({ state: { ...st, phase: 'vote', round, prompt: this.prompts[round - 1], voted: [], votes: undefined, rid: st.rid + 1 } });
    this.arm(VOTE_MS);
  }
}

// Everyone's screen.
export class HotTakesView implements TableView {
  readonly root = el('div', 'v2-qd');
  private note = el('p', 'v2-note');
  private card = el('div', 'v2-prompt');
  private sides = el('div', 'v2-wyr');
  private status = el('p', 'v2-note');
  private list = el('div', 'v2-list');
  private rid = 0;
  private mine: Choice | null = null; // our vote this prompt
  private key = '';

  constructor(
    private me: string,
    private act: (a: WYRAct) => void,
    private names: Names,
  ) {
    this.note.id = 'wyr-note';
    this.card.id = 'wyr-card';
    this.sides.id = 'wyr-sides';
    this.status.id = 'wyr-status';
    this.status.setAttribute('aria-live', 'polite');
    this.list.id = 'wyr-list';
    this.root.append(this.note, this.card, this.sides, this.status, this.list);
  }

  show(s: Snapshot) {
    const st = s.state as WYRState;
    const fresh = st.rid !== this.rid;
    this.rid = st.rid;
    // A new prompt, or a new host (who restarts the voting): our vote is still to make.
    const key = `${s.host}:${st.round}`;
    const redraw = fresh || key !== this.key;
    if (key !== this.key) {
      this.key = key;
      this.mine = null;
    }
    const playing = s.players.some((p) => p.id === this.me);
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);

    this.note.textContent = st.phase === 'done' ? 'Game over.' : `Prompt ${st.round} of ${WYR_ROUNDS}${playing ? '' : ' · watching'}. A point for siding with the majority.`;
    // The card and the A / B buttons only change when the game moves on (not on each "Ben voted"),
    // so a tap is never lost to the buttons being rebuilt under the finger.
    if (redraw) {
      const p = st.prompt;
      const head = el('span', 'k', p.take ? 'Hot take' : 'Would you rather…');
      if (p.own) head.textContent += ' · this room’s';
      const q = el('b', '', p.take ?? `${p.a} or ${p.b}?`);
      this.card.replaceChildren(head, q);
      if (fresh && st.phase === 'vote') play('card_flip', 0.6);
      if (fresh && st.phase === 'reveal') play('card_place', 0.7);

      this.sides.replaceChildren();
      if (st.phase !== 'done') {
        const votes = st.phase === 'reveal' ? (st.votes ?? {}) : {};
        const total = Object.keys(votes).length;
        const side = st.phase === 'reveal' ? majority(votes) : null;
        for (const c of ['a', 'b'] as const) {
          const picked = st.phase === 'reveal' ? st.votes?.[this.me] === c : this.mine === c;
          const b = el('button', 'v2-side' + (picked ? ' picked' : '') + (side === c ? ' top' : ''));
          b.type = 'button';
          b.id = `wyr-${c}`;
          b.dataset.choice = c;
          b.disabled = !playing || st.phase !== 'vote' || !!this.mine;
          b.append(el('span', 'ab', c.toUpperCase()), el('span', 't', c === 'a' ? p.a : p.b));
          if (st.phase === 'reveal') {
            const who = Object.keys(votes).filter((id) => votes[id] === c);
            const pct = total ? Math.round((who.length / total) * 100) : 0;
            const bar = el('span', 'bar');
            const fill = el('i');
            // Grow from empty so the reveal reads as a count-up.
            fill.style.width = fresh ? '0%' : `${pct}%`;
            if (fresh) requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
            bar.append(fill);
            const faces = el('span', 'who');
            for (const id of who) {
              const f = portrait(this.names(id).character ?? 0, 20);
              f.title = name(id);
              faces.append(f);
            }
            const n = el('span', 'n', `${who.length} · ${pct}%`);
            n.dataset.count = String(who.length);
            b.append(bar, n, faces);
            b.setAttribute('aria-label', `${c.toUpperCase()}: ${who.length ? who.map(name).join(', ') : 'nobody'}`);
          }
          b.addEventListener('click', () => {
            if (this.mine || st.phase !== 'vote') return;
            this.mine = c;
            play('click', 0.5);
            buzz(10);
            kick(b, 'v2-pop');
            this.sides.querySelectorAll('button').forEach((x) => {
              (x as HTMLButtonElement).disabled = true;
              x.classList.toggle('picked', x === b);
            });
            this.act({ t: 'vote', rid: st.rid, c });
          });
          this.sides.append(b);
        }
        if (st.phase === 'vote' && playing) this.sides.append(timerBar(VOTE_MS, 'wyr-timer'));
        if (st.phase === 'reveal' && fresh) {
          const side = majority(st.votes ?? {});
          const mine = st.votes?.[this.me];
          const myBtn = mine ? this.sides.querySelector(`[data-choice="${mine}"]`) : null;
          if (myBtn && side && mine === side && Object.keys(st.votes ?? {}).length >= 2) setTimeout(() => floatText(myBtn, '+1', 'good'), 450);
        }
      }
    }
    if (st.phase === 'vote') {
      const left = s.players.filter((pl) => !st.voted.includes(pl.id));
      this.status.textContent = playing && !this.mine ? 'Pick one. Nobody sees until everyone has voted.' : left.length ? `Waiting for ${left.map((pl) => name(pl.id)).join(', ')}…` : 'Revealing…';
    } else if (st.phase === 'reveal') {
      const side = majority(st.votes ?? {});
      const mine = st.votes?.[this.me];
      const n = Object.keys(st.votes ?? {}).length;
      this.status.textContent = n < 2 ? 'Not enough votes for a point this time.' : !side ? 'Split down the middle: no points.' : mine === side ? 'You’re with the majority: +1' : mine ? 'You’re in the minority this time.' : 'The majority picked ' + side.toUpperCase() + '.';
    } else {
      const winners = topScorers(st.points);
      this.status.textContent = '';
      const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), winTitle(winners, this.me, this.names, s.players));
      res.id = 'wyr-result';
      this.sides.querySelector('#wyr-result')?.remove(); // shown again (people coming and going): one line only
      this.sides.append(res);
      if (fresh && playing) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
      if (fresh && winners.includes(this.me)) requestAnimationFrame(() => burst(res, 24));
    }
    this.list.replaceChildren(
      ...pointsRows(s.players, st.points, this.me, this.names, { chip: (id) => (st.phase === 'vote' && st.voted.includes(id) ? 'voted' : '') }),
    );
  }

  destroy() {}
}
