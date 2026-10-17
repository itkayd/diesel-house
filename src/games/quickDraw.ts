import { el } from '../ui/modal';
import { portrait } from '../ui/portrait';
import { play } from '../ui/sounds';
import { burst, buzz, kick } from './juice';
import { checkSeed, randomSeed, rng, sha256 } from './fair';
import type { Recorder, Seat, Snapshot, Table, TableHost, TableView } from './table';

// Quick Draw (UPDATE.md Phase 12): 2-8 players at a table. "The lamp will flicker… wait for it", then
// DRAW! after a random 2-6 s, and the first to tap wins the round. Early tap = out for that round. 5 rounds,
// 3/2/1 points for the fastest three. Each player times themselves from the moment DRAW! shows on their
// own screen (so a slower connection doesn't cost anyone), and the host collects the times.
// The random waits come from the host's seed, committed at the start and revealed at the end.
// Messages for a whole game: 1 start + per round 1 snapshot and 1 tap per player (8 players: ~50).

export const ROUNDS = 5;
const PAUSE = 2500; // ms showing the last round's times before the next "wait for it"
const ANSWER_MS = 3000; // after DRAW!, how long the host waits for taps
const POINTS = [3, 2, 1];

export type QDState = {
  phase: 'round' | 'done';
  commit: string;
  seed?: string; // revealed when done
  round: number; // 1..ROUNDS
  rid: number; // changes each time a round (re)starts
  pause: number; // ms of results before "wait for it"
  delay: number; // ms from "wait for it" to DRAW!
  delays: number[]; // every round's delay so far (checked against the seed at the end)
  last?: { round: number; times: Record<string, number> };
  points: Record<string, number>;
  takeoverAt?: number; // a new host took over from this round (with a new seed)
};
type Act = { t: 'tap'; rid: number; ms: number } | { t: 'early'; rid: number };

const delayFor = (seed: string, round: number) => 2000 + Math.floor(rng(`${seed}:${round}`)() * 4000);

// Host side: runs the game on the table.
export class QuickDrawHost implements TableHost {
  private seed = '';
  private times: Record<string, number> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private table: Table,
    private record: Recorder,
  ) {}

  async start(players: Seat[]) {
    this.seed = randomSeed();
    const commit = await sha256(this.seed);
    const delay = delayFor(this.seed, 1);
    const state: QDState = { phase: 'round', commit, round: 1, rid: 1, pause: 0, delay, delays: [delay], points: Object.fromEntries(players.map((p) => [p.id, 0])) };
    this.table.start('quickdraw', players, state);
    this.armRound(state);
  }

  // The previous host left mid-game: replay the current round with a fresh seed (we never knew theirs).
  async takeover(s: Snapshot) {
    const st = s.state as QDState;
    if (s.game !== 'quickdraw' || st.phase !== 'round') return;
    this.seed = randomSeed();
    const commit = await sha256(this.seed);
    const delay = delayFor(this.seed, st.round);
    const players = s.players.filter((p) => this.table.people.some((q) => q.id === p.id));
    const delays = [...st.delays.slice(0, st.round - 1), delay];
    // Earlier delays came from the old seed, so only this seed's rounds are checked from here.
    const next: QDState = { ...st, commit, rid: st.rid + 1, pause: 1500, delay, delays, seed: undefined, takeoverAt: st.round };
    this.table.update({ players, state: next });
    this.armRound(next);
  }

  onAction(from: string, act: unknown) {
    const a = act as Act;
    const s = this.table.snap;
    const st = s?.state as QDState | undefined;
    if (!s || !st || st.phase !== 'round' || a.rid !== st.rid || !s.players.some((p) => p.id === from) || from in this.times) return;
    this.times[from] = a.t === 'early' ? -1 : Math.max(0, Math.min(ANSWER_MS, Math.round(a.ms)));
    if (this.waitingFor().length === 0) this.finishRound();
  }

  // Someone left the table: maybe everyone still here has answered.
  onPeople() {
    const st = this.table.snap?.state as QDState | undefined;
    if (st?.phase === 'round' && this.timer && this.waitingFor().length === 0) this.finishRound();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private waitingFor() {
    const s = this.table.snap!;
    const here = new Set(this.table.people.map((p) => p.id));
    here.add(this.table.id);
    return s.players.filter((p) => here.has(p.id) && !(p.id in this.times));
  }

  private armRound(st: QDState) {
    this.stop();
    this.times = {};
    this.timer = setTimeout(() => this.finishRound(), st.pause + st.delay + ANSWER_MS + 500);
  }

  private finishRound() {
    this.stop();
    const s = this.table.snap!;
    const st = s.state as QDState;
    const points = { ...st.points };
    const fastest = Object.entries(this.times)
      .filter(([, ms]) => ms >= 0)
      .sort((a, b) => a[1] - b[1]);
    fastest.slice(0, POINTS.length).forEach(([id], i) => (points[id] = (points[id] ?? 0) + POINTS[i]));
    const last = { round: st.round, times: this.times };
    if (st.round >= ROUNDS) {
      const next: QDState = { ...st, phase: 'done', seed: this.seed, last, points };
      this.table.update({ state: next });
      const top = Math.max(...Object.values(points));
      const winners = top > 0 ? Object.keys(points).filter((id) => points[id] === top) : [];
      const best: Record<string, number> = {};
      for (const [id, ms] of Object.entries(this.times)) if (ms >= 0) best[id] = ms;
      this.record(s.players.map((p) => p.id), winners, { points, best, delays: st.delays }, this.seed);
      return;
    }
    const round = st.round + 1;
    const delay = delayFor(this.seed, round);
    const next: QDState = { ...st, round, rid: st.rid + 1, pause: PAUSE, delay, delays: [...st.delays, delay], last, points };
    this.table.update({ state: next });
    this.armRound(next);
  }
}

