import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { burst, buzz, floatText, kick, timerBar } from './juice';
import { checkSeed, randomSeed, rng, sha256, shuffleWith } from './fair';
import { nameOf, pointsRows, topScorers, winTitle } from './kit';
import WORDS from './words.json';
import type { Names, Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Sketch & guess: 2-8 players take turns to draw a secret word while everyone else types guesses. The
// first right guess gets 3, the second 2, the rest 1, and the artist gets 1 for every right guess. Wrong
// guesses show for everyone (half the fun); a near miss says "So close!" only to whoever typed it.
// Halfway through, the first letter shows. Each player draws once (twice with 2 or 3 players).
// The words come from the host's seed (sealed at the start, shown at the end).
//
// The drawing: the artist's lines go to the host in small pieces (one message every 300 ms while
// drawing) and the host passes them on at most 4 times a second, on a 256 × 192 grid. The word rides
// along in the snapshot lightly scrambled so it isn't on screen; anyone determined can read it in the
// browser's dev tools, which is fine for friends.

export const DRAW_MS = 75_000;
const REVEAL_MS = 5_000;
const SEND_MS = 300; // the artist's line pieces
const PUSH_MS = 250; // the host passing them on
const MAX_POINTS = 8_000; // per drawing
const GUESS_GAP_MS = 600; // per player
export const W = 256;
export const H = 192;
export const COLOURS = ['#2b2034', '#e04e4e', '#3d7be0', '#3fa865', '#f4b860', '#fff4e0'];
export const WIDTHS = [2, 5, 12];
const WORD_BANK = WORDS.sketch as string[];

export type Stroke = { c: number; w: number; p: number[] }; // p: x0, y0, x1, y1… on the 256 × 192 grid
export type FeedItem = { id: string; t?: string; ok?: boolean; close?: boolean };
export type SketchState = {
  phase: 'draw' | 'reveal' | 'done';
  rid: number;
  round: number;
  rounds: number;
  artist: string;
  mask: string; // "_ _ _ _" (and the first letter, halfway)
  w: string; // the word, scrambled (see hide / unhide)
  strokes: Stroke[];
  clears: number; // goes up when the artist wipes the board
  got: string[]; // who has guessed it, in order
  feed: FeedItem[]; // the last few guesses
  gained?: Record<string, number>; // this drawing's points
  word?: string; // shown at the reveal
  points: Record<string, number>;
  commit: string;
  seed?: string;
};
export type SketchAct = { t: 'ink'; rid: number; s: Stroke[] } | { t: 'clear'; rid: number } | { t: 'guess'; rid: number; text: string };

// Just enough to keep the word off the screen (and out of a casual glance at the network log).
export const hide = (word: string) => btoa(encodeURIComponent(word.split('').reverse().join('')));
export const unhide = (w: string) => {
  try {
    return decodeURIComponent(atob(w)).split('').reverse().join('');
  } catch {
    return '';
  }
};

// For comparing guesses: lower case, letters and digits only.
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

// One letter off (added, missing or different): "So close!".
export function close(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// "_ _ _   _ _ _ _" for "ice cream", with the first letter shown when `first`.
export const maskOf = (word: string, first = false) =>
  word
    .split('')
    .map((ch, i) => (ch === ' ' ? ' ' : first && i === 0 ? ch.toUpperCase() : '_'))
    .join(' ');

export const roundsFor = (n: number) => (n <= 3 ? n * 2 : Math.min(n, 8));

export function pickWords(seed: string, n: number) {
  return shuffleWith(rng(`${seed}:sketch`), WORD_BANK).slice(0, n);
}

// Points for the n-th right guess (0-based): 3, 2, then 1.
export const guessPoints = (n: number) => (n === 0 ? 3 : n === 1 ? 2 : 1);

const cleanStroke = (x: unknown): Stroke | null => {
  const s = x as Stroke;
  if (!s || !Number.isInteger(s.c) || s.c < 0 || s.c >= COLOURS.length || !Number.isInteger(s.w) || s.w < 0 || s.w >= WIDTHS.length || !Array.isArray(s.p)) return null;
  if (s.p.length < 2 || s.p.length % 2 || s.p.length > 400) return null;
  const p = s.p.map((v, i) => Math.max(0, Math.min(i % 2 ? H - 1 : W - 1, Math.round(Number(v) || 0))));
  return { c: s.c, w: s.w, p };
};

export class SketchHost implements TableHost {
  private seed = '';
  private words: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hint: ReturnType<typeof setTimeout> | null = null;
  private push: ReturnType<typeof setTimeout> | null = null;
  private pending: Stroke[] = [];
  private cleared = false;
  private lastGuess = new Map<string, number>();

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    const rounds = roundsFor(players.length);
    this.words = pickWords(this.seed, rounds);
    const st: SketchState = {
      phase: 'draw', rid: 1, round: 1, rounds, artist: players[0].id, mask: maskOf(this.words[0]), w: hide(this.words[0]), strokes: [], clears: 0, got: [], feed: [],
      points: Object.fromEntries(players.map((p) => [p.id, 0])), commit: await sha256(this.seed),
    };
    this.table.start('sketch', players, st);
    this.armDraw();
  }

  // Everything is in the snapshot: carry on (later words come from a new seed).
  async takeover(s: Snapshot) {
    const st = s.state as SketchState;
    if (s.game !== 'sketch' || st.phase === 'done') return;
    this.seed = randomSeed();
    this.words = pickWords(this.seed, st.rounds);
    this.words[st.round - 1] = unhide(st.w);
    const players = s.players.filter((p) => p.id === this.table.id || this.table.people.some((q) => q.id === p.id));
    const commit = await sha256(this.seed);
    this.table.update({ players, state: { ...st, commit, rid: st.rid + 1 } });
    if (st.phase === 'reveal' || !players.some((p) => p.id === st.artist)) this.arm(REVEAL_MS / 2, () => this.next());
    else this.armDraw(DRAW_MS / 2);
  }

  onAction(from: string, act: unknown) {
    const a = act as SketchAct;
    const s = this.table.snap;
    const st = s?.state as SketchState | undefined;
    if (!s || !st || s.game !== 'sketch' || st.phase !== 'draw' || a?.rid !== st.rid || !s.players.some((p) => p.id === from)) return;
    if (a.t === 'ink' && from === st.artist && Array.isArray(a.s)) {
      let room = MAX_POINTS - (this.cleared ? 0 : st.strokes.reduce((n, x) => n + x.p.length / 2, 0)) - this.pending.reduce((n, x) => n + x.p.length / 2, 0);
      for (const x of a.s.slice(0, 40)) {
        const k = cleanStroke(x);
        if (!k || room < k.p.length / 2) continue;
        room -= k.p.length / 2;
        this.pending.push(k);
      }
      this.flushSoon();
    } else if (a.t === 'clear' && from === st.artist) {
      this.pending = [];
      this.cleared = true;
      this.flushSoon();
    } else if (a.t === 'guess' && from !== st.artist && !st.got.includes(from) && typeof a.text === 'string') {
      const now = Date.now();
      if (now - (this.lastGuess.get(from) ?? 0) < GUESS_GAP_MS) return;
      this.lastGuess.set(from, now);
      const text = a.text.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!text) return;
      const word = this.words[st.round - 1];
      const st2 = this.withInk(st);
      if (norm(text) === norm(word)) {
        const got = [...st2.got, from];
        const feed = [...st2.feed, { id: from, ok: true }].slice(-8);
        const guessers = s.players.filter((p) => p.id !== st.artist && this.here(p.id));
        if (guessers.every((p) => got.includes(p.id))) this.reveal({ ...st2, got, feed });
        else this.table.update({ state: { ...st2, got, feed } });
      } else {
        const feed = [...st2.feed, { id: from, t: text, close: close(norm(text), norm(word)) || undefined }].slice(-8);
        this.table.update({ state: { ...st2, feed } });
      }
    }
  }

  onPeople() {
    const s = this.table.snap;
    const st = s?.state as SketchState | undefined;
    if (!s || !st || s.game !== 'sketch' || st.phase !== 'draw') return;
    // The artist left: on to the next drawing. Everyone left has guessed: reveal.
    if (!this.here(st.artist)) return this.reveal(this.withInk(st));
    const guessers = s.players.filter((p) => p.id !== st.artist && this.here(p.id));
    if (guessers.length && guessers.every((p) => st.got.includes(p.id))) this.reveal(this.withInk(st));
  }

  stop() {
    for (const t of [this.timer, this.hint, this.push]) if (t) clearTimeout(t);
    this.timer = this.hint = this.push = null;
  }

  private here(id: string) {
    return id === this.table.id || this.table.people.some((p) => p.id === id);
  }

  // The state with the waiting line pieces (and any clear) folded in.
  private withInk(st: SketchState): SketchState {
    const strokes = this.cleared ? [...this.pending] : [...st.strokes, ...this.pending];
    const clears = st.clears + (this.cleared ? 1 : 0);
    this.pending = [];
    this.cleared = false;
    if (this.push) clearTimeout(this.push);
    this.push = null;
    return { ...st, strokes, clears };
  }

  private flushSoon() {
    if (this.push) return;
    this.push = setTimeout(() => {
      this.push = null;
      const st = this.table.snap?.state as SketchState | undefined;
      if (st?.phase === 'draw') this.table.update({ state: this.withInk(st) });
    }, PUSH_MS);
  }

  private arm(ms: number, then: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(then, ms);
  }

  private armDraw(ms = DRAW_MS) {
    this.arm(ms, () => {
      const st = this.table.snap?.state as SketchState | undefined;
      if (st?.phase === 'draw') this.reveal(this.withInk(st));
    });
    if (this.hint) clearTimeout(this.hint);
    this.hint = setTimeout(() => {
      const st = this.table.snap?.state as SketchState | undefined;
      if (st?.phase === 'draw') this.table.update({ state: { ...this.withInk(st), mask: maskOf(this.words[st.round - 1], true) } });
    }, ms / 2);
  }

  private reveal(st: SketchState) {
    if (this.hint) clearTimeout(this.hint);
    const gained: Record<string, number> = {};
    st.got.forEach((id, n) => (gained[id] = guessPoints(n)));
    if (st.got.length) gained[st.artist] = st.got.length;
    const points = { ...st.points };
    for (const [id, g] of Object.entries(gained)) points[id] = (points[id] ?? 0) + g;
    this.table.update({ state: { ...st, phase: 'reveal', word: this.words[st.round - 1], gained, points, rid: st.rid + 1 } });
    this.arm(REVEAL_MS, () => this.next());
  }

  private next() {
    const s = this.table.snap!;
    const st = s.state as SketchState;
    this.pending = [];
    this.cleared = false;
    this.lastGuess.clear();
    // Next artist: the next player (still here) after this one.
    const ids = s.players.map((p) => p.id);
    let artist: string | null = null;
    for (let k = 1; k <= ids.length; k++) {
      const id = ids[(ids.indexOf(st.artist) + k) % ids.length];
      if (this.here(id)) {
        artist = id;
        break;
      }
    }
    const left = s.players.filter((p) => this.here(p.id)).length;
    if (st.round >= st.rounds || !artist || left < 2) {
      this.stop();
      this.table.update({ state: { ...st, phase: 'done', seed: this.seed, rid: st.rid + 1 } });
      this.record(ids, topScorers(st.points), { points: st.points }, this.seed);
      return;
    }
    const round = st.round + 1;
    const word = this.words[round - 1];
    this.table.update({
      state: { ...st, phase: 'draw', round, artist, mask: maskOf(word), w: hide(word), strokes: [], clears: 0, got: [], feed: [], gained: undefined, word: undefined, rid: st.rid + 1 },
    });
    this.armDraw();
  }
}

