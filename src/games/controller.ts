import type { Skin } from '../characters';
import { isTouchDevice } from '../ui/joystick';
import { icon, type IconName } from '../ui/icons';
import { el, openModal } from '../ui/modal';
import { overlay } from '../ui/overlay';
import { portrait } from '../ui/portrait';
import { play } from '../ui/sounds';
import { diceView, type Roll } from './dice';
import { FourHost, FourView } from './fourInARow';
import { HigherLowerHost, HigherLowerView } from './higherLower';
import { HotTakesHost, HotTakesView } from './hotTakes';
import { LetterRushHost, LetterRushView } from './letterRush';
import { LiarsDiceHost, LiarsDiceView, type LDState } from './liarsDice';
import { QuizHost, QuizView } from './quiz';
import { SketchHost, SketchView } from './sketch';
import { topScorers } from './kit';
import { QuickDrawHost, QuickDrawView, type QDState } from './quickDraw';
import { ALL_GAMES, gamesFor, type GameId } from './catalog';
import { arcadeOn, gameOn } from '../net/houseSettings';
import { openRules, rulesFold } from './rules';
import { GameTable, type Names, type Recorder, type Snapshot, type SpotId, type Table, type TableHost, type TableView } from './table';

// The games corner (west end of the hallway) and room tables (UPDATE.md Phase 12): walking onto a spot
// shows "Play games · E"; the games panel opens over the world, so you stay in the room and voice keeps
// working. Lists the games; Dice and the rock-paper-scissors duel are personal, the table games (Quick
// Draw, and Phase 13's Higher or lower, Would you rather and Four in a row) run on the spot's table:
// a lobby of everyone sitting there, then the game, with anyone not playing watching.

export { ALL_GAMES, gamesFor, SOFA_GAMES, TABLE_GAMES, type GameId } from './catalog';
// players: shown on the card ("1+", "2", "2–8").
const GAMES: Record<GameId, { icon: IconName; title: string; sub: string; players: string }> = {
  dice: { icon: 'dice-5', title: 'Dice', sub: 'Roll two dice. Everyone sees it.', players: '1+' },
  rps: { icon: 'swords', title: 'Rock paper scissors', sub: 'Best of three. Picks are locked in first.', players: '2' },
  quickdraw: { icon: 'zap', title: 'Quick Draw', sub: 'Wait for DRAW!, then tap. Too soon = out.', players: '2–8' },
  higherlower: { icon: 'arrow-up-down', title: 'Higher or lower', sub: 'Guess the next card. Bank before you bust.', players: '2–8' },
  wyr: { icon: 'messages-square', title: 'Would you rather', sub: 'Vote in secret, then see who picked what.', players: '2–8' },
  four: { icon: 'grid-3x3', title: 'Four in a row', sub: 'Two players, a 7 by 6 grid. Others watch.', players: '2' },
  quiz: { icon: 'brain', title: 'Quiz night', sub: '8 questions. Fastest right answer scores most.', players: '2–8' },
  sketch: { icon: 'brush', title: 'Sketch & guess', sub: 'Take turns to draw a word. Everyone else guesses.', players: '2–8' },
  liars: { icon: 'dices', title: 'Liar’s dice', sub: 'Bid on the dice under everyone’s cups. Call the bluff.', players: '2–6' },
  letters: { icon: 'type', title: 'Letter rush', sub: 'One letter, four categories, 60 seconds.', players: '2–8' },
};

