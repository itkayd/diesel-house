import type { Section } from '../main';
import { api, btn, card, h, n, sectionHead, skeleton } from '../kit';

type Overview = {
  members: number; guests_now: number; banned: number; active_today: number; logs_open: number; logs_24h: number; reports_open: number;
  games_week: number; arcade_week: number; arcade_record: number | null; rejected_week?: number; xp_today: number; catches_today: number;
  chat_today: number; player_reports_open?: number; friendships?: number; logs_by_day: { day: string; n: number }[];
};

// The house at a glance: who's around, what needs a look (problems, reports, rejected scores), activity.
export const dashboard: Section = {
  id: 'dashboard',
  label: 'Dashboard',
  icon: 'dashboard',
  async render(main, go) {
    main.append(sectionHead('Dashboard', 'The house at a glance. Tap a number to go to it.', btn('Refresh', () => go('dashboard'), { icon: 'refresh', kind: 'ghost', small: true })), skeleton(2));
    const o = await api<Overview>('overview');
    main.lastElementChild?.remove();
    const tile = (label: string, value: unknown, to?: string, tone = '') =>
      to ? h('button', { type: 'button', class: `adm-tile ${tone}`, onclick: () => go(to) }, h('b', {}, n(value)), h('span', {}, label)) : h('div', { class: `adm-tile ${tone}` }, h('b', {}, n(value)), h('span', {}, label));

    const needs = [
      o.player_reports_open ? tile('player reports to look at', o.player_reports_open, 'reports', 'bad') : null,
      o.reports_open ? tile('problem reports from players', o.reports_open, 'logs', 'bad') : null,
      o.logs_open ? tile('open device logs', o.logs_open, 'logs', 'warn') : null,
      o.rejected_week ? tile('Night Raid runs rejected this week', o.rejected_week, 'scores', 'bad') : null,
    ].filter(Boolean) as HTMLElement[];

    main.append(
      needs.length ? card('Needs a look', 'warn', h('div', { class: 'adm-tiles' }, ...needs)) : card('All clear', 'circle-check', h('p', { class: 'adm-hint' }, 'No open player reports, problem reports, device logs or rejected scores.')),
      card(
        'People',
        'users',
        h('div', { class: 'adm-tiles' }, tile('members', o.members, 'players'), tile('in the house today', o.active_today, 'players', 'good'), tile('guests visiting now', o.guests_now, 'invites'), tile('banned', o.banned, 'players', o.banned ? 'bad' : ''), tile('friendships', o.friendships ?? 0)),
      ),
      card(
        'Activity',
        'activity',
        h(
          'div',
          { class: 'adm-tiles' },
          tile('XP earned today', o.xp_today),
          tile('critters caught today', o.catches_today, 'critters'),
          tile('chat messages today', o.chat_today),
          tile('table games this week', o.games_week, 'scores'),
          tile('Night Raid scores this week', o.arcade_week, 'scores'),
          tile('Night Raid house record', o.arcade_record ?? 0, 'scores', 'good'),
        ),
      ),
      logChart(o.logs_by_day, o.logs_24h, () => go('logs')),
    );
  },
};

// Device logs a day for the last 14 days.
function logChart(rows: Overview['logs_by_day'], last24: number, open: () => void) {
  const days: { day: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day: d, n: rows.find((r) => r.day === d)?.n ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return card(
    'Device logs, last 14 days',
    'phone',
    h('p', { class: 'adm-hint' }, `${n(last24)} in the last 24 hours. Crashes, things the game fixed by itself, features that failed, and players’ own reports.`),
    h('div', { class: 'adm-bars', role: 'img', 'aria-label': days.map((d) => `${fmt(d.day)}: ${d.n}`).join(', ') }, ...days.map((d) => h('div', { style: `height:${Math.round((d.n / max) * 100)}%`, title: `${fmt(d.day)}: ${d.n}` }))),
    h('div', { class: 'adm-bars-x' }, h('span', {}, fmt(days[0].day)), h('span', {}, 'today')),
    h('div', {}, btn('Open device logs', open, { icon: 'bug', small: true })),
  );
}