// Draw strokes onto a canvas (the 256 × 192 grid, scaled to the canvas).
function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], from = 0) {
  const k = ctx.canvas.width / W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = from; i < strokes.length; i++) {
    const s = strokes[i];
    ctx.strokeStyle = COLOURS[s.c];
    ctx.fillStyle = COLOURS[s.c];
    ctx.lineWidth = WIDTHS[s.w] * k;
    if (s.p.length === 2) {
      ctx.beginPath();
      ctx.arc(s.p[0] * k, s.p[1] * k, (WIDTHS[s.w] * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s.p[0] * k, s.p[1] * k);
    for (let j = 2; j < s.p.length; j += 2) ctx.lineTo(s.p[j] * k, s.p[j + 1] * k);
    ctx.stroke();
  }
}

export class SketchView implements TableView {
  readonly root = el('div', 'v2-qd v2-sk');
  private note = el('p', 'v2-note');
  private word = el('div', 'v2-prompt v2-sk-word');
  private canvas = el('canvas', 'v2-sk-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tools = el('div', 'v2-sk-tools');
  private guessForm = el('form', 'v2-sk-guess');
  private input = el('input', 'dh-input');
  private feed = el('div', 'v2-sk-feed');
  private timerBox = el('div');
  private list = el('div', 'v2-list');
  private rid = 0;
  private key = '';
  private drawn = 0; // strokes on the canvas from the state
  private clears = 0;
  private colour = 0;
  private width = 1;
  // The artist's line being drawn, and pieces not yet sent.
  private line: Stroke | null = null;
  private outbox: Stroke[] = [];
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private st: SketchState | null = null;
  private feedSeen = 0;

  constructor(
    private me: string,
    private act: (a: SketchAct) => void,
    private names: Names,
  ) {
    this.note.id = 'sk-note';
    this.word.id = 'sk-word';
    this.canvas.id = 'sk-canvas';
    this.canvas.width = W * 2;
    this.canvas.height = H * 2;
    this.tools.id = 'sk-tools';
    this.feed.id = 'sk-feed';
    this.feed.setAttribute('aria-live', 'polite');
    this.list.id = 'sk-list';
    this.input.id = 'sk-input';
    this.input.maxLength = 40;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'send';
    this.input.placeholder = 'Type a guess…';
    const send = el('button', 'dh-iconbtn');
    send.type = 'submit';
    send.id = 'sk-send';
    send.setAttribute('aria-label', 'Guess');
    send.append(icon('send'));
    this.guessForm.append(this.input, send);
    this.guessForm.noValidate = true;
    this.guessForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || !this.st || this.st.phase !== 'draw') return;
      this.input.value = '';
      play('click', 0.4);
      this.act({ t: 'guess', rid: this.st.rid, text });
    });
    this.buildTools();
    this.bindDrawing();
    const board = el('div', 'v2-sk-board');
    board.append(this.canvas);
    this.root.append(this.note, this.word, board, this.tools, this.timerBox, this.guessForm, this.feed, this.list);
  }

  show(s: Snapshot) {
    const st = s.state as SketchState;
    this.st = st;
    const fresh = st.rid !== this.rid;
    this.rid = st.rid;
    const playing = s.players.some((p) => p.id === this.me);
    const artist = st.artist === this.me && st.phase === 'draw';
    const name = (id: string) => nameOf(id, this.me, this.names, s.players);
    const key = `${s.host}:${st.round}:${st.phase}`;
    const redraw = key !== this.key;
    if (redraw) this.key = key;
    this.note.textContent =
      st.phase === 'done' ? 'Game over.' : `Drawing ${st.round} of ${st.rounds}${playing ? '' : ' · watching'} · ${name(st.artist)} ${st.artist === this.me ? 'are' : 'is'} drawing.`;

    // The word: the artist sees it, everyone else the blanks (until the reveal).
    if (st.phase === 'done') this.word.replaceChildren(el('span', 'k', 'Sketch & guess'), el('b', '', 'Final scores'));
    else if (st.phase === 'reveal') this.word.replaceChildren(el('span', 'k', 'It was'), el('b', '', st.word ?? ''));
    else if (artist) this.word.replaceChildren(el('span', 'k', 'Draw this (no letters!)'), el('b', 'secret', unhide(st.w)));
    else this.word.replaceChildren(el('span', 'k', st.got.includes(this.me) ? 'You got it!' : 'Guess the word'), el('b', 'mask', st.mask));

    // The drawing (only what's new, unless it was cleared).
    if (redraw || st.clears !== this.clears || st.strokes.length < this.drawn) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawn = 0;
      this.clears = st.clears;
    }
    paint(this.ctx, st.strokes, this.drawn);
    this.drawn = st.strokes.length;
    if (artist) {
      // My own line still on its way to the host: keep it on screen.
      paint(this.ctx, this.outbox);
      if (this.line) paint(this.ctx, [this.line]);
    }
    this.canvas.classList.toggle('mine', artist);
    this.tools.hidden = !artist;
    this.guessForm.hidden = !playing || artist || st.phase !== 'draw' || st.got.includes(this.me);

    if (redraw) {
      this.stopSending();
      this.line = null;
      this.outbox = [];
      this.feedSeen = 0;
      this.timerBox.replaceChildren(...(st.phase === 'draw' ? [timerBar(DRAW_MS, 'sk-timer')] : []));
      if (artist) this.sendTimer = setInterval(() => this.flush(), SEND_MS);
      if (fresh && st.phase === 'draw') play('card_flip', 0.6);
      if (st.phase === 'draw' && artist) buzz(15);
      if (st.phase === 'draw' && !artist && playing && matchMedia('(pointer: fine)').matches) setTimeout(() => this.input.focus({ preventScroll: true }), 50);
    }

    // Guesses.
    this.feed.replaceChildren(
      ...st.feed.map((f) => {
        const mine = f.id === this.me;
        const line = el('div', 'v2-sk-line' + (f.ok ? ' ok' : f.close ? ' close' : ''));
        const who = el('b', '', name(f.id));
        line.append(who, document.createTextNode(f.ok ? ' guessed it!' : f.close && (mine || artist) ? `: ${f.t} (so close!)` : f.close ? ': …' : `: ${f.t}`));
        return line;
      }),
    );
    if (st.feed.length > this.feedSeen && fresh && st.phase === 'draw') {
      const last = st.feed[st.feed.length - 1];
      if (last?.ok && last.id === this.me) {
        play('coin', 0.6);
        buzz(20);
        floatText(this.word, '+' + (st.got.length === 1 ? 3 : st.got.length === 2 ? 2 : 1), 'good');
      } else if (last?.close && last.id === this.me) kick(this.word, 'v2-shake');
      else if (last?.ok && artist) play('coin', 0.4);
    }
    this.feedSeen = st.feed.length;

    if (st.phase === 'reveal' && fresh && playing) {
      const got = st.gained?.[this.me];
      if (got) setTimeout(() => floatText(this.word, `+${got}`, 'good'), 200);
    }
    if (st.phase === 'done' && redraw) this.done(s, st, fresh);
    else if (st.phase !== 'done') this.root.querySelector('#sk-end')?.remove();

    this.list.replaceChildren(...pointsRows(s.players, st.points, this.me, this.names, { mark: st.phase === 'draw' ? st.artist : undefined, chip: (id) => (id === st.artist && st.phase === 'draw' ? 'drawing' : st.got.includes(id) ? 'got it' : '') }));
  }

  private buildTools() {
    const sw = el('div', 'sw');
    COLOURS.forEach((c, i) => {
      const b = el('button', 'v2-sk-col');
      b.type = 'button';
      b.dataset.colour = String(i);
      b.style.background = c;
      b.setAttribute('aria-label', i === COLOURS.length - 1 ? 'Rubber' : `Colour ${i + 1}`);
      b.setAttribute('aria-pressed', String(i === this.colour));
      b.addEventListener('click', () => {
        this.colour = i;
        sw.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      sw.append(b);
    });
    const ws = el('div', 'sw');
    WIDTHS.forEach((w, i) => {
      const b = el('button', 'v2-sk-w');
      b.type = 'button';
      b.dataset.width = String(i);
      b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i]);
      b.setAttribute('aria-pressed', String(i === this.width));
      const dot = el('i');
      dot.style.width = dot.style.height = `${Math.max(4, w + 2)}px`;
      b.append(dot);
      b.addEventListener('click', () => {
        this.width = i;
        ws.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      ws.append(b);
    });
    const clear = el('button', 'dh-btn dh-btn--quiet');
    clear.type = 'button';
    clear.id = 'sk-clear';
    clear.append(icon('rotate-ccw'), document.createTextNode('Clear'));
    clear.addEventListener('click', () => {
      if (!this.st || this.st.phase !== 'draw') return;
      this.line = null;
      this.outbox = [];
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.act({ t: 'clear', rid: this.st.rid });
    });
    this.tools.append(sw, ws, clear);
  }

  private bindDrawing() {
    const c = this.canvas;
    let pointer: number | null = null;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) / r.width) * (W - 1)), Math.round(((e.clientY - r.top) / r.height) * (H - 1))];
    };
    const mine = () => this.st?.phase === 'draw' && this.st.artist === this.me;
    c.addEventListener('pointerdown', (e) => {
      if (!mine() || pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      c.setPointerCapture(e.pointerId);
      this.line = { c: this.colour, w: this.width, p: at(e) };
      paint(this.ctx, [this.line]);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer || !this.line) return;
      const [x, y] = at(e);
      const p = this.line.p;
      if (Math.abs(p[p.length - 2] - x) + Math.abs(p[p.length - 1] - y) < 2) return;
      // Just the new bit on screen; the whole line goes out in pieces.
      const k = c.width / W;
      this.ctx.strokeStyle = COLOURS[this.line.c];
      this.ctx.lineWidth = WIDTHS[this.line.w] * k;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(p[p.length - 2] * k, p[p.length - 1] * k);
      this.ctx.lineTo(x * k, y * k);
      this.ctx.stroke();
      p.push(x, y);
      if (p.length >= 120) this.cut();
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (this.line) this.outbox.push(this.line);
      this.line = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', up);
    c.addEventListener('touchstart', (e) => mine() && e.preventDefault(), { passive: false });
  }

  // A long line: send what's there and carry on from its last point.
  private cut() {
    if (!this.line) return;
    const p = this.line.p;
    this.outbox.push(this.line);
    this.line = { c: this.line.c, w: this.line.w, p: [p[p.length - 2], p[p.length - 1]] };
  }

  private flush() {
    if (this.line && this.line.p.length > 2) this.cut();
    if (!this.outbox.length || !this.st || this.st.phase !== 'draw') return;
    this.act({ t: 'ink', rid: this.st.rid, s: this.outbox });
    this.outbox = [];
  }

  private stopSending() {
    if (this.sendTimer) clearInterval(this.sendTimer);
    this.sendTimer = null;
  }

  private async done(s: Snapshot, st: SketchState, fresh: boolean) {
    const winners = topScorers(st.points);
    const box = el('div', 'v2-hl-acts');
    box.id = 'sk-end';
    const res = el('div', 'v2-result' + (winners.includes(this.me) ? ' win' : ''), winTitle(winners, this.me, this.names, s.players));
    res.id = 'sk-result';
    const fair = el('p', 'v2-note', 'Checking the words were fair…');
    fair.id = 'sk-fair';
    box.append(res, fair);
    this.root.querySelector('#sk-end')?.remove();
    this.list.before(box);
    if (fresh && s.players.some((p) => p.id === this.me)) play(winners.includes(this.me) ? 'win' : 'lose', 0.7);
    if (fresh && winners.includes(this.me)) requestAnimationFrame(() => burst(res, 24));
    const ok = !!st.seed && (await checkSeed(st.seed, st.commit)) && pickWords(st.seed, st.rounds)[st.round - 1] === unhide(st.w);
    fair.textContent = ok ? 'Fair: the words match the host’s sealed list.' : 'Couldn’t check the words.';
    fair.dataset.fair = String(ok);
  }

  destroy() {
    this.stopSending();
  }
}
