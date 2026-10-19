import { el } from '../ui/modal';
import { play } from '../ui/sounds';
import { portrait } from '../ui/portrait';
import { burst, buzz, floatText, kick, timerBar } from './juice';
import { checkSeed, randomSeed, rng, sha256 } from './fair';
import { nameOf, pointsRows, topScorers, winTitle } from './kit';
import QUIZ from './quiz.json';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Quiz night: 2-8 players. 8 multiple-choice questions (quiz.json, family-friendly general knowledge),
// everyone answers in secret within 15 s, then the reveal: the right answer, who picked what, and points.
// The first right answer gets 3, the second 2, every other right answer 1. The question order comes from
// the host's seed (committed at the start, shown at the end). Messages per question: 1 answer + 1
// "who has answered" snapshot per player, then the reveal and the next question: 8 players = 18.

export const QUIZ_ROUNDS = 8;
const ANSWER_MS = 15_000;
const REVEAL_MS = 5_500;

type Q = { c: string; q: string; a: string[] };
const BANK = QUIZ.questions as Q[];

export type QuizQuestion = { c: string; q: string; opts: string[] };
export type QuizState = {
  phase: 'ask' | 'reveal' | 'done';
  rid: number;
  round: number; // 1..QUIZ_ROUNDS
  q: QuizQuestion;
  answered: string[]; // who has answered (not what) while asking
  right?: number; // revealed: the right option
  picks?: Record<string, number>; // revealed: who picked what
  gained?: Record<string, number>; // revealed: points this question
  points: Record<string, number>;
  commit: string;
  seed?: string;
};
export type QuizAct = { t: 'ans'; rid: number; i: number };

// The game's questions, in an order fixed by the seed, each with its options shuffled. `right` is the
// index of the right answer in `opts`.
export function pickQuestions(seed: string, n = QUIZ_ROUNDS) {
  const r = rng(`${seed}:quiz`);
  const shuffle = <T>(xs: T[]) => {
    const a = [...xs];
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [a[k], a[j]] = [a[j], a[k]];
    }
    return a;
  };
  return shuffle(BANK)
    .slice(0, n)
    .map((x) => {
      const opts = shuffle(x.a);
      return { q: { c: x.c, q: x.q, opts }, right: opts.indexOf(x.a[0]) };
    });
}

// Points for the n-th right answer (0-based): 3, 2, then 1.
export const quizPoints = (n: number) => (n === 0 ? 3 : n === 1 ? 2 : 1);

