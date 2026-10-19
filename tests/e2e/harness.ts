// Offline harness for the table games (tests/e2e/table-games-local.mjs): each player gets a column with
// the game's real screen, and the hosts and screens talk through FakeTable instead of Supabase.
import '@fontsource/pixelify-sans';
import '@fontsource/atkinson-hyperlegible';
import '../../src/ui/theme.css';
import { FourHost, FourView } from '../../src/games/fourInARow';
import { HigherLowerHost, HigherLowerView } from '../../src/games/higherLower';
import { HotTakesHost, HotTakesView } from '../../src/games/hotTakes';
import { LetterRushHost, LetterRushView } from '../../src/games/letterRush';
import { LiarsDiceHost, LiarsDiceView } from '../../src/games/liarsDice';
import { QuizHost, QuizView } from '../../src/games/quiz';
import { SketchHost, SketchView } from '../../src/games/sketch';
import type { Snapshot, TableHost, TableView } from '../../src/games/table';
import { FakeChannel, FakeTable } from './fakeTable';

type Game = 'higherlower' | 'wyr' | 'four' | 'quiz' | 'sketch' | 'liars' | 'letters';
const records: { game: Game; players: string[]; winners: string[]; score: unknown; seed?: string }[] = [];
const names = new Map<string, { name: string; character: number }>();

function makeHost(game: Game, t: FakeTable, prompts: string[]): TableHost {
  const record = (players: string[], winners: string[], score: unknown, seed?: string) => records.push({ game, players, winners, score, seed });
  if (game === 'higherlower') return new HigherLowerHost(t, record);
  if (game === 'wyr') return new HotTakesHost(t, record, () => prompts);
  if (game === 'quiz') return new QuizHost(t, record);
  if (game === 'sketch') return new SketchHost(t, record);
  if (game === 'liars') return new LiarsDiceHost(t, record);
  if (game === 'letters') return new LetterRushHost(t, record);
  return new FourHost(t, record);
}
function makeView(game: Game, t: FakeTable): TableView {
  const n = (id: string) => names.get(id) ?? { name: '', character: 0 };
  if (game === 'higherlower') return new HigherLowerView(t.id, (a) => t.act(a), n);
  if (game === 'wyr') return new HotTakesView(t.id, (a) => t.act(a), n);
  if (game === 'quiz') return new QuizView(t.id, (a) => t.act(a), n);
  if (game === 'sketch') return new SketchView(t.id, (a) => t.act(a), n);
  if (game === 'liars') return new LiarsDiceView(t.id, (a) => t.act(a), n);
  if (game === 'letters') return new LetterRushView(t.id, (a) => t.act(a), n);
  return new FourView(t.id, (a) => t.act(a), n);
}

const ch = new FakeChannel();
const tables = new Map<string, FakeTable>();
const views = new Map<string, TableView>();

// A player sits down: a column with their screen.
function join(id: string, name: string, game: Game, prompts: string[] = []) {
  names.set(id, { name, character: 0 });
  const t = new FakeTable(ch, { id, name, character: 0 });
  const col = document.createElement('div');
  col.className = 'player dh-panel';
  col.id = `p-${id}`;
  const h = document.createElement('h3');
  h.textContent = name;
  col.append(h);
  document.getElementById('players')!.append(col);
  let view: TableView | null = null;
  t.onSnapshot = (s: Snapshot) => {
    if (!view) {
      view = makeView(game, t);
      views.set(id, view);
      col.append(view.root);
    }
    view.show(s);
  };
  t.onTakeover = (s) => {
    t.host = makeHost(game, t, prompts);
    void t.host.takeover(s);
  };
  tables.set(id, t);
  return t;
}

function start(id: string, game: Game, playerIds: string[], prompts: string[] = []) {
  const t = tables.get(id)!;
  t.host = makeHost(game, t, prompts);
  const seats = playerIds.map((p) => tables.get(p)!.seat());
  void t.host.start(seats);
}

function leave(id: string) {
  tables.get(id)?.leave();
  tables.delete(id);
  document.getElementById(`p-${id}`)?.remove();
}

Object.assign(window, { harness: { join, start, leave, records, ch, tables, views } });
