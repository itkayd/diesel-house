import type { Section } from '../main';
import { act, ago, api, badge, btn, card, confirmBox, debounce, empty, field, h, icon, iconBtn, initial, input, n, sectionHead, skeleton, toast, when } from '../kit';

type Member = {
  id: string; login: string; name: string | null; character: string | null; pet: string | null; xp: number; level: number; streak: number;
  coins: number; gems: number; joined: string; last_seen: string | null; last_visit: string | null; banned: boolean; ban_reason: string | null; arcade_best: number | null;
};
type History = {
  xp: { amount: number; reason: string; created_at: string }[];
  money: { currency: string; delta: number; balance_after: number; reason: string; created_at: string }[];
  scores: { id: number; score: number; waves: number; duration_ms: number; created_at: string }[];
  logs: { id: number; kind: string; message: string; at: string }[];
};

const SORTS: Record<string, [string, (a: Member, b: Member) => number]> = {
  seen: ['Last seen', (a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? '')],
  level: ['Level', (a, b) => b.xp - a.xp],
  coins: ['Coins', (a, b) => b.coins - a.coins],
  name: ['Name', (a, b) => (a.name ?? '').localeCompare(b.name ?? '')],
};
const PETS = ['cat', 'dog', 'hamster', 'chicken', 'frog', 'fox', 'rabbit', 'owl', 'turtle', 'pig'];

// Every member: progress, coins and gems, bans, passwords. No limits on what an admin can set.
export const players: Section = {
  id: 'players',
  label: 'Players',
  icon: 'users',
  async render(main) {
    const search = input({ type: 'search', placeholder: 'Search by name', 'aria-label': 'Search players', id: 'players-search' });
    const sort = h('select', { class: 'adm-sel', 'aria-label': 'Sort by', id: 'players-sort' }, ...Object.entries(SORTS).map(([k, [label]]) => h('option', { value: k }, `Sort: ${label}`))) as HTMLSelectElement;
    const list = h('div', { class: 'adm-list', id: 'players-list' });
    main.append(
      sectionHead('Players', 'Everyone with a member account. Tap someone to change their level, XP, coins or gems, ban them, or reset their password.'),
      h('div', { class: 'adm-inline' }, h('div', { class: 'adm-search' }, icon('search'), search), sort),
      list,
    );
    list.append(skeleton(4));
    let all = await api<Member[]>('members');
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = all.filter((m) => !q || (m.name ?? '').toLowerCase().includes(q)).sort(SORTS[sort.value][1]);
      list.replaceChildren(...(rows.length ? rows.map((m) => row(m, () => open(m))) : [empty('users', q ? `Nobody called “${search.value}”.` : 'No members yet. Make an invite code to bring someone in.')]));
    };
    const reload = async () => {
      all = await api<Member[]>('members');
      draw();
      return all;
    };
    const open = (m: Member) => playerPanel(m, reload);
    search.addEventListener('input', debounce(draw, 120));
    sort.addEventListener('change', draw);
    draw();
  },
};

function row(m: Member, open: () => void) {
  return h(
    'button',
    { type: 'button', class: 'adm-row', 'data-player': m.id, onclick: open },
    h('span', { class: 'adm-avatar' }, initial(m.name)),
    h('span', { class: 'adm-row-main' }, h('b', {}, m.name ?? '(no name yet)'), h('small', {}, `Level ${n(m.level)} · ${n(m.xp)} XP · seen ${ago(m.last_seen)}`)),
    h(
      'span',
      { class: 'adm-row-side' },
      m.banned ? badge('Banned', 'bad') : null,
      h('span', { class: 'adm-stat' }, h('b', {}, n(m.coins)), h('small', {}, 'coins')),
      h('span', { class: 'adm-stat' }, h('b', {}, n(m.gems)), h('small', {}, 'gems')),
    ),
  );
}