export class QuizHost implements TableHost {
  private seed = '';
  private qs: { q: QuizQuestion; right: number }[] = [];
  private picks: Record<string, number> = {};
  private order: string[] = []; // who answered right, in order
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    this.qs = pickQuestions(this.seed);
    this.reset();
    const st: QuizState = { phase: 'ask', rid: 1, round: 1, q: this.qs[0].q, answered: [], points: Object.fromEntries(players.map((p) => [p.id, 0])), commit: await sha256(this.seed) };
    this.table.start('quiz', players, st);
    this.arm(ANSWER_MS);
  }

  // The old host had the answers: this question is asked again, later ones come from a new seed.
  async takeover(s: Snapshot) {
    const st = s.state as QuizState;
    if (s.game !== 'quiz' || st.phase === 'done') return;
    this.seed = randomSeed();
    this.qs = pickQuestions(this.seed);
    const same = BANK.find((x) => x.q === st.q.q);
    if (same) this.qs[st.round - 1] = { q: st.q, right: st.q.opts.indexOf(same.a[0]) };
    this.reset();
    const players = s.players.filter((p) => p.id === this.table.id || this.table.people.some((q) => q.id === p.id));
    const commit = await sha256(this.seed);
    if (st.phase === 'reveal') {
      this.table.update({ players, state: { ...st, commit, rid: st.rid + 1 } });
      this.arm(REVEAL_MS / 2);
    } else {
      this.table.update({ players, state: { ...st, commit, answered: [], rid: st.rid + 1 } });
      this.arm(ANSWER_MS);
    }
  }

  onAction(from: string, act: unknown) {
    const a = act as QuizAct;
    const s = this.table.snap;
    const st = s?.state as QuizState | undefined;
    if (!s || !st || s.game !== 'quiz' || st.phase !== 'ask' || a?.t !== 'ans' || a.rid !== st.rid) return;
    if (!Number.isInteger(a.i) || a.i < 0 || a.i >= st.q.opts.length) return;
    if (!s.players.some((p) => p.id === from) || from in this.picks) return;
    this.picks[from] = a.i;
    if (a.i === this.qs[st.round - 1]?.right) this.order.push(from);
    if (this.waiting().length === 0) this.reveal();
    else this.table.update({ state: { ...st, answered: Object.keys(this.picks) } });
  }

  onPeople() {
    const st = this.table.snap?.state as QuizState | undefined;
    if (st?.phase === 'ask' && this.table.snap?.game === 'quiz' && Object.keys(this.picks).length && this.waiting().length === 0) this.reveal();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private reset() {
    this.picks = {};
    this.order = [];
  }

  private waiting() {
    const s = this.table.snap!;
    const here = new Set(this.table.people.map((p) => p.id));
    here.add(this.table.id);
    return s.players.filter((p) => here.has(p.id) && !(p.id in this.picks));
  }

  private arm(ms: number) {
    this.stop();
    this.timer = setTimeout(() => {
      const st = this.table.snap?.state as QuizState | undefined;
      if (st?.phase === 'ask') this.reveal();
      else if (st?.phase === 'reveal') this.next();
    }, ms);
  }

  private reveal() {
    const s = this.table.snap!;
    const st = s.state as QuizState;
    const points = { ...st.points };
    const gained: Record<string, number> = {};
    this.order.forEach((id, n) => {
      gained[id] = quizPoints(n);
      points[id] = (points[id] ?? 0) + gained[id];
    });
    this.table.update({ state: { ...st, phase: 'reveal', right: this.qs[st.round - 1].right, picks: { ...this.picks }, gained, answered: Object.keys(this.picks), points, rid: st.rid + 1 } });
    this.arm(REVEAL_MS);
  }

  private next() {
    const s = this.table.snap!;
    const st = s.state as QuizState;
    this.reset();
    if (st.round >= QUIZ_ROUNDS) {
      this.stop();
      this.table.update({ state: { ...st, phase: 'done', seed: this.seed, rid: st.rid + 1 } });
      this.record(s.players.map((p) => p.id), topScorers(st.points), { points: st.points }, this.seed);
      return;
    }
    const round = st.round + 1;
    this.table.update({ state: { ...st, phase: 'ask', round, q: this.qs[round - 1].q, answered: [], right: undefined, picks: undefined, gained: undefined, rid: st.rid + 1 } });
    this.arm(ANSWER_MS);
  }
}

const LETTERS = ['A', 'B', 'C', 'D'];

export class QuizView implements TableView {
  readonly root = el('div', 'v2-qd');
  private note = el('p', 'v2-note');
  private card = el('div', 'v2-prompt');
  private opts = el('div', 'v2-quiz');
  private status = el('p', 'v2-note');
  private list = el('div', 'v2-list');
  private rid = 0;
  private key = '';
  private mine: number | null = null;

  constructor(
    private me: string,
    private act: (a: QuizAct) => void,
    private names: Names,
  ) {
    this.note.id = 'quiz-note';
    this.card.id = 'quiz-card';
    this.opts.id = 'quiz-opts';
    this.status.id = 'quiz-status';
    this.status.setAttribute('aria-live', 'polite');
    this.list.id = 'quiz-list';
    this.root.append(this.note, this.card, this.opts, this.status, this.list);
  }

  show(s: Snapshot) {
    const st = s.state as QuizState;
    const fresh = st.rid !== this.rid;
    this.rid = st.rid;
    const key = `${s.host}:${st.round}`;
    const redraw = fresh || key !== this.key;
    if (key !== this.key) {
      this.key = key;
      this.mine = null;
    }
    const playing = s.players.some((p) => p.id === this.me);
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);
    this.note.textContent = st.phase === 'done' ? 'Game over.' : `Question ${st.round} of ${QUIZ_ROUNDS}${playing ? '' : ' · watching'}. First right answer 3, second 2, the rest 1.`;

