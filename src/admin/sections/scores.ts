import type { Section } from '../main';
import { refreshCounts } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, empty, h, n, sectionHead, skeleton } from '../kit';

type Arcade = { id: number; user_id: string; name: string | null; score: number; waves: number; duration_ms: number; xp: number; created_at: string };
type Game = { id: number; game: string; spot: string; created_at: string; players: number; winners: string | null };
type Flags = {
  rejected: { id: string; name: string | null; claimed: number; score: number; waves: number; ticks: number; real_ms: number; reason: string; finished_at: string }[];
  flagged: { id: string; name: string | null; score: number; waves: number; ticks: number; real_ms: number; flags: Record<string, string>; finished_at: string }[];
  runs_week: number; verified_week: number; rejected_week: number;
};

const secs = (ticks: number) => `${Math.floor(ticks / 3600)}:${String(Math.floor((ticks / 60) % 60)).padStart(2, '0')}`;

// Night Raid: every saved score was proven by replaying the run on the server. Here: runs that were
// rejected ("not possible"), big jumps worth a look, the latest scores (removable), and table games.
export const scores: Section = {
  id: 'scores',
  label: 'Games & scores',
  icon: 'trophy',
  async render(main, go) {
    main.append(sectionHead('Games & scores', 'Night Raid scores have no limit. Each run is played again on the server, and only a score a real game produced is saved.'), skeleton(3));
    const [f, s] = await Promise.all([api<Flags>('score-flags'), api<{ arcade: Arcade[]; games: Game[] }>('scores')]);
    main.lastElementChild?.remove();

    const rejected = f.rejected.map((r) =>
      h(
        'div',
        { class: 'adm-row' },
        h('span', { class: 'adm-avatar', style: 'color:var(--error)' }, '!'),
        h('span', { class: 'adm-row-main' }, h('b', {}, `${r.name ?? 'Someone'} claimed ${n(r.claimed)}`), h('small', {}, `Not possible: ${r.reason}. ${ago(r.finished_at)}.`)),
        h('span', { class: 'adm-row-side' }, badge('Rejected', 'bad')),
      ),
    );
    const flagged = f.flagged.map((r) =>
      h(
        'div',
        { class: 'adm-row' },
        h('span', { class: 'adm-avatar' }, '★'),
        h('span', { class: 'adm-row-main' }, h('b', {}, `${r.name ?? 'Someone'}: ${n(r.score)}`), h('small', {}, `${Object.values(r.flags ?? {}).join(' · ')} · ${secs(r.ticks)} of play, replay checked · ${ago(r.finished_at)}`)),
        h('span', { class: 'adm-row-side' }, badge('Proven', 'ok')),
      ),
    );

    const arcadeRows = s.arcade.map((a) => {
      const del = btn('Remove', async () => {
        if (!(await confirmBox(`Remove ${a.name ?? 'this'}’s ${n(a.score)}?`, a.xp ? `It comes off the board and the ${a.xp} XP it paid is taken back.` : 'It comes off the board.', { ok: 'Remove', danger: true }))) return;
        if (await act(null, () => api('score-delete', { id: a.id }), 'Score removed.')) go('scores');
      }, { kind: 'ghost', small: true });
      return h(
        'tr',
        {},
        h('td', { 'data-label': 'Player' }, a.name ?? '?'),
        h('td', { 'data-label': 'Score', class: 'num' }, h('b', {}, n(a.score))),
        h('td', { 'data-label': 'Wave', class: 'num' }, a.waves + 1),
        h('td', { 'data-label': 'Time', class: 'num' }, secs(Math.round((a.duration_ms / 1000) * 60))),
        h('td', { 'data-label': 'XP', class: 'num' }, a.xp ? `+${a.xp}` : '—'),
        h('td', { 'data-label': 'When' }, ago(a.created_at)),
        h('td', {}, del),
      );
    });
    const gameRows = s.games.map((g) =>
      h('tr', {}, h('td', { 'data-label': 'Game' }, g.game), h('td', { 'data-label': 'Where' }, g.spot), h('td', { 'data-label': 'Players', class: 'num' }, g.players), h('td', { 'data-label': 'Won' }, g.winners ?? '—'), h('td', { 'data-label': 'When' }, ago(g.created_at))),
    );

    main.append(
      h(
        'div',
        { class: 'adm-tiles' },
        h('div', { class: 'adm-tile' }, h('b', {}, n(f.runs_week)), h('span', {}, 'Night Raid runs this week')),
        h('div', { class: 'adm-tile good' }, h('b', {}, n(f.verified_week)), h('span', {}, 'proven and saved')),
        h('div', { class: `adm-tile ${f.rejected_week ? 'bad' : ''}` }, h('b', {}, n(f.rejected_week)), h('span', {}, 'rejected (not possible)')),
      ),
      card(
        'Rejected runs',
        'alert',
        h('p', { class: 'adm-hint' }, 'The server played these runs again and got a different result, or they went faster than real time: a changed game or a made-up score. Nothing was saved. Repeated ones from the same person are worth a word (or a ban in Players).'),
        rejected.length ? h('div', { class: 'adm-list', id: 'runs-rejected' }, ...rejected) : empty('shield', 'None. Every score sent so far checked out.'),
      ),
      ...(flagged.length ? [card('Big jumps (proven)', 'sparkles', h('p', { class: 'adm-hint' }, 'Real runs, replayed and checked, that beat the house record by a lot. Just so you know.'), h('div', { class: 'adm-list' }, ...flagged))] : []),
      card(
        'Latest Night Raid scores',
        'trophy',
        arcadeRows.length
          ? h('table', { class: 'adm-table', id: 'arcade-scores' }, h('thead', {}, h('tr', {}, ...['Player', 'Score', 'Wave', 'Time', 'XP', 'When', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...arcadeRows))
          : empty('trophy', 'No scores yet.'),
      ),
      card(
        'Table games',
        'games',
        gameRows.length
          ? h('table', { class: 'adm-table' }, h('thead', {}, h('tr', {}, ...['Game', 'Where', 'Players', 'Won', 'When'].map((t) => h('th', {}, t)))), h('tbody', {}, ...gameRows))
          : empty('games', 'No games played yet.'),
      ),
    );
    void refreshCounts();
  },
};
