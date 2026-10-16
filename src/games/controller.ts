import { isTouchDevice } from '../ui/joystick';
import { icon, type IconName } from '../ui/icons';
import { el, openModal } from '../ui/modal';
import { overlay } from '../ui/overlay';
import { portrait } from '../ui/portrait';
import { play } from '../ui/sounds';
import { diceView, type Roll } from './dice';
import { QuickDrawHost, QuickDrawView, type QDState } from './quickDraw';
import { GameTable, type Snapshot, type SpotId } from './table';

// The games corner (west end of the hallway) and room tables (UPDATE.md Phase 12): walking onto a spot
// shows "Play games · E"; the games panel opens over the world, so you stay in the room and voice keeps
// working. Lists the games (Phase 13's three as "coming soon"), and runs Quick Draw on the spot's table.

export type GameId = 'dice' | 'rps' | 'quickdraw' | 'higherlower' | 'wyr' | 'four';
export const ALL_GAMES: GameId[] = ['dice', 'rps', 'quickdraw', 'higherlower', 'wyr', 'four'];
// What a room owner can switch off in "Your room" settings.
export const TABLE_GAMES: { id: GameId; label: string }[] = [
  { id: 'dice', label: 'Dice' },
  { id: 'rps', label: 'Rock paper scissors' },
  { id: 'quickdraw', label: 'Quick Draw' },
];
const GAMES: Record<GameId, { icon: IconName; title: string; sub: string; soon?: boolean }> = {
  dice: { icon: 'dice-5', title: 'Dice', sub: 'Roll two dice. Everyone sees it.' },
  rps: { icon: 'swords', title: 'Rock paper scissors', sub: 'Best of three. Picks are locked in first.' },
  quickdraw: { icon: 'zap', title: 'Quick Draw', sub: 'Wait for DRAW!, then tap. Too soon = out.' },
  higherlower: { icon: 'arrow-up-down', title: 'Higher or lower', sub: 'Coming soon', soon: true },
  wyr: { icon: 'messages-square', title: 'Would you rather', sub: 'Coming soon', soon: true },
  four: { icon: 'grid-3x3', title: 'Four in a row', sub: 'Coming soon', soon: true },
};

type Who = { id: string; name: string; character: number; guest?: boolean };
export type GameDeps = {
  me: () => Who;
  names: (id: string) => { name: string; character: number };
  // People in the same place as us, for "Challenge" (Rock paper scissors).
  nearby: () => Who[];
  // Games the room owner allows at this spot (null: all).
  allowed: (spot: SpotId) => GameId[] | null;
  roll: (r: Roll) => void;
  challenge: (id: string) => void;
  record: (game: GameId, spot: SpotId, players: string[], winners: string[], score: unknown, seed?: string) => void;
};

export class Games {
  private tables = new Map<SpotId, GameTable>();
  private host: QuickDrawHost | null = null;
  private view: QuickDrawView | null = null;
  private ui: ReturnType<typeof openModal> | null = null;
  private body: HTMLDivElement | null = null;
  private screen: 'list' | 'dice' | 'rps' | 'quickdraw' = 'list';
  private spot: SpotId | null = null;
  private prompt: HTMLDivElement | null = null;
  private promptSpot: SpotId | null = null;

  constructor(private deps: GameDeps) {}

  get openSpot() {
    return this.spot;
  }

  // Standing on a spot (or not): the "Play games · E" button.
  showPrompt(spot: SpotId | null) {
    if (spot === this.promptSpot) return;
    this.promptSpot = spot;
    this.prompt?.remove();
    this.prompt = null;
    if (!spot) return;
    const box = el('div', 'v2-act');
    const b = el('button', 'dh-btn');
    b.type = 'button';
    b.id = 'game-prompt';
    b.append(icon('dice-5'), document.createTextNode(isTouchDevice() ? 'Tap to play' : 'Play games'));
    if (!isTouchDevice()) b.append(el('kbd', '', 'E'));
    b.addEventListener('click', () => this.open(spot));
    box.append(b);
    overlay().append(box);
    this.prompt = box;
    play('click', 0.4);
  }

  get promptFor() {
    return this.promptSpot;
  }

  open(spot: SpotId, screen: 'list' | 'quickdraw' = 'list') {
    if (this.ui && this.spot === spot) return;
    this.close();
    this.spot = spot;
    this.ui = openModal('games', { dismissable: true, onDismiss: () => this.closed(), label: 'games-title' });
    const p = this.ui.panel;
    const head = el('div', 'v2-head');
    const h = el('h2', '', spot === 'hall' ? 'Games table' : 'Table games');
    h.id = 'games-title';
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'games-close';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', () => this.close());
    head.append(icon('dice-5'), h, x);
    this.body = el('div');
    this.body.style.cssText = 'display:grid;gap:12px';
    p.append(head, this.body);
    this.table(spot).open();
    const s = this.table(spot).snap;
    this.show(screen === 'quickdraw' || (s?.game === 'quickdraw' && (s.state as QDState).phase === 'round') ? 'quickdraw' : 'list');
  }

  close() {
    this.ui?.close();
    this.closed();
  }

