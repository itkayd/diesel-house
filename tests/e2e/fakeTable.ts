// A stand-in for src/games/table.ts GameTable with no Supabase: several players' tables in one page,
// joined by an in-memory "channel" that delivers broadcasts a moment later (like Realtime, never to the
// sender). Same rules as GameTable: newer snapshots win, moves go to the host, and when the host leaves
// the player who sat down first takes over. Used by tests/e2e/table-games-local.mjs to play the Phase 13
// games end to end in a browser. Counts sent messages like msgStats does.
import type { Seat, Snapshot, TableHost } from '../../src/games/table';

type Msg = { event: 'snap' | 'act'; payload: unknown; from: string };

export class FakeChannel {
  tables = new Map<string, FakeTable>();
  sent = 0;
  delay = 15;

  broadcast(m: Msg) {
    this.sent++;
    for (const t of [...this.tables.values()]) if (t.id !== m.from) setTimeout(() => t.receive(m), this.delay);
  }

  // Presence changed: everyone re-syncs (and maybe takes over).
  sync() {
    for (const t of [...this.tables.values()]) setTimeout(() => t.sync(), this.delay);
  }
}

export class FakeTable {
  readonly spot = 'room_06' as const;
  snap: Snapshot | null = null;
  host: TableHost | null = null;
  onSnapshot: (s: Snapshot) => void = () => {};
  onTakeover: (s: Snapshot) => void = () => {};
  private at: number;

  constructor(
    private ch: FakeChannel,
    private me: { id: string; name: string; character: number },
  ) {
    this.at = Date.now() + ch.tables.size;
    ch.tables.set(me.id, this);
    ch.sync();
  }

  get id() {
    return this.me.id;
  }
  get isHost() {
    return this.snap?.host === this.me.id;
  }
  get people(): Seat[] {
    return [...this.ch.tables.values()].map((t) => t.seat()).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }
  seat(): Seat {
    return { ...this.me, at: this.at };
  }

  start<S>(game: string, players: Seat[], state: S) {
    this.publish({ v: (this.snap?.v ?? 0) + 1, host: this.me.id, game, players, state });
  }
  update<S>(change: Partial<Pick<Snapshot<S>, 'players' | 'state'>>) {
    if (!this.snap || !this.isHost) return;
    this.publish({ ...this.snap, ...change, v: this.snap.v + 1 });
  }
  act(a: unknown) {
    if (this.isHost) this.host?.onAction(this.me.id, a);
    else this.ch.broadcast({ event: 'act', payload: { from: this.me.id, a }, from: this.me.id });
  }

  leave() {
    this.host?.stop();
    this.ch.tables.delete(this.me.id);
    this.ch.sync();
  }

  receive(m: Msg) {
    if (!this.ch.tables.has(this.me.id)) return;
    if (m.event === 'snap') {
      const s = m.payload as Snapshot;
      if (this.snap && s.v <= this.snap.v && s.host === this.snap.host) return;
      this.snap = s;
      if (!this.isHost && this.host) {
        this.host.stop();
        this.host = null;
      }
      this.onSnapshot(s);
    } else if (this.isHost) {
      const { from, a } = m.payload as { from: string; a: unknown };
      this.host?.onAction(from, a);
    }
  }

  sync() {
    if (!this.ch.tables.has(this.me.id)) return;
    this.host?.onPeople();
    const s = this.snap;
    if (!s || this.ch.tables.has(s.host)) return;
    const next = s.players.filter((p) => this.ch.tables.has(p.id)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
    if (next?.id !== this.me.id) return;
    this.snap = { ...s, host: this.me.id, v: s.v + 1 };
    this.ch.broadcast({ event: 'snap', payload: this.snap, from: this.me.id });
    this.onTakeover(this.snap);
  }

  private publish(s: Snapshot) {
    this.snap = s;
    this.ch.broadcast({ event: 'snap', payload: s, from: this.me.id });
    this.onSnapshot(s);
  }
}
