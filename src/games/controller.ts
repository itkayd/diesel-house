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
    lobby: 'Everyone at this table plays. 5 rounds; fastest three each round get 3, 2 and 1 points.',
    host: (c) => new QuickDrawHost(c.table, c.record),
    view: (me, act, names) => new QuickDrawView(me, act, names),
    running: (st) => (st as { phase: string }).phase === 'round',
    winners: (s) => topScorers((s.state as { points: Record<string, number> }).points),
  },
  higherlower: {
    short: 'hl', min: 2, max: 8,
    lobby: 'Everyone at this table plays, taking turns. Is the next card higher or lower? Each right guess in a row is worth more: bank before you bust. 3 rounds.',
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
    lobby: 'Everyone at this table plays. 8 questions, 15 seconds each, answered in secret. First right answer 3 points, second 2, the rest 1.',
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
    return `${this.screen}|${this.running(spot)}|${!!this.view}|${t?.people.map((p) => p.id).join(',') ?? ''}`;
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
    this.deps.played?.(s.game, TABLE[s.game].winners(s).includes(t.id), { fastestMs: this.qdBest.get(key) });
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
      this.shownKey = this.tableKey(spot);
      return this.renderList(body, spot);
    }
    if (this.screen === 'dice') body.append(diceView((r) => this.deps.roll(r)));
    if (this.screen === 'rps') this.renderRps(body);
    if (isTableGame(this.screen)) this.renderTable(body, spot, this.screen);
    body.append(this.back());
  }

  private renderList(body: HTMLElement, spot: SpotId) {
    const allowed = this.deps.allowed(spot);
    const here = gamesFor(this.deps.kind(spot)).map((g) => g.id);
    const grid = el('div', 'v2-games');
    const t = this.tables.get(spot);
    const playing = this.running(spot) ? t?.snap?.game : null;
    for (const id of ALL_GAMES.filter((g) => here.includes(g))) {
      const g = GAMES[id];
      const off = allowed !== null && !allowed.includes(id);
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
      b.append(top, el('b', '', g.title), el('span', '', off ? 'Off in this room' : g.sub));
      if (!b.disabled) b.addEventListener('click', () => this.show(id as Games['screen']));
      grid.append(b);
    }
    body.append(this.whoIsHere(spot), grid);
    // The one-player arcade game (also at the Gaming room's cabinets).
    const arcade = this.deps.arcade;
    if (arcade) {
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
      body.append(this.view.root);
      this.view.show(s);
      this.again(t, s);
      this.shownKey = this.tableKey(spot);
      return;
    }
    // Lobby: the first `max` people at the table play (us first), the rest watch.
    const people = this.lineup(t, g);
    const watching = Math.max(0, (t.people.length || 1) - people.length);
    body.append(el('p', 'v2-note', g.lobby), rulesFold(game));
    const list = el('div', 'v2-list');
    list.id = `${g.short}-lobby`;
    for (const p of people) {
      const row = el('div', 'v2-item');
      row.append(portrait(this.deps.names(p.id).character ?? p.character, 32), el('span', 't', p.id === t.id ? 'You' : p.name));
      list.append(row);
    }
    body.append(list);
    if (watching) body.append(el('p', 'v2-note', `${watching} more at the table will watch.`));
    const alone = people.length < g.min;
    if (alone) body.append(el('p', 'v2-note', 'Nobody else is at this table yet. Ask a friend to walk over and open it too.'));
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

  // Who plays: us first, then by when they sat down, up to the game's maximum.
  private lineup(t: GameTable, g: TableGame) {
    const people = t.people.length ? t.people : [t.seat()];
    const me = people.find((p) => p.id === t.id) ?? t.seat();
    return [me, ...people.filter((p) => p.id !== t.id)].slice(0, g.max);
  }

  // After a game: "Play again" under the result.
  private again(t: GameTable, s: Snapshot) {
    const game = s.game as TableGameId;
    const root = this.view?.root;
    if (!root) return;
    root.querySelector('.v2-again')?.remove();
    if (TABLE[game].running(s.state)) return;
    const few = this.lineup(t, TABLE[game]).length < TABLE[game].min;
    const b = this.startButton(t, game, few ? 'Waiting for a second player…' : 'Play again', few);
    b.classList.add('v2-again');
    root.append(b);
  }

  private startButton(t: GameTable, game: TableGameId, label: string, disabled = false) {
    const g = TABLE[game];
    const b = el('button', 'dh-btn');
    b.type = 'button';
    b.id = `${g.short}-start`;
    b.disabled = disabled;
    b.append(icon(GAMES[game].icon), document.createTextNode(label));
    b.addEventListener('click', () => {
      const players = this.lineup(t, g);
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