    // Only rebuild the card and buttons when the game moves on, never under a finger.
    if (redraw) {
      if (st.phase !== 'done') {
        this.card.replaceChildren(el('span', 'k', st.q.c), el('b', '', st.q.q));
        if (fresh && st.phase === 'ask') play('card_flip', 0.6);
      }
      this.opts.replaceChildren();
      if (st.phase !== 'done') {
        const picks = st.picks ?? {};
        st.q.opts.forEach((text, i) => {
          const b = el('button', `v2-quiz-opt o${i}`);
          b.type = 'button';
          b.id = `quiz-${i}`;
          b.dataset.opt = String(i);
          const mine = st.phase === 'reveal' ? picks[this.me] === i : this.mine === i;
          if (mine) b.classList.add('picked');
          if (st.phase === 'reveal') b.classList.add(i === st.right ? 'right' : mine ? 'wrong' : 'dim');
          b.disabled = !playing || st.phase !== 'ask' || this.mine !== null;
          b.append(el('span', 'ab', LETTERS[i]), el('span', 't', text));
          if (st.phase === 'reveal') {
            const faces = el('span', 'who');
            for (const id of Object.keys(picks).filter((id) => picks[id] === i)) {
              const f = portrait(this.names(id).character ?? 0, 18);
              f.title = name(id);
              faces.append(f);
            }
            b.append(faces);
          }
          b.addEventListener('click', () => {
            if (this.mine !== null || st.phase !== 'ask') return;
            this.mine = i;
            play('click', 0.5);
            buzz(10);
            kick(b, 'v2-pop');
            this.opts.querySelectorAll('button').forEach((x) => {
              (x as HTMLButtonElement).disabled = true;
              x.classList.toggle('picked', x === b);
            });
            this.act({ t: 'ans', rid: st.rid, i });
          });
          this.opts.append(b);
        });
        if (st.phase === 'ask' && playing) this.opts.append(timerBar(ANSWER_MS, 'quiz-timer'));
        if (st.phase === 'reveal' && fresh && playing) {
          const got = st.gained?.[this.me];
          const mineBtn = this.opts.querySelector(`[data-opt="${picks[this.me]}"]`);
          if (got) {
            play('coin', 0.6);
            if (mineBtn) setTimeout(() => floatText(mineBtn, `+${got}`, 'good'), 300);
          } else if (picks[this.me] !== undefined) {
            play('error', 0.35);
            buzz([20, 40, 20]);
            if (mineBtn) kick(mineBtn, 'v2-shake');
          }
        }
      }
    }
    if (st.phase === 'ask') {
      const left = s.players.filter((p) => !st.answered.includes(p.id));
      this.status.textContent = playing && this.mine === null ? 'Pick an answer. Nobody sees it until the reveal.' : left.length ? `Waiting for ${left.map((p) => name(p.id)).join(', ')}…` : 'Revealing…';
    } else if (st.phase === 'reveal') {
      const mine = st.picks?.[this.me];
      const got = st.gained?.[this.me];
      const nRight = Object.keys(st.gained ?? {}).length;
      this.status.textContent = got
        ? `Right! +${got}`
        : mine === undefined
          ? playing
            ? 'Too slow this time.'
            : `${nRight} got it right.`
          : `Not this time. It was ${LETTERS[st.right ?? 0]}: ${st.q.opts[st.right ?? 0]}.`;
    } else {
      const winners = topScorers(st.points);
      this.status.textContent = '';
      this.card.replaceChildren(el('span', 'k', 'Quiz night'), el('b', '', 'Final scores'));
      const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), winTitle(winners, this.me, this.names, s.players));
      res.id = 'quiz-result';
      if (redraw) {
        const fair = el('p', 'v2-note', 'Checking the questions were fair…');
        fair.id = 'quiz-fair';
        this.opts.replaceChildren(res, fair);
        if (fresh && playing) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
        if (fresh && winners.includes(this.me)) requestAnimationFrame(() => burst(res, 24));
        // The seed matches the hash shown at the start, and picks the very same last question.
        void (async () => {
          const ok = !!st.seed && (await checkSeed(st.seed, st.commit)) && pickQuestions(st.seed)[st.round - 1]?.q.q === st.q.q;
          fair.textContent = ok ? 'Fair: the questions match the host’s sealed list.' : 'Couldn’t check the questions.';
          fair.dataset.fair = String(ok);
        })();
      }
    }
    this.list.replaceChildren(...pointsRows(s.players, st.points, this.me, this.names, { chip: (id) => (st.phase === 'ask' && st.answered.includes(id) ? 'answered' : '') }));
  }

  destroy() {}
}