// ---- One player, in a panel over the list ----
function playerPanel(m: Member, reload: () => Promise<Member[]>) {
  const scrim = h('div', { class: 'adm-scrim' });
  const panel = h('div', { class: 'adm-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.name ?? 'Player', id: 'player-panel' });
  const close = () => {
    scrim.remove();
    panel.remove();
    removeEventListener('keydown', key);
  };
  const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.adm-dialog') && close();
  addEventListener('keydown', key);
  scrim.addEventListener('click', close);
  document.body.append(scrim, panel);

  const fill = async (p: Member) => {
    m = p;
    panel.replaceChildren(
      h('div', { class: 'adm-drawer-head' }, h('span', { class: 'adm-avatar' }, initial(p.name)), h('h2', {}, p.name ?? '(no name yet)'), iconBtn('x', 'Close', close, 'player-close')),
      h('div', { class: 'adm-chips' }, p.banned ? badge(`Banned${p.ban_reason ? `: ${p.ban_reason}` : ''}`, 'bad') : badge('Member', 'ok'), badge(`Joined ${when(p.joined)}`), badge(`Seen ${ago(p.last_seen)}`)),
      h(
        'div',
        { class: 'adm-tiles' },
        stat('Level', p.level),
        stat('XP', p.xp),
        stat('Coins', p.coins),
        stat('Gems', p.gems),
        stat('Streak', p.streak),
        stat('Night Raid best', p.arcade_best ?? 0),
      ),
      progressCard(p, refresh),
      walletCard(p, refresh),
      accountCard(p, refresh, close),
      historyCard(p),
    );
  };
  const refresh = async () => {
    const p = (await reload()).find((x) => x.id === m.id);
    if (p) await fill(p);
  };
  void fill(m);
  panel.focus();
}
const stat = (label: string, v: number) => h('div', { class: 'adm-tile' }, h('b', {}, n(v)), h('span', {}, label));

function progressCard(p: Member, refresh: () => Promise<void>) {
  const name = input({ value: p.name ?? '', maxlength: 24, id: 'player-name', 'aria-label': 'Name' });
  const level = input({ type: 'number', min: 1, step: 1, value: p.level, id: 'player-level', inputmode: 'numeric', 'aria-label': 'Level' });
  const xp = input({ type: 'number', min: 0, step: 1, value: p.xp, id: 'player-xp', inputmode: 'numeric', 'aria-label': 'XP' });
  const add = input({ type: 'number', step: 1, placeholder: 'e.g. 500 or -200', id: 'player-add-xp', inputmode: 'numeric', 'aria-label': 'Add XP' });
  const streak = input({ type: 'number', min: 0, step: 1, value: p.streak, id: 'player-streak', inputmode: 'numeric', 'aria-label': 'Streak days' });
  const pet = input({ value: p.pet ?? '', list: 'pet-list', placeholder: 'none', id: 'player-pet', 'aria-label': 'Pet' });
  const save = (patch: Record<string, unknown>, done: string) => (e: Event) =>
    void act(e.currentTarget as HTMLButtonElement, async () => {
      await api('member-update', { member: p.id, patch });
      await refresh();
    }, done);
  return card(
    'Name and progress',
    'star',
    h('datalist', { id: 'pet-list' }, ...PETS.map((x) => h('option', { value: x }))),
    field('Name', h('div', { class: 'adm-inline' }, name, h('button', { type: 'button', class: 'adm-btn', onclick: (e: Event) => save({ name: name.value }, 'Name saved.')(e) }, 'Save'))),
    field('Level', h('div', { class: 'adm-inline' }, level, h('button', { type: 'button', class: 'adm-btn', id: 'player-set-level', onclick: (e: Event) => save({ level: Number(level.value) }, `Now level ${level.value}.`)(e) }, 'Set level')), 'Sets XP to where that level starts. Any level works.'),
    field('XP', h('div', { class: 'adm-inline' }, xp, h('button', { type: 'button', class: 'adm-btn', onclick: (e: Event) => save({ xp: Number(xp.value) }, 'XP set.')(e) }, 'Set XP'))),
    field('Add or take XP', h('div', { class: 'adm-inline' }, add, h('button', { type: 'button', class: 'adm-btn', id: 'player-add-xp-go', onclick: (e: Event) => Number(add.value) && save({ add_xp: Number(add.value) }, `${Number(add.value) > 0 ? 'Added' : 'Took'} ${Math.abs(Number(add.value))} XP.`)(e) }, 'Apply')), 'Shows in their XP history as from the admin.'),
    h(
      'div',
      { class: 'adm-grid' },
      field('Streak (days)', h('div', { class: 'adm-inline' }, streak, h('button', { type: 'button', class: 'adm-btn', onclick: (e: Event) => save({ streak: Number(streak.value) }, 'Streak set.')(e) }, 'Set'))),
      field('Pet', h('div', { class: 'adm-inline' }, pet, h('button', { type: 'button', class: 'adm-btn', onclick: (e: Event) => save({ pet: pet.value.trim() }, pet.value.trim() ? 'Pet set.' : 'Pet removed.')(e) }, 'Set'))),
    ),
  );
}

function walletCard(p: Member, refresh: () => Promise<void>) {
  const amount = input({ type: 'number', min: 1, step: 1, placeholder: 'Amount', id: 'wallet-amount', inputmode: 'numeric', 'aria-label': 'Amount' });
  const reason = input({ placeholder: 'Why (shows in their history), e.g. “Tournament prize”', maxlength: 120, id: 'wallet-reason', 'aria-label': 'Reason' });
  const move = (currency: 'coins' | 'gems', sign: 1 | -1) => (e: Event) => {
    const v = Math.trunc(Number(amount.value));
    if (!v || v < 0) return toast('Type an amount first.', true);
    void act(e.currentTarget as HTMLButtonElement, async () => {
      await api('wallet', { member: p.id, currency, amount: v * sign, reason: reason.value.trim() || null });
      amount.value = '';
      await refresh();
    }, `${sign > 0 ? 'Gave' : 'Took'} ${n(v)} ${currency}.`);
  };
  const b = (label: string, ic: 'plus' | 'minus', on: (e: Event) => void, id: string) => h('button', { type: 'button', class: 'adm-btn', id, onclick: on }, icon(ic), label);
  return card(
    'Coins and gems',
    'coins',
    h('p', { class: 'adm-hint' }, `They have ${n(p.coins)} coins and ${n(p.gems)} gems. Every change is written in the ledger with your name.`),
    h('div', { class: 'adm-inline' }, amount),
    reason,
    h('div', { class: 'adm-inline' }, b('Give coins', 'plus', move('coins', 1), 'wallet-give-coins'), b('Take coins', 'minus', move('coins', -1), 'wallet-take-coins'), b('Give gems', 'plus', move('gems', 1), 'wallet-give-gems'), b('Take gems', 'minus', move('gems', -1), 'wallet-take-gems')),
  );
}

function accountCard(p: Member, refresh: () => Promise<void>, closePanel: () => void) {
  const pw = input({ type: 'text', minlength: 8, placeholder: 'New password (8+ characters)', autocomplete: 'off', id: 'player-password', 'aria-label': 'New password' });
  const reason = input({ placeholder: 'Reason (only admins see it)', maxlength: 200, id: 'ban-reason', 'aria-label': 'Ban reason' });
  const who = p.name ?? 'this player';
  return card(
    'Account',
    'shield',
    field(
      'Reset password',
      h('div', { class: 'adm-inline' }, pw, h('button', { type: 'button', class: 'adm-btn', id: 'player-password-go', onclick: (e: Event) => void act(e.currentTarget as HTMLButtonElement, async () => { await api('reset-password', { member: p.id, password: pw.value }); pw.value = ''; }, `New password set. Tell ${who} privately.`) }, icon('key'), 'Set')),
      'For a forgotten password. They sign in with their name and this.',
    ),
    p.banned
      ? h('div', { class: 'adm-inline' }, h('span', { class: 'adm-hint', style: 'flex:1' }, `Banned${p.ban_reason ? `: ${p.ban_reason}` : ''}.`), btn('Lift the ban', () => void act(null, async () => { await api('ban', { member: p.id, banned: false }); await refresh(); }, `${who} can come back in.`), { icon: 'undo', id: 'player-unban' }))
      : field(
          'Ban',
          h('div', { class: 'adm-inline' }, reason, h('button', { type: 'button', class: 'adm-btn danger', id: 'player-ban', onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (!(await confirmBox(`Ban ${who}?`, 'They can’t get into the house (or any room, chat or game) until you lift it. Their account and progress are kept.', { ok: 'Ban', danger: true }))) return;
            await act(b, async () => { await api('ban', { member: p.id, reason: reason.value.trim() || null }); await refresh(); }, `${who} is banned.`);
          } }, icon('ban'), 'Ban')),
        ),
    h('div', {}, btn('Remove from the house…', async () => {
      if (!(await confirmBox(`Remove ${who}?`, 'This deletes their account, progress, coins and gems for good, and frees their place. It can’t be undone. (A ban can.)', { ok: 'Remove for good', danger: true, typeToConfirm: p.name ?? 'remove' }))) return;
      if (await act(null, () => api('remove-member', { member: p.id }), `${who} was removed.`)) {
        closePanel();
        await refresh().catch(() => {});
      }
    }, { icon: 'trash', kind: 'ghost', small: true, id: 'player-remove' })),
  );
}

function historyCard(p: Member) {
  const box = h('div', { class: 'adm-list' }, skeleton(2));
  const tabs = h('div', { class: 'adm-chips', role: 'tablist' });
  let hist: History | null = null;
  const show = (k: keyof History) => {
    for (const t of tabs.children) t.setAttribute('aria-pressed', String((t as HTMLElement).dataset.k === k));
    if (!hist) return;
    const rows: HTMLElement[] =
      k === 'xp' ? hist.xp.map((x) => line(`${x.amount > 0 ? '+' : ''}${n(x.amount)} XP`, x.reason, x.created_at, x.amount < 0))
        : k === 'money' ? hist.money.map((x) => line(`${x.delta > 0 ? '+' : ''}${n(x.delta)} ${x.currency === 'coins' ? 'coins' : 'gems'}`, `${x.reason} · now ${n(x.balance_after)}`, x.created_at, x.delta < 0))
          : k === 'scores' ? hist.scores.map((x) => line(`${n(x.score)} points`, `wave ${x.waves + 1} · ${Math.round(x.duration_ms / 1000)} s`, x.created_at))
            : hist.logs.map((x) => line(x.kind, x.message, x.at, x.kind === 'error'));
    box.replaceChildren(...(rows.length ? rows : [empty('clock', 'Nothing yet.')]));
  };
  for (const [k, label] of [['xp', 'XP'], ['money', 'Coins & gems'], ['scores', 'Night Raid'], ['logs', 'Device logs']] as const) {
    tabs.append(h('button', { type: 'button', class: 'adm-chip', 'data-k': k, 'aria-pressed': 'false', onclick: () => show(k) }, label));
  }
  void api<History>('member-history', { member: p.id }).then(
    (r) => ((hist = r), show('xp')),
    (e) => box.replaceChildren(empty('warn', (e as Error).message)),
  );
  return card('History', 'clock', tabs, box);
}
const line = (what: string, detail: string, at: string, bad = false) =>
  h('div', { class: 'adm-row' }, h('span', {}, icon(bad ? 'minus' : 'plus')), h('span', { class: 'adm-row-main' }, h('b', {}, what), h('small', {}, detail)), h('small', { class: 'adm-hint' }, ago(at)));