// The games played on a spot's table: who can play, the lobby's line, and their host and screen.
type TableGameId = 'quickdraw' | 'higherlower' | 'wyr' | 'four' | 'quiz' | 'sketch' | 'liars' | 'letters';
type Ctx = { table: Table; record: Recorder; prompts: () => string[] };
type TableGame = {
  short: string; // element ids: qd-start, hl-lobby, …
  min: number;
  max: number;
  lobby: string;
  host: (c: Ctx) => TableHost;
  view: (me: string, act: (a: unknown) => void, names: Names) => TableView;
  running: (state: unknown) => boolean;
  winners: (s: Snapshot) => string[];
};
const TABLE: Record<TableGameId, TableGame> = {
  quickdraw: {
    short: 'qd', min: 2, max: 8,
    lobby: 'Everyone who’s in plays. 5 rounds; fastest three each round get 3, 2 and 1 points.',
    host: (c) => new QuickDrawHost(c.table, c.record),
    view: (me, act, names) => new QuickDrawView(me, act, names),
    running: (st) => (st as { phase: string }).phase === 'round',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  higherlower: {
    short: 'hl', min: 2, max: 8,
    lobby: 'Everyone who’s in plays, taking turns. Is the next card higher or lower? Each right guess in a row is worth more: bank before you bust. 3 rounds.',
    host: (c) => new HigherLowerHost(c.table, c.record),
    view: (me, act, names) => new HigherLowerView(me, act, names),
    running: (st) => (st as { phase: string }).phase === 'turn',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  wyr: {
    short: 'wyr', min: 2, max: 8,
    lobby: 'Everyone votes in secret, then the reveal shows who picked what. A point for siding with the majority. 5 prompts; best with 3 or more.',
    host: (c) => new HotTakesHost(c.table, c.record, c.prompts),
    view: (me, act, names) => new HotTakesView(me, act, names),
    running: (st) => (st as { phase: string }).phase !== 'done',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  four: {
    short: 'four', min: 2, max: 2,
    lobby: 'Two players: you and the next person at the table. Everyone else watches. Line up four of your pieces to win.',
    host: (c) => new FourHost(c.table, c.record),
    view: (me, act, names) => new FourView(me, act, names),
    running: (st) => (st as { phase: string }).phase === 'play',
    winners: (s) => {
      const w = (s.state as { winner?: string | null }).winner;
      return w ? [w] : [];
    },
  },
  quiz: {
    short: 'quiz', min: 2, max: 8,
    lobby: 'Everyone who’s in plays. 8 questions, 15 seconds each, answered in secret. First right answer 3 points, second 2, the rest 1.',
    host: (c) => new QuizHost(c.table, c.record),
    view: (me, act, names) => new QuizView(me, act, names),
    running: (st) => (st as { phase: string }).phase !== 'done',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  sketch: {
    short: 'sk', min: 2, max: 8,
    lobby: 'Everyone takes a turn to draw a secret word while the others type guesses. Quicker guesses score more, and the artist scores for every right guess.',
    host: (c) => new SketchHost(c.table, c.record),
    view: (me, act, names) => new SketchView(me, act, names),
    running: (st) => (st as { phase: string }).phase !== 'done',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  liars: {
    short: 'ld', min: 2, max: 6,
    lobby: 'Five dice each, hidden under your cup. Bid how many of a face are on the whole table (1s count as any face), or call Liar! Lose all your dice and you’re out.',
    host: (c) => new LiarsDiceHost(c.table, c.record),
    view: (me, act, names) => new LiarsDiceView(me, act, names),
    running: (st) => (st as { phase: string }).phase !== 'done',
    winners: (s) => {
      const w = (s.state as LDState).winner;
      return w ? [w] : [];
    },
  },
  letters: {
    short: 'lr', min: 2, max: 8,
    lobby: 'A letter and four categories: write an answer for each in 60 seconds. Then thumbs down anything that doesn’t count. 3 rounds.',
    host: (c) => new LetterRushHost(c.table, c.record),
    view: (me, act, names) => new LetterRushView(me, act, names),
    running: (st) => (st as { phase: string }).phase !== 'done',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
};
const isTableGame = (g: string): g is TableGameId => g in TABLE;
const CHEERS = ['👏', '😂', '😮', '🔥'];
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// Games whose end we've already counted (challenges), kept for this tab so a reload doesn't count them again.
const SEEN_KEY = 'diesel-house.games-seen';
function readSeen(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function saveSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-50)));
  } catch {
    // private browsing: memory only
  }
}

type Who = { id: string; name: string; character: Skin; guest?: boolean };
export type GameDeps = {
  me: () => Who;
  names: (id: string) => { name: string; character?: Skin };
  // People in the same place as us, for "Challenge" (Rock paper scissors).
  nearby: () => Who[];
  // Games the room owner allows at this spot (null: all).
  allowed: (spot: SpotId) => GameId[] | null;
  // The room owner's own Would you rather prompts ("A|B").
  prompts: (spot: SpotId) => string[];
  // A table, or a sofa corner (no card or board games).
  kind: (spot: SpotId) => 'table' | 'sofa' | null;
  roll: (r: Roll) => void;
  challenge: (id: string) => void;
  record: (game: GameId, spot: SpotId, players: string[], winners: string[], score: unknown, seed?: string) => void;
  // Phase 14: a table game we played in ended (everyone at the table, not just the host); we started one.
  played?: (game: GameId, won: boolean, info: { fastestMs?: number }) => void;
  hosted?: (game: GameId, players: number) => void;
  quickDrawRound?: () => void; // we were fastest in a Quick Draw round
  arcade?: () => void; // open Night Raid (one player)
  hideSeek?: () => void; // start (or join) Hide and seek, the whole house
  // U4: ping friends (or everyone in the house) to come and play here. Returns who was asked, or why not.
  invite?: (spot: SpotId) => string;
};

export class Games {
  private tables = new Map<SpotId, GameTable>();
  private host: TableHost | null = null;
  private view: TableView | null = null;
  private viewGame: TableGameId | null = null;
  private shownKey = ''; // what the table screen showed last (see tableKey)
  private ui: ReturnType<typeof openModal> | null = null;
  private body: HTMLDivElement | null = null;
  private screen: 'list' | 'dice' | 'rps' | TableGameId = 'list';
  private spot: SpotId | null = null;
  private prompt: HTMLDivElement | null = null;
  private promptSpot: SpotId | null = null;
  private arrived: SpotId | null = null; // the spot we last walked onto (its click has played)
  private lastGame = new Map<SpotId, string>(); // per table: the game last seen starting (gen:host:game)
  // U5: when each game started and ended (by gen:host:game), our record at each game tonight, a watcher's
  // "Join next game", and when we last cheered.
  private startedAt = new Map<string, number>();
  private endedAt = new Map<string, number>();
  private tonight = new Map<TableGameId, { played: number; won: number }>();
  private joinNext: TableGameId | null = null;
  private lastCheer = 0;

  constructor(private deps: GameDeps) {}

  get openSpot() {
    return this.spot;
  }

  // Standing on a spot (or not): the "Play games · E" button. `hidden`: a window is open over it (the
  // button goes, but coming back to it isn't a new arrival, so no click sound).
  showPrompt(spot: SpotId | null, hidden = false) {
    const want = hidden ? null : spot;
    if (!hidden && !spot) this.arrived = null;
    if (want === this.promptSpot) return;
    this.promptSpot = want;
    this.prompt?.remove();
    this.prompt = null;
    if (!want) return;
    const box = el('div', 'v2-act');
    const b = el('button', 'dh-btn');
    b.type = 'button';
    b.id = 'game-prompt';
    b.append(icon('dice-5'), document.createTextNode('Play games'));
    if (!isTouchDevice()) b.append(el('kbd', '', 'E'));
    b.addEventListener('click', () => this.open(want));
    box.append(b);
    overlay().append(box);
    this.prompt = box;
    if (this.arrived !== want) play('click', 0.4);
    this.arrived = want;
  }

  get promptFor() {
    return this.promptSpot;
  }

  open(spot: SpotId, screen: 'list' | TableGameId = 'list') {
    if (this.ui && this.spot === spot) return;
    this.close();
    this.spot = spot;
    this.ui = openModal('games', { dismissable: true, onDismiss: () => this.closed(), label: 'games-title' });
    const p = this.ui.panel;
    const head = el('div', 'v2-head');
    const h = el('h2', '', spot === 'hall' ? 'Games table' : this.deps.kind(spot) === 'sofa' ? 'Sofa games' : 'Table games');
    h.id = 'games-title';
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'games-close';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', () => this.close());
    // How to play: the game on screen, or the handbook from the start.
    const help = el('button', 'dh-iconbtn');
    help.type = 'button';
    help.id = 'games-help';
    help.setAttribute('aria-label', 'How to play');
    help.append(icon('circle-help'));
    help.addEventListener('click', () => openRules(this.screen === 'list' ? 'quiz' : this.screen));
    head.append(icon('dice-5'), h, help, x);
    this.body = el('div');
    this.body.style.cssText = 'display:grid;gap:12px';
    p.append(head, this.body);
    this.table(spot).open();
    // A game already going at this table: straight to it.
    const s = this.table(spot).snap;
    this.show(s && this.running(spot) && isTableGame(s.game) ? s.game : screen);
  }

  close() {
    this.ui?.close();
    this.closed();
  }

  // Standing up from the table (panel closed, or walked away).
  private closed() {
    this.ui = null;
    this.body = null;
    this.dropView();
    if (this.host) {
      this.host.stop();
      this.host = null;
    }
    if (this.spot) this.tables.get(this.spot)?.close();
    this.spot = null;
  }

  private table(spot: SpotId) {
    let t = this.tables.get(spot);
    if (t) return t;
    const me = this.deps.me();
    t = new GameTable(spot, me, {
      onSnapshot: (s) => this.snapshot(spot, s),
      onAction: (from, a) => this.host?.onAction(from, a as never),
      onPeople: () => {
        this.host?.onPeople();
        // Lobby: refresh who's here. A game we're not showing yet (we sat down before we knew its host was here): show it.
        // Only when something changed, so the Start button isn't rebuilt under a finger.
        if (this.spot === spot && (this.screen === 'list' || (isTableGame(this.screen) && (!this.running(spot) || !this.view))) && this.tableKey(spot) !== this.shownKey) this.render();
      },
      running: (s) => isTableGame(s.game) && TABLE[s.game].running(s.state),
      // Someone is in (or out) for a game: the lobby and the list show it.
      onReady: () => {
        if (this.spot === spot && (this.screen === 'list' || (isTableGame(this.screen) && !this.view)) && this.tableKey(spot) !== this.shownKey) this.render();
        else if (this.spot === spot && this.view && this.viewGame) {
          const s = t!.snap;
          if (s) this.again(t!, s);
        }
      },
      onCheer: (from, emoji) => {
        if (this.spot === spot) this.floatCheer(from, emoji);
      },
      onTakeover: (s) => {
        if (!isTableGame(s.game) || this.spot !== spot) return;
        this.host?.stop();
        this.host = this.newHost(t!, s.game);
        void this.host.takeover(s);
      },
    });
    this.tables.set(spot, t);
    return t;
  }

  private newHost(t: GameTable, game: TableGameId) {
    const spot = t.spot;
    return TABLE[game].host({
      table: t,
      record: (players, winners, score, seed) => this.deps.record(game, spot, players, winners, score, seed),
      prompts: () => this.deps.prompts(spot),
    });
  }

  // What the table screen depends on: the game shown, whether one is going, who's sitting there.
  private tableKey(spot: SpotId) {
    const t = this.tables.get(spot);
    const ready = isTableGame(this.screen) ? (t?.readyFor(this.screen).map((p) => p.id).join(',') ?? '') : ALL_GAMES.map((g) => t?.readyFor(g).length ?? 0).join('');
    return `${this.screen}|${this.running(spot)}|${!!this.view}|${t?.people.map((p) => p.id).join(',') ?? ''}|${ready}`;
  }

  // A game is going at this table, and its host is still sitting there.
  private running(spot: SpotId) {
    const t = this.tables.get(spot);
    const s = t?.snap;
    if (!t || !s || !isTableGame(s.game) || !TABLE[s.game].running(s.state)) return false;
    return s.host === t.id || t.people.some((p) => p.id === s.host);
  }

  // Phase 14: notice a game ending for us (once per game), and our Quick Draw round wins and times.
  private seenEnd = new Set<string>(readSeen());
  private qdBest = new Map<string, number>();
  private qdRound = new Set<string>();
  private notice(t: GameTable, s: Snapshot) {
    if (!isTableGame(s.game) || !s.players.some((p) => p.id === t.id)) return;
    const key = `${s.game}:${s.players.map((p) => p.id).join(',')}:${(s.state as { commit?: string }).commit ?? s.v}`;
    if (s.game === 'quickdraw') {
      const last = (s.state as QDState).last;
      const mine = last?.times[t.id];
      if (last && mine !== undefined && mine >= 0) {
        this.qdBest.set(key, Math.min(this.qdBest.get(key) ?? Infinity, mine));
        const fastest = Math.min(...Object.values(last.times).filter((ms) => ms >= 0));
        const r = `${key}:${last.round}`;
        if (mine === fastest && !this.qdRound.has(r)) {
          this.qdRound.add(r);
          this.deps.quickDrawRound?.();
        }
      }
    }
    if (TABLE[s.game].running(s.state) || this.seenEnd.has(key)) return;
    this.seenEnd.add(key);
    saveSeen(this.seenEnd);
    const won = TABLE[s.game].winners(s).includes(t.id);
    const rec = this.tonight.get(s.game) ?? { played: 0, won: 0 };
    this.tonight.set(s.game, { played: rec.played + 1, won: rec.won + (won ? 1 : 0) });
    this.deps.played?.(s.game, won, { fastestMs: this.qdBest.get(key) });
  }

  private snapshot(spot: SpotId, s: Snapshot) {
    const tbl = this.tables.get(spot);
    if (tbl) this.notice(tbl, s);
    if (spot !== this.spot) return;
    const t = this.tables.get(spot)!;
    // Someone else started a new game: we're not the host any more.
    if (this.host && !t.isHost) {
      this.host.stop();
      this.host = null;
    }
    if (!isTableGame(s.game)) return;
    // Only jump to the game when one has just started (or we're playing in it), not on every update of
    // a game we're watching from the list or the dice.
    const start = `${s.gen ?? 0}:${s.host}:${s.game}`;
    const isNew = this.lastGame.get(spot) !== start;
    this.lastGame.set(spot, start);
    const mine = s.players.some((p) => p.id === t.id);
    if (!this.startedAt.has(start)) this.startedAt.set(start, Date.now());
    if (!TABLE[s.game].running(s.state) && !this.endedAt.has(start)) this.endedAt.set(start, Date.now());
    // A game we're dealt into has just started (the one who pressed Start already heard the click).
    if (isNew && mine && !t.isHost && TABLE[s.game].running(s.state)) play('card_shuffle', 0.5);
    if (isNew) this.joinNext = null;
    if (this.screen !== s.game) {
      if (isNew || mine) this.show(s.game);
      else if (this.screen === 'list' || isTableGame(this.screen)) this.render();
    } else if (this.view && this.viewGame === s.game) {
      this.view.show(s);
      this.again(t, s);
    } else this.render();
  }

  private dropView() {
    this.view?.destroy();
    this.view = null;
    this.viewGame = null;
  }

  private show(screen: Games['screen']) {
    this.screen = screen;
    this.render();
  }

  private render() {
    const body = this.body;
    const spot = this.spot;
    if (!body || !spot) return;
    if (this.screen !== this.viewGame) this.dropView();
    body.replaceChildren();
    this.shownKey = '';
    if (this.screen === 'list') {
      this.syncReady();
      this.shownKey = this.tableKey(spot);
      return this.renderList(body, spot);
    }
    if (this.screen === 'dice') body.append(diceView((r) => this.deps.roll(r)));
    if (this.screen === 'rps') this.renderRps(body);
    if (isTableGame(this.screen)) this.renderTable(body, spot, this.screen);
    body.append(this.back());
    this.syncReady();
  }

  // The ready step: we're in for the game whose lobby we're looking at, or the one we just played (for a
  // rematch); a watcher only after "Join next game". Anywhere else, we're not in for anything.
  private syncReady() {
    const spot = this.spot;
    const t = spot ? this.tables.get(spot) : null;
    if (!t) return;
    const game = this.screen;
    if (!isTableGame(game)) return t.setReady(null);
    const s = t.snap;
    if (this.view && this.viewGame === game && s && s.game === game) {
      const played = s.players.some((p) => p.id === t.id);
      return t.setReady(played || this.joinNext === game ? game : null);
    }
    t.setReady(game);
  }

  private renderList(body: HTMLElement, spot: SpotId) {
    const allowed = this.deps.allowed(spot);
    const here = gamesFor(this.deps.kind(spot)).map((g) => g.id);
    const grid = el('div', 'v2-games');
    const t = this.tables.get(spot);
    const playing = this.running(spot) ? t?.snap?.game : null;
    for (const id of ALL_GAMES.filter((g) => here.includes(g))) {
      const g = GAMES[id];
      const houseOff = !gameOn(id);
      const off = houseOff || (allowed !== null && !allowed.includes(id));
      const b = el('button', 'v2-game' + (off ? ' soon' : '') + (playing === id ? ' live' : ''));
      b.type = 'button';
      b.dataset.game = id;
      b.disabled = off;
      const gi = el('span', 'gi');
      gi.append(icon(g.icon));
      const top = el('span', 'top');
      const tag = el('span', 'tag', playing === id ? 'Playing now' : g.players);
      tag.setAttribute('aria-label', playing === id ? 'Being played now' : `${g.players} players`);
      if (playing !== id) tag.prepend(icon('users', { width: 12 }));
      top.append(gi, tag);
      b.append(top, el('b', '', g.title), el('span', '', houseOff ? 'Switched off for now' : off ? 'Off in this room' : g.sub));
      if (!b.disabled) b.addEventListener('click', () => this.show(id as Games['screen']));
      grid.append(b);
    }
    body.append(this.whoIsHere(spot));
    // Someone is waiting in a game's lobby: one tap joins them.
    if (t && !playing)
      for (const id of ALL_GAMES.filter((g) => here.includes(g) && isTableGame(g))) {
        const waiting = t.readyFor(id).filter((p) => p.id !== t.id);
        if (!waiting.length || !gameOn(id)) continue;
        const names = waiting.map((p) => this.deps.names(p.id).name || p.name);
        const row = el('div', 'v2-item v2-waiting');
        row.dataset.waiting = id;
        const faces = el('span', 'faces');
        for (const p of waiting.slice(0, 3)) faces.append(portrait(this.deps.names(p.id).character ?? p.character, 28));
        const txt = el('span', 't', `${names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' & ')} ${names.length > 1 ? 'are' : 'is'} in for ${GAMES[id].title}`);
        const join = el('button', 'dh-btn');
        join.type = 'button';
        join.id = `join-${id}`;
        join.append(icon(GAMES[id].icon, { width: 18 }), document.createTextNode('Join'));
        join.addEventListener('click', () => this.show(id as Games['screen']));
        row.append(faces, txt, join);
        body.append(row);
      }
    const invite = this.deps.invite;
    if (invite) {
      const b = el('button', 'dh-btn dh-btn--quiet');
      b.type = 'button';
      b.id = 'games-invite';
      b.append(icon('users', { width: 18 }), document.createTextNode('Invite friends to this table'));
      b.addEventListener('click', () => {
        const said = invite(spot);
        b.replaceChildren(icon('check', { width: 18 }), document.createTextNode(said));
        b.disabled = true;
        setTimeout(() => {
          if (!b.isConnected) return;
          b.replaceChildren(icon('users', { width: 18 }), document.createTextNode('Invite friends to this table'));
          b.disabled = false;
        }, 20_000);
      });
      body.append(b);
    }
    body.append(grid);
    // The one-player arcade game (also at the Gaming room's cabinets).
    const arcade = this.deps.arcade;
    if (arcade && arcadeOn()) {
      const a = el('button', 'v2-game v2-game--wide');
      a.type = 'button';
      a.id = 'games-arcade';
      const gi = el('span', 'gi');
      gi.append(icon('gamepad-2'));
      const top = el('span', 'top');
      const tag = el('span', 'tag', '1');
      tag.prepend(icon('users', { width: 12 }));
      top.append(gi, tag);
      a.append(top, el('b', '', 'Night Raid (arcade)'), el('span', '', 'Throw shurikens at the spooks raiding the rooftop. Beat your best for XP.'));
      a.addEventListener('click', () => {
        this.close();
        arcade();
      });
      body.append(a);
    }
    // Hide and seek: the whole house, not this table.
    const hs = this.deps.hideSeek;
    if (hs && gameOn('hideseek')) {
      const a = el('button', 'v2-game v2-game--wide');
      a.type = 'button';
      a.id = 'games-hideseek';
      const gi = el('span', 'gi');
      gi.append(icon('eye'));
      const top = el('span', 'top');
      const tag = el('span', 'tag', '2–12');
      tag.prepend(icon('users', { width: 12 }));
      top.append(gi, tag);
      a.append(top, el('b', '', 'Hide and seek (whole house)'), el('span', '', 'One seeker with a torch, everyone else hides in cupboards, behind sofas, among the plants.'));
      a.addEventListener('click', () => {
        this.close();
        hs();
      });
      body.append(a);
    }
    const how = el('button', 'dh-btn dh-btn--quiet');
    how.type = 'button';
    how.id = 'games-how';
    how.append(icon('circle-help'), document.createTextNode('How every game works'));
    how.addEventListener('click', () => openRules());
    body.append(how, el('p', 'v2-note', 'Games are quick and you stay in voice while you play.'));
  }

  // Faces of everyone sitting at this table (you first).
  private whoIsHere(spot: SpotId) {
    const t = this.tables.get(spot);
    const people = t?.people ?? [];
    const row = el('div', 'v2-seated');
    row.id = 'games-seated';
    const faces = el('span', 'faces');
    const shown = people.slice(0, 6);
    for (const p of shown) {
      const who = this.deps.names(p.id);
      const f = portrait(who.character ?? p.character, 24);
      f.title = p.id === t?.id ? 'You' : who.name || p.name;
      faces.append(f);
    }
    const n = people.length;
    const text = n <= 1 ? 'Just you here. Games need 2+, so wave someone over.' : `${n} at this table${n > shown.length ? ` (+${n - shown.length})` : ''}`;
    row.append(faces, el('span', '', text));
    return row;
  }

  private renderRps(body: HTMLElement) {
    const people = this.deps.nearby();
    body.append(el('p', 'v2-note', people.length ? 'Pick someone to challenge. Best of three.' : 'Nobody here yet. You can also tap a friend anywhere and pick Duel.'), rulesFold('rps'));
    const list = el('div', 'v2-list');
    for (const p of people) {
      const row = el('div', 'v2-item');
      const b = el('button', 'dh-btn dh-btn--quiet');
      b.type = 'button';
      b.dataset.challenge = p.id;
      b.append(icon('swords', { width: 18 }), document.createTextNode('Challenge'));
      b.addEventListener('click', () => {
        this.close();
        this.deps.challenge(p.id);
      });
      const name = el('span', 't', p.name);
      row.append(portrait(p.character, 32), name, b);
      list.append(row);
    }
    body.append(list);
  }

  private renderTable(body: HTMLElement, spot: SpotId, game: TableGameId) {
    const t = this.table(spot);
    const g = TABLE[game];
    const s = t.snap;
    // The game (going, or just finished and still on screen).
    if (s && s.game === game && (this.running(spot) || (this.view && this.viewGame === game))) {
      if (!this.view || this.viewGame !== game) {
        this.dropView();
        this.view = g.view(t.id, (a) => t.act(a), (id) => this.deps.names(id));
        this.viewGame = game;
      }
      body.append(this.view.root, this.cheers(t));
      this.view.show(s);
      this.again(t, s);
      this.shownKey = this.tableKey(spot);
      return;
    }
    // Lobby: the first `max` people at the table play (us first), the rest watch.
    const people = this.lineup(t, g, game);
    const watching = Math.max(0, (t.people.length || 1) - people.length);
    body.append(el('p', 'v2-note', g.lobby), rulesFold(game));
    const list = el('div', 'v2-list');
    list.id = `${g.short}-lobby`;
    for (const p of people) {
      const row = el('div', 'v2-item');
      row.dataset.player = p.id;
      const tick = el('span', 'v2-chip ok', 'In');
      tick.prepend(icon('check', { width: 12 }));
      row.append(portrait(this.deps.names(p.id).character ?? p.character, 32), el('span', 't', p.id === t.id ? 'You' : this.deps.names(p.id).name || p.name), tick);
      list.append(row);
    }
    // Sitting here but not in yet: they join by opening this game (they see "… is in for …" on their list).
    const notIn = t.people.filter((p) => !people.some((q) => q.id === p.id));
    for (const p of notIn) {
      const row = el('div', 'v2-item out');
      row.dataset.player = p.id;
      row.append(portrait(this.deps.names(p.id).character ?? p.character, 32), el('span', 't', this.deps.names(p.id).name || p.name), el('span', 'v2-chip', 'Not in yet'));
      list.append(row);
    }
    body.append(list);
    if (watching) body.append(el('p', 'v2-note', notIn.length ? 'Anyone not in when you start watches this game.' : `${watching} more at the table will watch.`));
    const alone = people.length < g.min;
    if (alone)
      body.append(el('p', 'v2-note', t.people.length > 1 ? `Waiting for someone to join: they’ll see you’re in for ${GAMES[game].title}.` : 'Nobody else is at this table yet. Ask a friend to walk over and open it too.'));
    // Another game is going at this table: starting this one would end theirs.
    const busy = this.running(spot) && s ? s.game : null;
    if (busy && isTableGame(busy)) {
      const go = el('button', 'dh-btn dh-btn--quiet');
      go.type = 'button';
      go.id = `${g.short}-watch`;
      go.append(icon(GAMES[busy].icon), document.createTextNode(`Watch ${GAMES[busy].title}`));
      go.addEventListener('click', () => this.show(busy));
      body.append(el('p', 'v2-note', `${GAMES[busy].title} is being played here. Start when it’s finished.`), this.startButton(t, game, 'A game is going…', true), go);
    } else body.append(this.startButton(t, game, alone ? 'Waiting for someone to join…' : `Start with ${people.length} players`, alone));
    this.shownKey = this.tableKey(spot);
  }

  // Who plays: us first, then everyone who is in for this game (the ready step), by when they sat down, up
  // to the game's maximum.
  private lineup(t: GameTable, g: TableGame, game: TableGameId) {
    const me = t.people.find((p) => p.id === t.id) ?? t.seat();
    return [me, ...t.readyFor(game).filter((p) => p.id !== t.id)].slice(0, g.max);
  }

  // After a game: how it went (your place, how long it took, your record here tonight), then Rematch for
  // the players still here (a watcher taps "Join next game" first).
  private again(t: GameTable, s: Snapshot) {
    const game = s.game as TableGameId;
    const root = this.view?.root;
    if (!root) return;
    root.querySelectorAll('.v2-again, .v2-summary').forEach((x) => x.remove());
    if (TABLE[game].running(s.state)) return;
    this.syncReady();
    const played = s.players.some((p) => p.id === t.id);
    const summary = this.summary(t, s);
    if (summary) root.append(summary);
    if (!played && this.joinNext !== game) {
      const j = el('button', 'dh-btn dh-btn--quiet v2-again');
      j.type = 'button';
      j.id = `${TABLE[game].short}-join-next`;
      j.append(icon('user-round', { width: 18 }), document.createTextNode('Join next game'));
      j.addEventListener('click', () => {
        this.joinNext = game;
        this.again(t, s);
      });
      root.append(j);
      return;
    }
    const n = this.lineup(t, TABLE[game], game).length;
    const few = n < TABLE[game].min;
    const b = this.startButton(t, game, few ? 'Waiting for a second player…' : played ? `Rematch · ${n} players` : `Start · ${n} players`, few);
    b.classList.add('v2-again');
    root.append(b);
  }

  // "2nd of 4 · 3 min 12 s · Tonight: 2 wins from 5".
  private summary(t: GameTable, s: Snapshot) {
    const game = s.game as TableGameId;
    const bits: string[] = [];
    const points = (s.state as { points?: Record<string, number> }).points;
    if (points && s.players.some((p) => p.id === t.id)) {
      const mine = points[t.id] ?? 0;
      const place = 1 + s.players.filter((p) => (points[p.id] ?? 0) > mine).length;
      const tied = s.players.filter((p) => p.id !== t.id && (points[p.id] ?? 0) === mine).length > 0;
      bits.push(`${tied ? 'Joint ' : ''}${ordinal(place)} of ${s.players.length}`);
    }
    const key = `${s.gen ?? 0}:${s.host}:${s.game}`;
    const from = this.startedAt.get(key);
    const to = this.endedAt.get(key);
    if (from && to && to - from > 5000) {
      const secs = Math.round((to - from) / 1000);
      bits.push(secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} s`);
    }
    const rec = this.tonight.get(game);
    if (rec?.played) bits.push(`Tonight: ${rec.won} win${rec.won === 1 ? '' : 's'} from ${rec.played}`);
    if (!bits.length) return null;
    const box = el('div', 'v2-summary');
    box.id = 'games-summary';
    box.append(icon('trophy', { width: 16 }), el('span', '', bits.join(' · ')));
    return box;
  }

  // Quick cheers under the game, for players and watchers alike.
  private cheers(t: GameTable) {
    const row = el('div', 'v2-cheers');
    row.id = 'games-cheers';
    for (const e of CHEERS) {
      const b = el('button', 'v2-cheer-btn', e);
      b.type = 'button';
      b.setAttribute('aria-label', `Cheer ${e}`);
      b.addEventListener('click', () => {
        if (Date.now() - this.lastCheer < 700) return;
        this.lastCheer = Date.now();
        t.cheer(e);
      });
      row.append(b);
    }
    return row;
  }

  // A cheer floats up over the game (with who sent it).
  private floatCheer(from: string, emoji: string) {
    const panel = this.ui?.panel;
    if (!panel || !CHEERS.includes(emoji)) return;
    const f = el('div', 'v2-cheer');
    const t = this.tables.get(this.spot!);
    const me = t?.id === from;
    const seat = t?.people.find((p) => p.id === from);
    f.append(el('span', 'e', emoji), el('span', 'n', me ? 'You' : this.deps.names(from).name || seat?.name || 'Someone'));
    f.style.left = `${15 + Math.random() * 70}%`;
    panel.append(f);
    if (!me) play('emote', 0.25);
    setTimeout(() => f.remove(), 1800);
  }

  private startButton(t: GameTable, game: TableGameId, label: string, disabled = false) {
    const g = TABLE[game];
    const b = el('button', 'dh-btn');
    b.type = 'button';
    b.id = `${g.short}-start`;
    b.disabled = disabled;
    b.append(icon(GAMES[game].icon), document.createTextNode(label));
    b.addEventListener('click', () => {
      const players = this.lineup(t, g, game);
      if (players.length < g.min || (this.running(t.spot) && t.snap?.game !== game) || (this.running(t.spot) && !t.isHost)) return;
      play('confirm', 0.5);
      this.dropView();
      this.host?.stop();
      this.host = this.newHost(t, game);
      void this.host.start(players);
      this.deps.hosted?.(game, players.length);
    });
    return b;
  }

  private back() {
    const b = el('button', 'dh-btn dh-btn--quiet');
    b.type = 'button';
    b.id = 'games-back';
    b.append(icon('arrow-left'), document.createTextNode('All games'));
    b.addEventListener('click', () => this.show('list'));
    return b;
  }
}
