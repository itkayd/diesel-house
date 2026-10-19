import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { burst, buzz, floatText, kick, timerBar } from './juice';
import { checkSeed, randomSeed, rng, sha256, shuffleWith } from './fair';
import { nameOf, pointsRows, topScorers, winTitle } from './kit';
import WORDS from './words.json';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Letter rush: 2-8 players, 3 rounds. A letter and four categories ("An animal", "A food"…); everyone
// writes an answer for each, starting with that letter, in secret, within 60 s. Then the answers are
// shown side by side and anyone can thumbs-down an answer that doesn't count: half of the others
// voting it down rules it out. A good answer nobody else had is 2 points, one somebody else had too is
// 1. The letters and categories come from the host's seed (sealed at the start, shown at the end).
// Messages per round: 1 answer + 1 "who's done" snapshot per player, the judging (a snapshot per
// thumbs-down), the result and the next round.

export const LR_ROUNDS = 3;
export const LR_CATS = 4;
export const WRITE_MS = 60_000;
const GRACE_MS = 2_500; // answers sent as the timer runs out still count
const JUDGE_MS = 25_000;
const RESULT_MS = 6_000;
const MAX_LEN = 30;
const LETTERS = 'ABCDEFGHIJKLMNOPRSTW';
const CATEGORIES = WORDS.categories as string[];

export type LRState = {
  phase: 'write' | 'judge' | 'result' | 'done';
  rid: number;
  round: number;
  letter: string;
  cats: string[];
  done: string[]; // who has handed in (not what) while writing
  answers?: Record<string, string[]>; // shown from judging on
  downs?: Record<string, string[]>; // "player:i" -> who voted that answer down
  okd?: string[]; // who is happy with the judging (it ends when everyone is)
  got?: Record<string, number[]>; // result: points for each answer
  points: Record<string, number>;
  commit: string;
  seed?: string;
};
export type LRAct = { t: 'ans'; rid: number; a: string[] } | { t: 'down'; rid: number; key: string; on: boolean } | { t: 'ok'; rid: number };

// The game's letters and categories, fixed by the seed.
export function pickRounds(seed: string, n = LR_ROUNDS) {
  const r = rng(`${seed}:letters`);
  const letters = shuffleWith(r, LETTERS.split('')).slice(0, n);
  const cats = shuffleWith(r, CATEGORIES);
  return letters.map((letter, i) => ({ letter, cats: cats.slice(i * LR_CATS, (i + 1) * LR_CATS) }));
}

// For comparing answers: lower case, letters and digits only, no "the"/"a" in front.
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]/g, '');

// Does it count before any thumbs-down: something there, two letters or more, the right first letter.
export const fits = (answer: string, letter: string) => {
  const n = norm(answer);
  return n.length >= 2 && n[0] === letter.toLowerCase();
};

// Points for every answer: 2 for a good one nobody else had, 1 for a good one someone else had too, 0
// otherwise. Voted down: by at least half of the other players (and at least one).
export function score(st: Pick<LRState, 'letter' | 'cats'>, answers: Record<string, string[]>, downs: Record<string, string[]>, players: string[]) {
  const others = Math.max(1, players.length - 1);
  const good = (id: string, i: number) => {
    const a = answers[id]?.[i] ?? '';
    const votes = (downs[`${id}:${i}`] ?? []).filter((v) => v !== id).length;
    return fits(a, st.letter) && votes < Math.max(1, Math.ceil(others / 2));
  };
  const got: Record<string, number[]> = {};
  for (const id of players) {
    got[id] = st.cats.map((_, i) => {
      if (!good(id, i)) return 0;
      const mine = norm(answers[id][i]);
      const shared = players.some((o) => o !== id && good(o, i) && norm(answers[o][i]) === mine);
      return shared ? 1 : 2;
    });
  }
  return got;
}

const clean = (a: unknown) =>
  Array.from({ length: LR_CATS }, (_, i) => (Array.isArray(a) && typeof a[i] === 'string' ? (a[i] as string).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN) : ''));

