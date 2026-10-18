import { el, openModal } from '../ui/modal';
import { icon } from '../ui/icons';
import { portrait } from '../ui/portrait';
import { play } from '../ui/sounds';
import { randomSeed, sha256 } from './fair';
import { burst, buzz, floatText, kick } from './juice';

// Rock-paper-scissors duel (UPDATE.md Phase 12), from the tap-a-friend menu, anywhere in the house.
// Best of 3. Both pick secretly within 10 s: each first sends a hash of (pick + salt), and only once both
// hashes are in does each send the pick itself, so nobody can wait and see. Ties replay. Messages go over
// the house channel (event 'duel', to one person; 'end' to everyone): about 15 for a whole duel.

export type Hand = 'rock' | 'paper' | 'scissors';
export const HANDS: Record<Hand, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const BEATS: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const PICK_MS = 10_000;
const ANSWER_MS = 20_000; // no word from them for this long: they've gone
const TO_WIN = 2;
const MAX_ROUNDS = 9;

export type DuelMsg =
  | { k: 'invite'; id: string; from: string; to: string }
  | { k: 'accept' | 'decline' | 'quit'; id: string; from: string; to: string; busy?: boolean }
  | { k: 'commit'; id: string; from: string; to: string; round: number; h: string }
  | { k: 'reveal'; id: string; from: string; to: string; round: number; pick: Hand; salt: string }
  // To everyone: crown for the winner, dizzy for the loser.
  | { k: 'end'; id: string; from: string; to?: undefined; winner: string; loser: string; score: [number, number] };

type Who = { id: string; name: string; character: number };
type Deps = {
  send: (m: DuelMsg) => void;
  record: (players: string[], winners: string[], score: unknown) => void;
  onEnd: (winner: string, loser: string) => void; // crown and dizzy over heads
  rematch?: () => void; // challenge them again
};

const isHand = (h: unknown): h is Hand => h === 'rock' || h === 'paper' || h === 'scissors';

export class Duel {
  private round = 1;
  private score: [number, number] = [0, 0]; // [me, them]
  private pick: Hand | null = null;
  private salt = '';
  private mine: string | null = null; // our commit
  private theirs: string | null = null; // their commit
  private theirPick: Hand | null = null;
  private revealed = false;
  private over = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  private heard = Date.now();
  private ui: ReturnType<typeof openModal> | null = null;
  private els: Record<string, HTMLElement> = {};
  private early: DuelMsg[] = []; // their next round's messages, arrived while we were still showing this one

  constructor(
    readonly id: string,
    private me: Who,
    readonly them: Who,
    private host: boolean, // the one who invited: records the result and tells everyone
    private deps: Deps,
    private onClose: () => void,
  ) {}

  open() {
    this.render();
    this.startRound();
  }

  onMessage(m: DuelMsg) {
    if (m.id !== this.id || m.from !== this.them.id || this.over) return;
    this.heard = Date.now();
    if (m.k === 'quit') return this.finish('quit');
    if ((m.k === 'commit' || m.k === 'reveal') && m.round > this.round) {
      this.early.push(m);
      return;
    }
    if (m.k === 'commit' && m.round === this.round && !this.theirs) {
      this.theirs = m.h;
      this.setStatus(this.pick ? 'Both locked in…' : `${this.them.name} has picked. Your turn!`);
      void this.maybeReveal();
    } else if (m.k === 'reveal' && m.round === this.round && this.theirs && !this.theirPick && isHand(m.pick)) {
      void sha256(`${m.pick}:${m.salt}`).then((h) => {
        if (h !== this.theirs) return this.finish('cheat');
        this.theirPick = m.pick;
        this.maybeResolve();
      });
    }
  }

  // They left the house.
  gone() {
    if (!this.over) this.finish('quit');
  }

  close() {
    if (!this.over) {
      this.deps.send({ k: 'quit', id: this.id, from: this.me.id, to: this.them.id });
      this.over = true;
    }
    this.stopTimers();
    this.ui?.close();
    this.ui = null;
    this.onClose();
  }