// Everyone's screen: the draw box, this round's times and the points table.
export class QuickDrawView implements TableView {
  readonly root = el('div', 'v2-qd');
  private box = el('div', 'v2-draw');
  private list = el('div', 'v2-list');
  private note = el('p', 'v2-note');
  private rid = 0;
  private phase: 'idle' | 'results' | 'ready' | 'go' | 'done' = 'idle';
  private goAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private playing = false;

  constructor(
    private me: string,
    private act: (a: Act) => void,
    private names: (id: string) => { name: string; character: number },
  ) {
    this.box.id = 'qd-box';
    this.box.tabIndex = 0;
    this.box.setAttribute('role', 'button');
    this.list.id = 'qd-list';
    this.note.id = 'qd-note';
    this.root.append(this.note, this.box, this.list);
    this.box.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.tap();
    });
    this.box.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        this.tap();
      }
    });
  }

  show(s: Snapshot) {
    const st = s.state as QDState;
    this.playing = s.players.some((p) => p.id === this.me);
    if (st.phase === 'done') {
      this.clear();
      this.phase = 'done';
      void this.showDone(s, st);
      return;
    }
    this.note.textContent = `Round ${st.round} of ${ROUNDS}${this.playing ? '' : ' · watching'}. Tap the box (or press Space) the moment it says DRAW!`;
    this.renderPoints(s, st, st.last);
    if (st.rid === this.rid) return;
    this.rid = st.rid;
    this.clear();
    if (st.last && st.pause) {
      this.phase = 'results';
      this.setBox('', 'Round ' + st.last.round + ' done', this.lastLine(st.last.times));
    }
    this.later(() => {
      this.phase = 'ready';
      this.setBox('ready', 'Wait for it…', 'The lamp will flicker…');
      play('click', 0.5);
    }, st.pause);
    this.later(() => {
      this.phase = 'go';
      this.goAt = performance.now();
      this.setBox('go', 'DRAW!', '');
      play('powerup', 0.8);
    }, st.pause + st.delay);
    this.box.focus({ preventScroll: true });
  }

  private tap() {
    if (!this.playing) return;
    if (this.phase === 'ready' || this.phase === 'results') {
      this.phase = 'idle';
      this.clear();
      this.setBox('foul', 'Too soon!', 'Out for this round.');
      kick(this.box, 'v2-shake');
      buzz([50, 40, 50]);
      play('error', 0.6);
      this.act({ t: 'early', rid: this.rid });
    } else if (this.phase === 'go') {
      this.phase = 'idle';
      const ms = Math.round(performance.now() - this.goAt);
      const rating = ms < 250 ? 'Lightning!' : ms < 350 ? 'Quick hands' : ms < 500 ? 'Not bad' : 'Steady…';
      this.setBox('', `${ms} ms`, `${rating} Waiting for the others…`);
      kick(this.box.querySelector('b')!, 'v2-pop');
      buzz(10);
      this.act({ t: 'tap', rid: this.rid, ms });
    }
  }

  private lastLine(times: Record<string, number>) {
    const mine = times[this.me];
    return mine === undefined ? '' : mine < 0 ? 'You tapped too soon.' : `Your time: ${mine} ms`;
  }

  private renderPoints(s: Snapshot, st: QDState, last?: QDState['last']) {
    const rows = s.players
      .map((p) => ({ p, pts: st.points[p.id] ?? 0, ms: last?.times[p.id] }))
      .sort((a, b) => b.pts - a.pts || (a.ms ?? 1e9) - (b.ms ?? 1e9));
    this.list.replaceChildren(
      ...rows.map((r, i) => {
        const row = el('div', 'v2-board-row' + (r.p.id === this.me ? ' me' : ''));
        row.dataset.player = r.p.id;
        const rk = el('span', 'rk' + (i === 0 && r.pts > 0 ? ' top' : ''), String(i + 1));
        const who = this.names(r.p.id);
        const ms = r.ms === undefined ? '' : r.ms < 0 ? 'too soon' : `${r.ms} ms`;
        const chip = el('span', 'v2-xpchip', `${r.pts} pt${r.pts === 1 ? '' : 's'}${ms ? ' · ' + ms : ''}`);
        row.append(rk, portrait(who.character, 32), el('b', '', r.p.id === this.me ? 'You' : who.name || r.p.name), chip);
        return row;
      }),
    );
  }

  private async showDone(s: Snapshot, st: QDState) {
    this.renderPoints(s, st, st.last);
    const top = Math.max(...Object.values(st.points));
    const winners = top > 0 ? s.players.filter((p) => st.points[p.id] === top) : [];
    const iWon = winners.some((p) => p.id === this.me);
    const title = !winners.length ? 'Nobody scored' : iWon ? (winners.length > 1 ? 'Shared win!' : 'You win!') : `${winners.map((p) => this.names(p.id).name || p.name).join(' & ')} wins`;
    this.setBox(iWon ? 'win' : '', title, 'Game over · checking it was fair…');
    if (this.playing) play(iWon ? 'win' : 'lose', 0.7);
    if (iWon) {
      requestAnimationFrame(() => burst(this.box, 26));
      buzz([20, 40, 20]);
    }
    // Fair check: the revealed seed matches the hash shown at the start, and gives the same waits.
    const takeoverAt = st.takeoverAt ?? 1;
    const ok = !!st.seed && (await checkSeed(st.seed, st.commit)) && st.delays.every((d, i) => i + 1 < takeoverAt || d === delayFor(st.seed!, i + 1));
    const sub = this.box.querySelector('.v2-note');
    if (sub) sub.textContent = ok ? 'Fair: the waits match the host’s sealed seed.' : 'Couldn’t check the waits.';
    this.box.dataset.fair = String(ok);
    this.note.textContent = 'Game over.';
  }

  private setBox(cls: string, big: string, small: string) {
    this.box.className = 'v2-draw' + (cls ? ' ' + cls : '');
    const inner = el('div');
    const b = el('b', '', big);
    inner.append(b);
    if (small || cls === 'win' || this.phase === 'done') {
      const n = el('div', 'v2-note', small);
      n.style.marginTop = '6px';
      inner.append(n);
    }
    this.box.replaceChildren(inner);
    this.box.dataset.phase = this.phase;
  }

  private later(f: () => void, ms: number) {
    this.timers.push(setTimeout(f, ms));
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  destroy() {
    this.clear();
  }
}
