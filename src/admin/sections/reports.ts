import type { Section } from '../main';
import { refreshCounts } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, empty, h, input, sectionHead, skeleton, when } from '../kit';

type Report = {
  id: number; created_at: string; reason: string; details: string | null; resolved_at: string | null; resolved_by: string | null; note: string | null;
  reporter: string | null; reporter_name: string | null; reported: string | null; reported_name: string | null; reported_total: number; reported_banned: boolean;
  context: { zone?: string | null; their_zone?: string | null; near?: number; their_chat?: { at: string; text: string }[]; at?: string } | null;
};
const REASON: Record<string, [string, 'bad' | 'warn' | 'info' | '']> = {
  harassment: ['Bullying or harassment', 'bad'],
  hate: ['Hate or threats', 'bad'],
  spam: ['Spamming', 'warn'],
  cheating: ['Cheating', 'warn'],
  other: ['Something else', 'info'],
};

// Reports about players from "Report" in the tap-a-friend menu (U4): who, why, their last chat lines, and
// how many reports that person has had. Ban from here, or mark it dealt with.
export const reports: Section = {
  id: 'reports',
  label: 'Player reports',
  icon: 'alert',
  async render(main, go) {
    let open = true;
    const list = h('div', { class: 'adm-list', id: 'report-list' });
    const toggle = h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': 'true', id: 'reports-open-only', onclick: () => ((open = !open), toggle.setAttribute('aria-pressed', String(open)), void draw()) }, 'Open only');
    main.append(sectionHead('Player reports', 'When someone taps a player and chooses Report. The reported person isn’t told. Ban them from here, or mark the report dealt with.'), h('div', { class: 'adm-chips' }, toggle), list);

    async function draw() {
      list.replaceChildren(skeleton(3));
      const rows = await api<Report[]>('reports', { open });
      list.replaceChildren(...(rows.length ? rows.map(item) : [empty('shield', open ? 'No open reports. When someone reports a player, it shows here.' : 'No reports yet.')]));
      void refreshCounts();
    }

    function item(r: Report) {
      const [label, tone] = REASON[r.reason] ?? [r.reason, ''];
      const note = input({ placeholder: 'Note (only admins see it)', maxlength: 300, 'aria-label': 'Note' });
      const chat = r.context?.their_chat ?? [];
      const who = r.reported_name ?? 'Someone';
      return h(
        'details',
        { class: 'adm-log', 'data-report': String(r.id) },
        h(
          'summary',
          {},
          badge(label, tone),
          h('span', {}, h('b', {}, `${who}${r.reported_total > 1 ? ` · ${r.reported_total} reports` : ''}`), h('small', {}, `from ${r.reporter_name ?? 'someone'} · ${ago(r.created_at)}${r.details ? ` · “${r.details.slice(0, 80)}”` : ''}`)),
          r.resolved_at ? badge('Dealt with', 'ok') : r.reported_banned ? badge('Banned', 'bad') : null,
        ),
        h(
          'div',
          { class: 'adm-log-body' },
          r.details ? h('p', {}, `“${r.details}”`) : null,
          h(
            'div',
            { class: 'adm-kv' },
            ...[
              ['when', when(r.created_at)],
              ['reporter was in', r.context?.zone ?? '—'],
              ['they were in', r.context?.their_zone ?? '—'],
              ['how far apart', r.context?.near !== undefined ? `${r.context.near} px` : '—'],
            ].map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v))),
          ),
          chat.length
            ? card(`${who}’s last chat lines`, 'scroll', h('ol', { class: 'adm-trail' }, ...chat.map((c) => h('li', {}, h('span', {}, new Date(c.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })), h('b', { style: 'font-weight:400' }, c.text)))))
            : h('p', { class: 'adm-hint' }, 'No chat lines from them where the reporter was.'),
          r.note ? h('p', { class: 'adm-hint' }, `Note: ${r.note}${r.resolved_by ? ` (${r.resolved_by})` : ''}`) : null,
          note,
          h(
            'div',
            { class: 'adm-inline' },
            btn(r.resolved_at ? 'Reopen' : 'Dealt with', () => void act(null, async () => {
              await api('reports-resolve', { ids: [r.id], note: note.value.trim() || null, reopen: !!r.resolved_at });
              await draw();
            }, r.resolved_at ? 'Reopened.' : 'Marked dealt with.'), { icon: r.resolved_at ? 'undo' : 'check', kind: r.resolved_at ? undefined : 'gold', small: true }),
            r.reported && !r.reported_banned
              ? btn(`Ban ${who}`, async () => {
                  if (!(await confirmBox(`Ban ${who}?`, 'They can’t get into the house until you lift it (Players). Their account is kept.', { ok: 'Ban', danger: true }))) return;
                  await act(null, async () => {
                    await api('ban', { member: r.reported, reason: `report: ${label}` });
                    await api('reports-resolve', { ids: [r.id], note: note.value.trim() || 'banned' });
                    await draw();
                  }, `${who} is banned.`);
                }, { icon: 'ban', kind: 'danger', small: true })
              : null,
            btn('See player', () => go('players'), { icon: 'users', kind: 'ghost', small: true }),
          ),
        ),
      );
    }
    await draw();
  },
};
