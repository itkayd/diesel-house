import type { Section } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, empty, field, h, icon, input, sectionHead, skeleton, toast, when } from '../kit';

type Entry = { at: string; username: string | null; action: string; target: string | null; detail: Record<string, unknown> | null };
type Account = { id: string; username: string; created_at: string; last_login_at: string | null; disabled: boolean; me: boolean };

// Who changed what (every admin change is logged), the admin accounts, and your password.
export const audit: Section = {
  id: 'audit',
  label: 'Admins & audit',
  icon: 'shield',
  async render(main, go) {
    main.append(sectionHead('Admins & audit', 'Every change made here is written down with who made it. Admins sign in with their own username and password.'), skeleton(3));
    const [entries, accounts, members] = await Promise.all([api<Entry[]>('audit'), api<Account[]>('accounts'), api<{ id: string; name: string | null }[]>('members').catch(() => [])]);
    const names = new Map(members.map((m) => [m.id, m.name ?? 'a player']));
    main.lastElementChild?.remove();

    // Admin accounts.
    const accRows = accounts.map((a) =>
      h(
        'div',
        { class: 'adm-row' },
        h('span', { class: 'adm-avatar' }, a.username[0].toUpperCase()),
        h('span', { class: 'adm-row-main' }, h('b', {}, a.username), h('small', {}, `Last signed in ${ago(a.last_login_at)} · made ${when(a.created_at)}`)),
        h(
          'span',
          { class: 'adm-row-side' },
          a.me ? badge('You', 'ok') : a.disabled ? badge('Switched off', 'bad') : null,
          a.me ? null : btn(a.disabled ? 'Switch on' : 'Switch off', async () => {
            if (!a.disabled && !(await confirmBox(`Switch off ${a.username}?`, 'They’re signed out everywhere and can’t sign in until you switch them back on.', { ok: 'Switch off', danger: true }))) return;
            if (await act(null, () => api('account-disable', { account: a.id, off: !a.disabled }), a.disabled ? 'Switched on.' : 'Switched off.')) go('audit');
          }, { kind: 'ghost', small: true }),
        ),
      ),
    );
    const newUser = input({ placeholder: 'username', autocapitalize: 'none', autocomplete: 'off', maxlength: 32, id: 'admin-new-user', 'aria-label': 'New admin username' });
    const newPass = input({ type: 'password', placeholder: '12+ characters', autocomplete: 'new-password', id: 'admin-new-pass', 'aria-label': 'New admin password' });
    const add = btn('Add admin', () => {
      void act(null, async () => {
        await api('account-add', { username: newUser.value.trim(), password: newPass.value });
        go('audit');
      }, `${newUser.value.trim()} can sign in now.`);
    }, { icon: 'user-plus', small: true, id: 'admin-add' });

    // Your password.
    const oldPw = input({ type: 'password', autocomplete: 'current-password', id: 'pw-old', 'aria-label': 'Current password' });
    const newPw = input({ type: 'password', autocomplete: 'new-password', minlength: 12, id: 'pw-new', 'aria-label': 'New password' });
    const change = btn('Change my password', () => {
      if (newPw.value.length < 12) return toast('The new password needs at least 12 characters.', true);
      void act(null, async () => {
        await api('change-password', { old: oldPw.value, password: newPw.value });
        oldPw.value = newPw.value = '';
      }, 'Password changed. Any other device signed in as you was signed out.');
    }, { icon: 'key', small: true, id: 'pw-go' });

    const rows = entries.map((e) =>
      h(
        'tr',
        {},
        h('td', { 'data-label': 'When' }, h('span', { title: when(e.at) }, ago(e.at))),
        h('td', { 'data-label': 'Who' }, e.username ?? '—'),
        h('td', { 'data-label': 'Did' }, h('b', {}, e.action)),
        h('td', { 'data-label': 'To' }, e.target ? (names.get(e.target) ?? h('code', {}, e.target.length > 24 ? `${e.target.slice(0, 8)}…` : e.target)) : '—'),
        h('td', { 'data-label': 'Details' }, e.detail ? h('small', { class: 'adm-hint' }, summary(e.detail)) : ''),
      ),
    );

    main.append(
      h(
        'div',
        { class: 'adm-grid' },
        card('Admin accounts', 'users', h('div', { class: 'adm-list', id: 'admin-accounts' }, ...accRows), field('New admin', h('div', { class: 'adm-inline' }, newUser, newPass)), h('div', {}, add)),
        card('Your password', 'key', field('Current password', oldPw), field('New password', newPw, 'At least 12 characters.'), h('div', {}, change)),
      ),
      card(
        'Audit log',
        'scroll',
        rows.length
          ? h('table', { class: 'adm-table', id: 'audit-table' }, h('thead', {}, h('tr', {}, ...['When', 'Who', 'Did', 'To', 'Details'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows))
          : empty('scroll', 'Nothing yet.'),
      ),
      h('p', { class: 'adm-hint' }, icon('info'), ' Sign-ins lock for 15 minutes after 5 wrong passwords. Sessions last 8 hours.'),
    );
  },
};

const summary = (d: Record<string, unknown>) =>
  Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 160);
