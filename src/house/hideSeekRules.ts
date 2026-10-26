// Hide and seek, the referee (host) side: pure rules, no screen. Whoever starts a round is the host; their
// game keeps the state and sends it to everyone on the house channel when it changes (never per frame).
// Players send their moves (join, hide, search, tag…) to the host, who checks them.

export type HsPhase = 'lobby' | 'hide' | 'seek' | 'end';
export type HsPlayer = { id: string; name: string };
export type HsLast = { k: 'found' | 'empty' | 'tagged'; spot?: string; id?: string; at: number };
export type HsState = {
  round: string;
  host: string;
  phase: HsPhase;
  left: number; // ms left in this phase when the state was sent
  seeker: string | null;
  players: HsPlayer[];
  hidden: Record<string, string>; // hider id -> hide spot id
  found: string[]; // in the order they were found
  winners: string[];
  last: HsLast | null; // the latest find (or empty search), for the sounds and the line on screen
};
export type HsAct =
  | { t: 'join'; name: string }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'hide'; spot: string }
  | { t: 'unhide' }
  | { t: 'search'; spot: string }
  | { t: 'tag'; id: string }
  | { t: 'stop' };
export type HsMsg = { k: 'snap'; v: number; s: HsState | null } | { k: 'act'; from: string; a: HsAct } | { k: 'hello'; from: string };

export const HS = {
  lobbyMs: 30_000, // the lobby closes after this (starts with 2+, else called off)
  hideMs: 30_000, // the seeker counts while everyone hides
  seekMs: 150_000, // then the seeker has this long
  endMs: 10_000, // the results stay up this long
  maxPlayers: 12,
  tagRange: 20, // world px: walk this close to someone not hidden and they're found
  hostSlack: 3, // the host allows this much more (positions arrive a little late)
  spotRange: 18, // world px from a piece of furniture's footprint to hide in it or search it
  torch: 76, // world px the seeker can see in the dark
  rustleFrom: 45_000, // in the last 45 s, hiding places rustle now and then
};

export const hiders = (s: HsState) => s.players.filter((p) => p.id !== s.seeker);
export const stillHiding = (s: HsState) => hiders(s).filter((p) => !s.found.includes(p.id));

// What the host does. `pos(id)` is where the host last saw someone (world px), for checking a tag.
export class HsHost {
  s: HsState;
  private deadline: number;
  constructor(
    me: HsPlayer,
    private send: (s: HsState | null) => void,
    private pos: (id: string) => { x: number; y: number } | null,
    private spots: (id: string) => { x: number; y: number; w: number; h: number } | null,
    private onEnd: (s: HsState) => void,
    private now = () => Date.now(),
    private rand = Math.random,
  ) {
    this.deadline = this.now() + HS.lobbyMs;
    this.s = { round: `${me.id.slice(0, 8)}-${this.now().toString(36)}`, host: me.id, phase: 'lobby', left: HS.lobbyMs, seeker: null, players: [me], hidden: {}, found: [], winners: [], last: null };
  }

  get leftMs() {
    return Math.max(0, this.deadline - this.now());
  }
  private publish() {
    this.s = { ...this.s, left: this.leftMs };
    this.send(this.s);
  }
  private phase(p: HsPhase, ms: number) {
    this.s = { ...this.s, phase: p };
    this.deadline = this.now() + ms;
  }

  // Called a few times a second: moves on when time is up.
  tick() {
    if (this.leftMs > 0) return;
    const s = this.s;
    if (s.phase === 'lobby') {
      if (s.players.length >= 2) return this.begin();
      this.send(null); // nobody else joined: called off
      this.s = { ...s, phase: 'end', winners: [] };
      this.deadline = Infinity;
    } else if (s.phase === 'hide') {
      this.phase('seek', HS.seekMs);
      this.publish();
    } else if (s.phase === 'seek') this.finish(stillHiding(s).map((p) => p.id));
    else if (s.phase === 'end') {
      this.deadline = Infinity;
      this.send(null);
    }
  }

  begin() {
    const s = this.s;
    if (s.phase !== 'lobby' || s.players.length < 2) return false;
    const seeker = s.players[Math.floor(this.rand() * s.players.length)].id;
    this.s = { ...s, seeker, hidden: {}, found: [], last: null };
    this.phase('hide', HS.hideMs);
    this.publish();
    return true;
  }