export class LetterRushHost implements TableHost {
  private seed = '';
  private rounds: { letter: string; cats: string[] }[] = [];
  private answers: Record<string, string[]> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    this.rounds = pickRounds(this.seed);
    this.answers = {};
    const r = this.rounds[0];
    const st: LRState = { phase: 'write', rid: 1, round: 1, letter: r.letter, cats: r.cats, done: [], points: Object.fromEntries(players.map((p) => [p.id, 0])), commit: await sha256(this.seed) };
    this.table.start('letters', players, st);
    this.arm(WRITE_MS + GRACE_MS);
  }

  // The answers handed in to the old host are gone: this round is written again (later rounds come from
  // a new seed). Judging or results carry on as they were.
  async takeover(s: Snapshot) {
    const st = s.state as LRState;
    if (s.game !== 'letters' || st.phase === 'done') return;
    this.seed = randomSeed();
    this.rounds = pickRounds(this.seed);
    this.rounds[st.round - 1] = { letter: st.letter, cats: st.cats };
    this.answers = { ...(st.answers ?? {}) };
    const players = s.players.filter((p) => p.id === this.table.id || this.table.people.some((q) => q.id === p.id));
    const commit = await sha256(this.seed);
    if (st.phase === 'write') {
      this.answers = {};
      this.table.update({ players, state: { ...st, commit, done: [], rid: st.rid + 1 } });
      this.arm(WRITE_MS + GRACE_MS);
    } else {
      this.table.update({ players, state: { ...st, commit, rid: st.rid + 1 } });
      this.arm(st.phase === 'judge' ? JUDGE_MS / 2 : RESULT_MS / 2);
    }
  }

  onAction(from: string, act: unknown) {
    const a = act as LRAct;
    const s = this.table.snap;
    const st = s?.state as LRState | undefined;
    if (!s || !st || s.game !== 'letters' || a?.rid !== st.rid || !s.players.some((p) => p.id === from)) return;
    if (a.t === 'ans' && st.phase === 'write' && !(from in this.answers)) {
      this.answers[from] = clean(a.a);
      if (this.waiting(st.done.concat(from)).length === 0) this.judge();
      else this.table.update({ state: { ...st, done: Object.keys(this.answers) } });
    } else if (a.t === 'down' && st.phase === 'judge' && typeof a.key === 'string') {
      const [who, i] = a.key.split(':');
      if (who === from || !st.answers?.[who] || !(Number(i) >= 0 && Number(i) < LR_CATS)) return;
      const downs = { ...(st.downs ?? {}) };
      const now = new Set(downs[a.key] ?? []);
      if (a.on) now.add(from);
      else now.delete(from);
      downs[a.key] = [...now];
      this.table.update({ state: { ...st, downs } });
    } else if (a.t === 'ok' && st.phase === 'judge' && !(st.okd ?? []).includes(from)) {
      const okd = [...(st.okd ?? []), from];
      if (this.waiting(okd).length === 0) this.result({ ...st, okd });
      else this.table.update({ state: { ...st, okd } });
    }
  }

  onPeople() {
    const st = this.table.snap?.state as LRState | undefined;
    if (this.table.snap?.game !== 'letters' || !st) return;
    if (st.phase === 'write' && Object.keys(this.answers).length && this.waiting(Object.keys(this.answers)).length === 0) this.judge();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // Players still here who aren't in `ids`.
  private waiting(ids: string[]) {
    const s = this.table.snap!;
    const here = new Set(this.table.people.map((p) => p.id));
    here.add(this.table.id);
    return s.players.filter((p) => here.has(p.id) && !ids.includes(p.id));
  }

  private arm(ms: number) {
    this.stop();
    this.timer = setTimeout(() => {
      const st = this.table.snap?.state as LRState | undefined;
      if (st?.phase === 'write') this.judge();
      else if (st?.phase === 'judge') this.result(st);
      else if (st?.phase === 'result') this.next();
    }, ms);
  }

  private judge() {
    const s = this.table.snap!;
    const st = s.state as LRState;
    const answers = Object.fromEntries(s.players.map((p) => [p.id, this.answers[p.id] ?? clean([])]));
    this.table.update({ state: { ...st, phase: 'judge', answers, downs: {}, okd: [], done: Object.keys(this.answers), rid: st.rid + 1 } });
    this.arm(JUDGE_MS);
  }

  private result(st: LRState) {
    const s = this.table.snap!;
    const got = score(st, st.answers ?? {}, st.downs ?? {}, s.players.map((p) => p.id));
    const points = { ...st.points };
    for (const [id, g] of Object.entries(got)) points[id] = (points[id] ?? 0) + g.reduce((a, b) => a + b, 0);
    this.table.update({ state: { ...st, phase: 'result', got, points, rid: st.rid + 1 } });
    this.arm(RESULT_MS);
  }

  private next() {
    const s = this.table.snap!;
    const st = s.state as LRState;
    this.answers = {};
    if (st.round >= LR_ROUNDS) {
      this.stop();
      this.table.update({ state: { ...st, phase: 'done', seed: this.seed, rid: st.rid + 1 } });
      this.record(s.players.map((p) => p.id), topScorers(st.points), { points: st.points }, this.seed);
      return;
    }
    const round = st.round + 1;
    const r = this.rounds[round - 1];
    this.table.update({
      state: { ...st, phase: 'write', round, letter: r.letter, cats: r.cats, done: [], answers: undefined, downs: undefined, okd: undefined, got: undefined, rid: st.rid + 1 },
    });
    this.arm(WRITE_MS + GRACE_MS);
  }
}

