import type { Section } from '../main';
import { refreshCounts } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, empty, h, icon, input, n, sectionHead, skeleton, toast, when } from '../kit';

type Log = {
  id: number; at: string; kind: 'error' | 'warning' | 'problem' | 'report'; message: string; stack: string | null; page: string | null; agent: string | null;
  build: string | null; resolved_at: string | null; note: string | null; user_id: string | null; name: string | null;
  context: { device?: Record<string, unknown>; game?: Record<string, unknown>; extra?: Record<string, unknown> | null; trail?: { t: number; what: string; info?: string }[] } | null;
};
const KINDS: [Log['kind'] | 'all', string][] = [['all', 'All'], ['report', 'Reports'], ['error', 'Crashes'], ['problem', 'Problems'], ['warning', 'Warnings']];
const TONE = { error: 'bad', report: 'info', problem: 'warn', warning: '' } as const;
const WHAT = { error: 'Crash', report: 'Player report', problem: 'Feature failed', warning: 'Fixed itself' } as const;

// Device logs (src/net/errors.ts): what went wrong on people's phones, grouped by message, with the device,
// what the game was doing, and the last 40 steps before it happened.
export const logs: Section = {
  id: 'logs',
  label: 'Device logs',
  icon: 'bug',
  async render(main) {
    let kind: Log['kind'] | 'all' = 'all';
    let openOnly = true;
    const chips = h('div', { class: 'adm-chips', id: 'log-kinds' });
    for (const [k, label] of KINDS) {
      chips.append(h('button', { type: 'button', class: 'adm-chip', 'data-k': k, 'aria-pressed': String(k === kind), onclick: () => ((kind = k), void draw()) }, label));
    }
    const openBtn = h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': 'true', id: 'log-open-only', onclick: () => ((openOnly = !openOnly), openBtn.setAttribute('aria-pressed', String(openOnly)), void draw()) }, 'Open only');
    const list = h('div', { class: 'adm-list', id: 'log-list' });
    const clear = btn('Clear resolved older than 30 days', async () => {
      if (!(await confirmBox('Clear old logs?', 'Resolved logs older than 30 days are deleted for good. Open ones are kept.', { ok: 'Clear', danger: true }))) return;
      await act(null, async () => {
        const r = await api<{ deleted: number }>('logs-clear', { days: 30 });
        toast(`${n(r.deleted)} cleared.`);
        await draw();
      });
    }, { kind: 'ghost', small: true });
    main.append(
      sectionHead('Device logs', 'Problems on people’s phones and computers, sent by the game itself, plus “Report a problem” from Settings. Open one to see the device and the steps that led to it.'),
      h('div', { class: 'adm-inline' }, chips, openBtn),
      list,
      h('div', {}, clear),
    );

    async function draw() {
      for (const c of chips.children) c.setAttribute('aria-pressed', String((c as HTMLElement).dataset.k === kind));
      list.replaceChildren(skeleton(4));
      const rows = await api<Log[]>('logs', { kinds: kind === 'all' ? null : [kind], open: openOnly, max: 500 });
      // Same kind + message = one problem, newest first.
      const groups = new Map<string, Log[]>();
      for (const r of rows) {
        const key = `${r.kind}|${r.message}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      const items = [...groups.values()].map(group);
      list.replaceChildren(...(items.length ? items : [empty('circle-check', openOnly ? 'Nothing open. When something goes wrong on a phone, it shows here.' : 'No logs.')]));
      void refreshCounts();
    }

    function group(rows: Log[]) {
      const last = rows[0];
      const people = new Set(rows.map((r) => r.name ?? 'someone'));
      const devices = new Set(rows.map((r) => short(r.agent)));
      const open = rows.filter((r) => !r.resolved_at);
      const note = input({ placeholder: 'Note (optional), e.g. “fixed in the 23 Oct update”', maxlength: 300, 'aria-label': 'Note' });
      const resolve = btn(open.length ? `Mark fixed${rows.length > 1 ? ` (all ${rows.length})` : ''}` : 'Reopen', () =>
        void act(null, async () => {
          await api('logs-resolve', { ids: rows.map((r) => r.id), note: note.value.trim() || null, reopen: !open.length });
          await draw();
        }, open.length ? 'Marked fixed.' : 'Reopened.'), { icon: open.length ? 'check' : 'undo', kind: open.length ? 'gold' : undefined, small: true });
      const copy = btn('Copy for fixing', async () => {
        try {
          await navigator.clipboard.writeText(forFixing(rows));
          toast('Copied. Paste it to Claude to fix.');
        } catch {
          toast('Couldn’t copy.', true);
        }
      }, { icon: 'copy', small: true, kind: 'ghost' });
      return h(
        'details',
        { class: 'adm-log', 'data-log': String(last.id) },
        h(
          'summary',
          {},
          badge(WHAT[last.kind], TONE[last.kind]),
          h('span', {}, h('b', {}, last.message), h('small', {}, `${rows.length > 1 ? `${rows.length} times · ` : ''}${[...people].slice(0, 3).join(', ')}${people.size > 3 ? ` +${people.size - 3}` : ''} · ${[...devices].slice(0, 2).join(', ')} · ${ago(last.at)}`)),
          open.length ? null : badge('Fixed', 'ok'),
        ),
        h(
          'div',
          { class: 'adm-log-body' },
          last.note ? h('p', { class: 'adm-hint' }, `Note: ${last.note}`) : null,
          detail(last),
          rows.length > 1
            ? h('details', {}, h('summary', { class: 'adm-hint' }, `All ${rows.length} times`), h('div', { class: 'adm-list' }, ...rows.map((r) => h('div', { class: 'adm-row' }, icon('phone'), h('span', { class: 'adm-row-main' }, h('b', {}, r.name ?? 'Someone'), h('small', {}, `${short(r.agent)} · ${when(r.at)} · ${r.build ?? ''}`)), h('span', {}, r.resolved_at ? badge('Fixed', 'ok') : null)))))
            : null,
          note,
          h('div', { class: 'adm-inline' }, resolve, copy),
        ),
      );
    }

    await draw();
  },
};

function detail(l: Log) {
  const c = l.context ?? {};
  const kv = (o: Record<string, unknown> | null | undefined) =>
    o && Object.keys(o).length
      ? h('div', { class: 'adm-kv' }, ...Object.entries(o).map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)))))
      : h('p', { class: 'adm-hint' }, '—');
  return h(
    'div',
    { class: 'adm-grid' },
    card('Who and where', 'users', h('div', { class: 'adm-kv' }, ...[['player', l.name ?? '—'], ['when', when(l.at)], ['page', l.page ?? '—'], ['version', l.build ?? '—'], ['browser', short(l.agent)]].map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v))))),
    card('The device', 'phone', kv(c.device)),
    card('In the game', 'house', kv(c.game), c.extra ? kv(c.extra) : null),
    c.trail?.length
      ? card('What happened before (newest last)', 'clock', h('ol', { class: 'adm-trail' }, ...c.trail.map((t) => h('li', {}, h('span', {}, `${t.t.toFixed(1)} s`), h('b', { style: 'font-weight:400' }, `${t.what}${t.info ? ` · ${t.info}` : ''}`)))))
      : null,
    l.stack ? card('Code trace', 'bug', h('pre', { class: 'adm-pre' }, l.stack)) : null,
  );
}

// "iPhone · Chrome 129" from a user agent.
function short(agent: string | null) {
  if (!agent) return 'unknown device';
  const dev = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Mac OS/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : 'computer';
  const b = agent.match(/(CriOS|Chrome|FxiOS|Firefox|EdgiOS|Edg|SamsungBrowser)\/(\d+)/) ?? agent.match(/Version\/(\d+).*(Safari)/);
  const name = b ? ({ CriOS: 'Chrome', FxiOS: 'Firefox', EdgiOS: 'Edge', Edg: 'Edge', SamsungBrowser: 'Samsung' } as Record<string, string>)[b[1]] ?? (b[2] === 'Safari' ? 'Safari' : b[1]) : 'browser';
  const ver = b ? (b[2] === 'Safari' ? b[1] : b[2]) : '';
  return `${dev} · ${name} ${ver}`.trim();
}

// Everything about a problem as text, to paste into a chat with Claude.
function forFixing(rows: Log[]) {
  const l = rows[0];
  return [
    `Diesel House device log: ${WHAT[l.kind]} (${rows.length}×)`,
    `Message: ${l.message}`,
    `Players: ${[...new Set(rows.map((r) => r.name ?? '?'))].join(', ')}`,
    `Devices: ${[...new Set(rows.map((r) => short(r.agent)))].join(', ')}`,
    `Latest: ${l.at} · page ${l.page} · build ${l.build}`,
    `Agent: ${l.agent}`,
    `Context: ${JSON.stringify(l.context, null, 1)}`,
    l.stack ? `Stack:\n${l.stack}` : '',
  ].join('\n');
}