  private finish(winners: string[]) {
    this.s = { ...this.s, winners, hidden: {} };
    this.phase('end', HS.endMs);
    this.publish();
    this.onEnd(this.s);
  }

  // Someone left the house.
  gone(id: string) {
    const s = this.s;
    if (!s.players.some((p) => p.id === id) || s.phase === 'end') return;
    if (id === s.seeker && s.phase !== 'lobby') return this.finish([]); // no seeker, no game
    const hidden = { ...s.hidden };
    delete hidden[id];
    this.s = { ...s, players: s.players.filter((p) => p.id !== id), hidden };
    if (s.phase !== 'lobby' && !stillHiding(this.s).length) return this.finish(s.seeker ? [s.seeker] : []);
    this.publish();
  }

  act(from: string, a: HsAct) {
    const s = this.s;
    const playing = s.players.some((p) => p.id === from);
    const hider = playing && from !== s.seeker && !s.found.includes(from);
    switch (a.t) {
      case 'join':
        if (s.phase !== 'lobby' || playing || s.players.length >= HS.maxPlayers) return;
        this.s = { ...s, players: [...s.players, { id: from, name: String(a.name ?? '').slice(0, 24) || 'Someone' }] };
        return this.publish();
      case 'leave':
        if (s.phase === 'lobby' && playing && from !== s.host) {
          this.s = { ...s, players: s.players.filter((p) => p.id !== from) };
          this.publish();
        } else if (playing && s.phase !== 'lobby') this.gone(from);
        return;
      case 'start':
        if (from === s.host) this.begin();
        return;
      case 'stop':
        if (from !== s.host) return;
        if (s.phase === 'lobby') {
          this.deadline = Infinity;
          this.s = { ...s, phase: 'end' };
          return this.send(null);
        }
        return this.finish([]);
      case 'hide': {
        if (!hider || (s.phase !== 'hide' && s.phase !== 'seek')) return;
        const spot = String(a.spot);
        if (!this.spots(spot) || Object.entries(s.hidden).some(([id, sp]) => sp === spot && id !== from)) return;
        this.s = { ...s, hidden: { ...s.hidden, [from]: spot } };
        return this.publish();
      }
      case 'unhide': {
        if (!(from in s.hidden)) return;
        const hidden = { ...s.hidden };
        delete hidden[from];
        this.s = { ...s, hidden };
        return this.publish();
      }
      case 'search': {
        if (from !== s.seeker || s.phase !== 'seek') return;
        const spot = String(a.spot);
        const who = Object.entries(s.hidden).find(([, sp]) => sp === spot)?.[0];
        if (!who) {
          this.s = { ...s, last: { k: 'empty', spot, at: this.now() } };
          return this.publish();
        }
        return this.found(who, { k: 'found', spot, id: who, at: this.now() });
      }
      case 'tag': {
        if (from !== s.seeker || s.phase !== 'seek') return;
        const id = String(a.id);
        if (id === s.seeker || !s.players.some((p) => p.id === id) || s.found.includes(id) || id in s.hidden) return;
        const a1 = this.pos(from);
        const b1 = this.pos(id);
        if (a1 && b1 && Math.hypot(a1.x - b1.x, a1.y - b1.y) > HS.tagRange * HS.hostSlack) return;
        return this.found(id, { k: 'tagged', id, at: this.now() });
      }
    }
  }

  private found(id: string, last: HsLast) {
    const hidden = { ...this.s.hidden };
    delete hidden[id];
    this.s = { ...this.s, hidden, found: [...this.s.found, id], last };
    if (!stillHiding(this.s).length) return this.finish(this.s.seeker ? [this.s.seeker] : []);
    this.publish();
  }
}

// Is a point (feet, world px) close enough to a piece of furniture to hide in it or search it?
export function nearSpot(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }, range = HS.spotRange) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy) <= range;
}

// Check a state that arrived over the network before using it.
export function validState(x: unknown): x is HsState {
  const s = x as HsState;
  return (
    !!s &&
    typeof s.round === 'string' &&
    typeof s.host === 'string' &&
    ['lobby', 'hide', 'seek', 'end'].includes(s.phase) &&
    typeof s.left === 'number' &&
    Array.isArray(s.players) &&
    s.players.length <= HS.maxPlayers &&
    s.players.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string') &&
    !!s.hidden &&
    typeof s.hidden === 'object' &&
    Array.isArray(s.found) &&
    Array.isArray(s.winners)
  );
}