export class LetterRushView implements TableView {
  readonly root = el('div', 'v2-qd v2-lr');
  private note = el('p', 'v2-note');
  private head = el('div', 'v2-lr-head');
  private body = el('div', 'v2-lr-body');
  private status = el('p', 'v2-note');
  private list = el('div', 'v2-list');
  private rid = 0;
  private key = '';
  private sent = false;
  private inputs: HTMLInputElement[] = [];
  private autoSend: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private me: string,
    private act: (a: LRAct) => void,
    private names: Names,
  ) {
    this.note.id = 'lr-note';
    this.head.id = 'lr-head';
    this.body.id = 'lr-body';
    this.status.id = 'lr-status';
    this.status.setAttribute('aria-live', 'polite');
    this.list.id = 'lr-list';
    this.root.append(this.note, this.head, this.body, this.status, this.list);
  }

  show(s: Snapshot) {
    const st = s.state as LRState;
    const fresh = st.rid !== this.rid;
    this.rid = st.rid;
    const playing = s.players.some((p) => p.id === this.me);
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);
    // One screen per phase of each round; within it only small parts change (never the inputs under a finger).
    const key = `${s.host}:${st.round}:${st.phase}`;
    const redraw = key !== this.key;
    if (redraw && st.phase !== 'write') this.clearAuto();
    if (redraw) this.key = key;
    this.note.textContent =
      st.phase === 'done' ? 'Game over.' : `Round ${st.round} of ${LR_ROUNDS}${playing ? '' : ' · watching'}. A good answer nobody else had is 2 points, a shared one 1.`;

    if (st.phase === 'done') {
      if (redraw) this.done(s, st, fresh);
    } else {
      if (redraw) {
        const big = el('b', 'v2-lr-letter', st.letter);
        big.id = 'lr-letter';
        this.head.replaceChildren(big, el('span', '', st.phase === 'write' ? 'Everything starts with this letter' : st.phase === 'judge' ? 'Thumbs down anything that doesn’t count' : 'Round scores'));
        if (fresh && st.phase === 'write') play('card_flip', 0.6);
      }
      if (st.phase === 'write') this.write(st, redraw, playing);
      else this.answers(s, st, redraw, fresh, playing);
    }

    if (st.phase === 'write') {
      const left = s.players.filter((p) => !st.done.includes(p.id));
      this.status.textContent = playing && !this.sent ? 'Your answers stay secret until everyone is done.' : left.length ? `Waiting for ${left.map((p) => name(p.id)).join(', ')}…` : 'Revealing…';
    } else if (st.phase === 'judge') {
      const left = s.players.filter((p) => !(st.okd ?? []).includes(p.id));
      this.status.textContent = left.length ? `Still checking: ${left.map((p) => name(p.id)).join(', ')}` : 'Scoring…';
    } else if (st.phase === 'result') {
      const mine = st.got?.[this.me]?.reduce((a, b) => a + b, 0);
      this.status.textContent = mine !== undefined ? `You got ${mine} this round.` : '';
    } else this.status.textContent = '';
    this.list.replaceChildren(
      ...pointsRows(s.players, st.points, this.me, this.names, { chip: (id) => (st.phase === 'write' && st.done.includes(id) ? 'done' : st.phase === 'judge' && st.okd?.includes(id) ? 'happy' : '') }),
    );
  }

  private write(st: LRState, redraw: boolean, playing: boolean) {
    if (!redraw) return;
    this.sent = !playing || st.done.includes(this.me);
    this.inputs = [];
    const form = el('form', 'v2-lr-form');
    form.id = 'lr-form';
    form.noValidate = true;
    st.cats.forEach((c, i) => {
      const lab = el('label', 'v2-lr-row');
      const input = el('input', 'dh-input');
      input.id = `lr-in-${i}`;
      input.maxLength = MAX_LEN;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = `${st.letter}…`;
      input.disabled = this.sent;
      input.enterKeyHint = i < LR_CATS - 1 ? 'next' : 'done';
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < LR_CATS - 1) this.inputs[i + 1].focus();
        else this.send(st);
      });
      this.inputs.push(input);
      lab.append(el('span', 'c', c), input);
      form.append(lab);
    });
    const go = el('button', 'dh-btn');
    go.type = 'submit';
    go.id = 'lr-done';
    go.disabled = this.sent;
    go.append(icon('check'), document.createTextNode(this.sent ? (playing ? 'Handed in' : 'Watching') : 'Done'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send(st);
    });
    form.append(go);
    this.body.replaceChildren(form, timerBar(WRITE_MS, 'lr-timer'));
    // Time's up: whatever is written goes in.
    this.clearAuto();
    if (!this.sent) this.autoSend = setTimeout(() => this.send(st), WRITE_MS - 400);
  }

  private send(st: LRState) {
    if (this.sent) return;
    this.sent = true;
    this.clearAuto();
    const a = this.inputs.map((i) => i.value);
    for (const i of this.inputs) i.disabled = true;
    const go = this.body.querySelector<HTMLButtonElement>('#lr-done');
    if (go) {
      go.disabled = true;
      go.lastChild!.textContent = 'Handed in';
    }
    play('click', 0.5);
    buzz(10);
    this.act({ t: 'ans', rid: st.rid, a });
  }

  private clearAuto() {
    if (this.autoSend) clearTimeout(this.autoSend);
    this.autoSend = null;
  }

  // Judging and results: a card per category with everyone's answer.
  private answers(s: Snapshot, st: LRState, redraw: boolean, fresh: boolean, playing: boolean) {
    const judging = st.phase === 'judge';
    const answers = st.answers ?? {};
    const others = Math.max(1, s.players.length - 1);
    const needed = Math.max(1, Math.ceil(others / 2));
    if (redraw) {
      const grid = el('div', 'v2-lr-grid');
      st.cats.forEach((c, i) => {
        const card = el('div', 'v2-lr-cat');
        card.append(el('b', '', c));
        for (const p of s.players) {
          const key = `${p.id}:${i}`;
          const text = answers[p.id]?.[i] ?? '';
          const row = el('div', 'v2-lr-ans');
          row.dataset.key = key;
          const who = el('span', 'who', nameOf(p.id, this.me, this.names, s.players));
          const t = el('span', 't', text || '—');
          row.append(who, t);
          if (judging && playing && p.id !== this.me && text) {
            const b = el('button', 'dh-iconbtn v2-lr-down');
            b.type = 'button';
            b.dataset.down = key;
            b.setAttribute('aria-label', `Doesn't count: ${text}`);
            b.append(icon('x'));
            b.addEventListener('click', () => {
              const on = b.getAttribute('aria-pressed') !== 'true';
              b.setAttribute('aria-pressed', String(on));
              play('click', 0.4);
              this.act({ t: 'down', rid: st.rid, key, on });
            });
            row.append(b);
          } else row.append(el('span', 'pts'));
          card.append(row);
        }
        grid.append(card);
      });
      const parts: HTMLElement[] = [grid];
      if (judging && playing) {
        const ok = el('button', 'dh-btn');
        ok.type = 'button';
        ok.id = 'lr-ok';
        ok.append(icon('check'), document.createTextNode('Looks good'));
        ok.addEventListener('click', () => {
          ok.disabled = true;
          play('click', 0.5);
          this.act({ t: 'ok', rid: st.rid });
        });
        parts.push(ok);
      }
      if (judging) parts.push(timerBar(JUDGE_MS, 'lr-judge-timer'));
      this.body.replaceChildren(...parts);
    }
    // Live: thumbs-down counts, ruled-out answers, and the points once scored.
    for (const row of this.body.querySelectorAll<HTMLElement>('.v2-lr-ans')) {
      const key = row.dataset.key!;
      const [id, i] = key.split(':');
      const text = answers[id]?.[Number(i)] ?? '';
      const votes = (st.downs?.[key] ?? []).filter((v) => v !== id).length;
      const out = !fits(text, st.letter) || votes >= needed;
      row.classList.toggle('out', out);
      const b = row.querySelector<HTMLButtonElement>('.v2-lr-down');
      if (b) {
        b.setAttribute('aria-pressed', String((st.downs?.[key] ?? []).includes(this.me)));
        b.dataset.votes = String(votes);
        b.disabled = (st.okd ?? []).includes(this.me);
      }
      const pts = row.querySelector('.pts');
      if (pts && st.phase === 'result') {
        const g = st.got?.[id]?.[Number(i)] ?? 0;
        pts.textContent = g ? `+${g}` : '0';
        pts.className = 'pts' + (g === 2 ? ' two' : g === 1 ? ' one' : '');
      }
    }
    if (judging) {
      const ok = this.body.querySelector<HTMLButtonElement>('#lr-ok');
      if (ok && (st.okd ?? []).includes(this.me)) ok.disabled = true;
    }
    if (st.phase === 'result' && fresh && playing) {
      const mine = st.got?.[this.me]?.reduce((a, b) => a + b, 0) ?? 0;
      if (mine) {
        play('coin', 0.6);
        setTimeout(() => floatText(this.head, `+${mine}`, 'good'), 200);
      } else kick(this.head, 'v2-shake');
    }
  }

  private async done(s: Snapshot, st: LRState, fresh: boolean) {
    const winners = topScorers(st.points);
    const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), winTitle(winners, this.me, this.names, s.players));
    res.id = 'lr-result';
    const fair = el('p', 'v2-note', 'Checking the letters were fair…');
    fair.id = 'lr-fair';
    this.head.replaceChildren(el('b', 'v2-lr-letter', '★'), el('span', '', 'Final scores'));
    this.body.replaceChildren(res, fair);
    if (fresh && s.players.some((p) => p.id === this.me)) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
    if (fresh && winners.includes(this.me)) requestAnimationFrame(() => burst(res, 24));
    const ok = !!st.seed && (await checkSeed(st.seed, st.commit)) && pickRounds(st.seed)[st.round - 1]?.letter === st.letter;
    fair.textContent = ok ? 'Fair: the letters and categories match the host’s sealed list.' : 'Couldn’t check the letters.';
    fair.dataset.fair = String(ok);
  }

  destroy() {
    this.clearAuto();
  }
}