  private startRound() {
    this.pick = null;
    this.mine = null;
    this.theirs = null;
    this.theirPick = null;
    this.revealed = false;
    this.els.round.textContent = `Round ${this.round}`;
    this.els.mineHand.textContent = '❔';
    this.els.mineHand.className = 'v2-hand';
    this.els.theirHand.textContent = '✊';
    this.els.theirHand.className = 'v2-hand hidden';
    this.setButtons(true);
    this.setStatus(`Pick one. First to ${TO_WIN} wins.`);
    const deadline = Date.now() + PICK_MS;
    this.stopTimers();
    this.tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.els.timer.textContent = this.pick ? '' : `${left}s`;
      if (Date.now() - this.heard > ANSWER_MS) this.finish('quit');
    }, 250);
    // Out of time: we pick for you.
    this.timers.push(setTimeout(() => !this.pick && void this.choose((['rock', 'paper', 'scissors'] as Hand[])[Math.floor(Math.random() * 3)], true), PICK_MS));
    const early = this.early;
    this.early = [];
    early.forEach((m) => this.onMessage(m));
  }

  private async choose(h: Hand, auto = false) {
    if (this.pick || this.over) return;
    this.pick = h;
    this.salt = randomSeed();
    this.mine = await sha256(`${h}:${this.salt}`);
    this.setButtons(false);
    this.els.mineHand.textContent = HANDS[h];
    kick(this.els.mineHand, 'v2-pop');
    this.els.timer.textContent = '';
    play('click', 0.6);
    buzz(10);
    this.deps.send({ k: 'commit', id: this.id, from: this.me.id, to: this.them.id, round: this.round, h: this.mine });
    this.setStatus(auto ? 'Time’s up: picked for you. Waiting…' : this.theirs ? 'Both locked in…' : `Locked in. Waiting for ${this.them.name}…`);
    await this.maybeReveal();
  }

  private async maybeReveal() {
    if (!this.pick || !this.mine || !this.theirs || this.revealed) return;
    this.revealed = true;
    this.deps.send({ k: 'reveal', id: this.id, from: this.me.id, to: this.them.id, round: this.round, pick: this.pick, salt: this.salt });
    this.maybeResolve();
  }

  private maybeResolve() {
    if (!this.revealed || !this.theirPick || !this.pick || this.over) return;
    const a = this.pick;
    const b = this.theirPick;
    this.els.theirHand.className = 'v2-hand';
    this.els.theirHand.textContent = HANDS[b];
    play('card_flip', 0.7);
    const res = this.els.result;
    kick(this.els.theirHand, 'v2-pop');
    if (BEATS[a] === b) {
      this.score[0]++;
      res.className = 'v2-result win';
      res.textContent = `${HANDS[a]} beats ${HANDS[b]}`;
      this.els.mineHand.className = 'v2-hand won';
      this.els.theirHand.className = 'v2-hand lost';
      floatText(this.els.scoreMe, '+1', 'good');
      buzz(15);
    } else if (BEATS[b] === a) {
      this.score[1]++;
      res.className = 'v2-result lose';
      res.textContent = `${HANDS[b]} beats ${HANDS[a]}`;
      this.els.mineHand.className = 'v2-hand lost';
      this.els.theirHand.className = 'v2-hand won';
      floatText(this.els.scoreThem, '+1', 'bad');
      buzz([40, 30, 40]);
    } else {
      res.className = 'v2-result';
      res.textContent = 'Same pick: go again';
    }
    this.els.scoreMe.textContent = String(this.score[0]);
    this.els.scoreThem.textContent = String(this.score[1]);
    this.stopTimers();
    if (this.score[0] >= TO_WIN || this.score[1] >= TO_WIN || this.round >= MAX_ROUNDS) return this.finish('done');
    this.round++;
    this.setStatus('Next round…');
    this.timers.push(setTimeout(() => this.startRound(), 1600));
  }

  private finish(why: 'done' | 'quit' | 'cheat') {
    if (this.over) return;
    this.over = true;
    this.stopTimers();
    this.setButtons(false);
    this.els.timer.textContent = '';
    const res = this.els.result;
    if (why !== 'done') {
      res.className = 'v2-result';
      res.textContent = why === 'quit' ? `${this.them.name} left the duel` : 'Something went wrong: no winner';
      this.setStatus('');
      return;
    }
    const won = this.score[0] > this.score[1];
    const draw = this.score[0] === this.score[1];
    res.className = 'v2-result ' + (draw ? '' : won ? 'win' : 'lose');
    res.textContent = draw ? 'It’s a draw' : won ? 'You win the duel!' : `${this.them.name} wins the duel`;
    this.setStatus('');
    play(won ? 'win' : 'lose', 0.7);
    if (won) {
      burst(res, 26);
      buzz([20, 40, 20]);
    }
    if (this.host && !draw) {
      const [winner, loser] = won ? [this.me.id, this.them.id] : [this.them.id, this.me.id];
      this.deps.send({ k: 'end', id: this.id, from: this.me.id, winner, loser, score: this.score });
      this.deps.onEnd(winner, loser);
      this.deps.record([this.me.id, this.them.id], [winner], { [this.me.id]: this.score[0], [this.them.id]: this.score[1] });
    }
    this.els.again.hidden = false;
    if (this.els.rematch && this.deps.rematch) this.els.rematch.hidden = false;
  }

  private stopTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private setButtons(on: boolean) {
    this.els.picks?.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = !on));
  }

  private setStatus(t: string) {
    this.els.status.textContent = t;
  }

  private render() {
    this.ui = openModal('duel', { label: 'duel-title' });
    const p = this.ui.panel;
    const head = el('div', 'v2-head');
    const h = el('h2', '', 'Rock paper scissors');
    h.id = 'duel-title';
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'duel-close';
    x.setAttribute('aria-label', 'Leave the duel');
    x.append(icon('x'));
    x.addEventListener('click', () => this.close());
    head.append(icon('swords'), h, x);
    const side = (who: Who, label: string, hand: string) => {
      const s = el('div', 'side');
      const handEl = el('div', 'v2-hand', '❔');
      handEl.id = hand;
      const sc = el('span', 'v2-score', '0');
      s.append(portrait(who.character, 32), el('b', '', label), handEl, sc);
      return { s, handEl, sc };
    };
    const a = side(this.me, 'You', 'duel-mine');
    const b = side(this.them, this.them.name, 'duel-theirs');
    const vs = el('div', 'v2-vs');
    const mid = el('div');
    mid.style.cssText = 'display:grid;gap:4px;justify-items:center';
    const round = el('span', 'x', 'Round 1');
    const timer = el('span', 'v2-note', '');
    timer.id = 'duel-timer';
    mid.append(round, timer);
    vs.append(a.s, mid, b.s);
    const result = el('div', 'v2-result');
    result.id = 'duel-result';
    const status = el('p', 'v2-note');
    status.id = 'duel-status';
    status.style.textAlign = 'center';
    const picks = el('div', 'v2-rps');
    for (const k of Object.keys(HANDS) as Hand[]) {
      const btn = el('button');
      btn.type = 'button';
      btn.dataset.hand = k;
      btn.append(document.createTextNode(HANDS[k]), el('small', '', k));
      btn.addEventListener('click', () => void this.choose(k));
      picks.append(btn);
    }
    const again = el('button', 'dh-btn dh-btn--quiet', 'Close');
    again.type = 'button';
    again.id = 'duel-done';
    again.hidden = true;
    again.addEventListener('click', () => this.close());
    const rematch = el('button', 'dh-btn', 'Rematch');
    rematch.type = 'button';
    rematch.id = 'duel-rematch';
    rematch.hidden = true;
    rematch.addEventListener('click', () => {
      this.close();
      this.deps.rematch?.();
    });
    const ends = el('div', 'dh-row');
    ends.style.cssText = 'justify-content:center;gap:10px;min-height:0';
    ends.append(again, rematch);
    p.append(head, vs, result, status, picks, ends);
    this.els = { round, timer, result, status, picks, again, rematch, mineHand: a.handEl, theirHand: b.handEl, scoreMe: a.sc, scoreThem: b.sc };
  }
}