  // Standing up from the table (panel closed, or walked away).
  private closed() {
    this.ui = null;
    this.body = null;
    this.view?.destroy();
    this.view = null;
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
        if (this.spot === spot && this.screen === 'quickdraw' && !this.running(spot)) this.render();
      },
      onTakeover: (s) => {
        if (s.game !== 'quickdraw' || this.spot !== spot) return;
        this.host = new QuickDrawHost(t!, (players, winners, score, seed) => this.deps.record('quickdraw', spot, players, winners, score, seed));
        void this.host.takeover(s);
      },
    });
    this.tables.set(spot, t);
    return t;
  }

  private running(spot: SpotId) {
    const s = this.tables.get(spot)?.snap;
    return !!s && s.game === 'quickdraw' && (s.state as QDState).phase === 'round';
  }

  private snapshot(spot: SpotId, s: Snapshot) {
    if (spot !== this.spot) return;
    const t = this.tables.get(spot)!;
    // Someone else started a new game: we're not the host any more.
    if (this.host && !t.isHost) {
      this.host.stop();
      this.host = null;
    }
    if (s.game !== 'quickdraw') return;
    if (this.screen !== 'quickdraw') this.show('quickdraw');
    else if (this.view) this.view.show(s);
    else this.render();
  }

  private show(screen: Games['screen']) {
    this.screen = screen;
    this.render();
  }

  private render() {
    const body = this.body;
    const spot = this.spot;
    if (!body || !spot) return;
    if (this.screen !== 'quickdraw') {
      this.view?.destroy();
      this.view = null;
    }
    body.replaceChildren();
    if (this.screen === 'list') return this.renderList(body, spot);
    if (this.screen === 'dice') body.append(diceView((r) => this.deps.roll(r)));
    if (this.screen === 'rps') this.renderRps(body);
    if (this.screen === 'quickdraw') this.renderQuickDraw(body, spot);
    body.append(this.back());
  }

  private renderList(body: HTMLElement, spot: SpotId) {
    const allowed = this.deps.allowed(spot);
    const grid = el('div', 'v2-games');
    for (const id of ALL_GAMES) {
      const g = GAMES[id];
      const off = !g.soon && allowed !== null && !allowed.includes(id);
      const b = el('button', 'v2-game' + (g.soon || off ? ' soon' : ''));
      b.type = 'button';
      b.dataset.game = id;
      b.disabled = !!g.soon || off;
      const gi = el('span', 'gi');
      gi.append(icon(g.icon));
      b.append(gi, el('b', '', g.title), el('span', '', off ? 'Off in this room' : g.sub));
      if (!b.disabled) b.addEventListener('click', () => this.show(id as Games['screen']));
      grid.append(b);
    }
    const at = this.tables.get(spot)?.people.length ?? 0;
    body.append(grid, el('p', 'v2-note', at > 1 ? `${at} people at this table.` : 'Games are quick and you stay in voice while you play.'));
  }

  private renderRps(body: HTMLElement) {
    const people = this.deps.nearby();
    body.append(el('p', 'v2-note', people.length ? 'Pick someone to challenge. Best of three.' : 'Nobody here yet. You can also tap a friend anywhere and pick Duel.'));
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

  private renderQuickDraw(body: HTMLElement, spot: SpotId) {
    const t = this.table(spot);
    const s = t.snap;
    if (s && s.game === 'quickdraw' && ((s.state as QDState).phase === 'round' || this.view)) {
      if (!this.view) {
        this.view = new QuickDrawView(t.id, (a) => t.act(a), (id) => this.deps.names(id));
      }
      body.append(this.view.root);
      this.view.show(s);
      if ((s.state as QDState).phase === 'done') body.append(this.startButton(t, 'Play again'));
      return;
    }
    // Lobby: everyone at the table plays.
    const people = t.people.length ? t.people : [t.seat()];
    body.append(el('p', 'v2-note', 'Everyone at this table plays. 5 rounds; fastest three each round get 3, 2 and 1 points.'));
    const list = el('div', 'v2-list');
    list.id = 'qd-lobby';
    for (const p of people) {
      const row = el('div', 'v2-item');
      row.append(portrait(this.deps.names(p.id).character ?? p.character, 32), el('span', 't', p.id === t.id ? 'You' : p.name));
      list.append(row);
    }
    body.append(list, this.startButton(t, people.length < 2 ? 'Waiting for someone to join…' : `Start with ${people.length} players`, people.length < 2));
  }

  private startButton(t: GameTable, label: string, disabled = false) {
    const b = el('button', 'dh-btn');
    b.type = 'button';
    b.id = 'qd-start';
    b.disabled = disabled;
    b.append(icon('zap'), document.createTextNode(label));
    b.addEventListener('click', () => {
      const players = t.people.length >= 2 ? t.people : null;
      if (!players) return;
      this.view?.destroy();
      this.view = null;
      this.host?.stop();
      const spot = t.spot;
      this.host = new QuickDrawHost(t, (pl, winners, score, seed) => this.deps.record('quickdraw', spot, pl, winners, score, seed));
      void this.host.start(players);
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
