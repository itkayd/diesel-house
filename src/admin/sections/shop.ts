import type { Section } from '../main';
import { act, api, badge, btn, card, field, h, input, n, sectionHead, skeleton } from '../kit';

type Item = { id: string; kind: string; rarity: string; name: string; coins: number | null; gems: number | null; active: boolean; owners: number };
type Shop = { items: Item[]; config: Record<string, number>; sold_week: number; coins_spent_week: number; coins_earned_week: number };
type Member = { id: string; name: string | null; login: string };

// The shop (STORE.md S2): prices (coins or gems, one each), what's on sale, who owns what, the coin earn
// rates and caps, and giving a player a character. Real-money gem packs come in S3 (Stripe).
const RATES: [string, string, string][] = [
  ['coins_daily_cap', 'Daily coin cap', 'Everything a player can earn in one day (their local day).'],
  ['coins_games_cap', 'Daily cap from games', 'Part of the daily cap.'],
  ['coins_visit', 'Daily visit', 'First visit of the day.'],
  ['coins_visit_streak7', 'Daily visit, 7-day streak', 'Instead of the above, from a 7-day streak.'],
  ['coins_game_win', 'Win a mini-game', ''],
  ['coins_game_play', 'Play a mini-game', 'When you don’t win.'],
  ['coins_catch', 'Catch a critter', ''],
  ['coins_catch_rare', 'Catch a rare critter', 'Owl, fox, the lost medal (15+ XP).'],
  ['coins_arcade_best', 'New Night Raid best', ''],
];
const RARITY_KIND = { common: '', rare: 'info', epic: 'warn', limited: 'ok', event: 'bad' } as const;

export const shop: Section = {
  id: 'shop',
  label: 'Shop',
  icon: 'sparkles',
  async render(main) {
    main.append(sectionHead('Shop', 'What’s for sale and for how much, what playing pays in coins, and gifts. Prices are always whole coins or gems; one price per item.'), skeleton(4));
    const [r, members] = await Promise.all([api<Shop>('shop'), api<Member[]>('members')]);
    main.lastElementChild?.remove();

    const stats = h(
      'div',
      { class: 'adm-tiles' },
      ...([['sold this week', r.sold_week], ['coins spent this week', r.coins_spent_week], ['coins earned this week', r.coins_earned_week]] as const).map(([label, v]) =>
        h('div', { class: 'adm-tile' }, h('b', {}, n(v)), h('span', {}, label)),
      ),
    );

    // Items: price in coins or gems, on sale or not. Save lights up once a row has changed.
    let kind = 'all';
    const rows = r.items.map((it) => {
      const cur = h('select', { class: 'adm-sel', 'aria-label': `${it.name} currency`, id: `shop-cur-${it.id}` }, h('option', { value: 'coins' }, 'coins'), h('option', { value: 'gems' }, 'gems')) as HTMLSelectElement;
      cur.value = it.coins !== null ? 'coins' : 'gems';
      const price = input({ type: 'number', min: 1, step: 1, value: it.coins ?? it.gems ?? 1, inputmode: 'numeric', 'aria-label': `${it.name} price`, id: `shop-price-${it.id}` });
      const on = h('input', { type: 'checkbox', 'aria-label': `${it.name} on sale`, id: `shop-on-${it.id}` }) as HTMLInputElement;
      on.checked = it.active;
      const save = h('button', { type: 'button', class: 'adm-btn small', id: `shop-save-${it.id}` }, 'Save') as HTMLButtonElement;
      const was = () => `${it.coins ?? ''}|${it.gems ?? ''}|${it.active}`;
      const now = () => `${cur.value === 'coins' ? Number(price.value) : ''}|${cur.value === 'gems' ? Number(price.value) : ''}|${on.checked}`;
      const dirty = () => save.classList.toggle('gold', now() !== was());
      for (const x of [cur, price, on]) x.addEventListener('input', dirty);
      const commit = () =>
        api('shop-item', { item: it.id, coins: cur.value === 'coins' ? Number(price.value) : null, gems: cur.value === 'gems' ? Number(price.value) : null, active: on.checked }).then(() => {
          it.coins = cur.value === 'coins' ? Number(price.value) : null;
          it.gems = cur.value === 'gems' ? Number(price.value) : null;
          it.active = on.checked;
          dirty();
        });
      save.addEventListener('click', () => void act(save, commit, `${it.name} saved.`));
      const tr = h(
        'tr',
        { 'data-item': it.id, 'data-name': it.name.toLowerCase(), 'data-rarity': it.rarity },
        h('td', { 'data-label': 'Item' }, h('b', {}, it.name), ' ', badge(it.rarity, RARITY_KIND[it.rarity as keyof typeof RARITY_KIND] ?? '')),
        h('td', { 'data-label': 'Price', class: 'num' }, h('div', { class: 'adm-inline' }, price, cur)),
        h('td', { 'data-label': 'On sale' }, on),
        h('td', { 'data-label': 'Owners', class: 'num' }, n(it.owners)),
        h('td', {}, save),
      );
      return { tr, it, set: (p: number, c: string) => ((price.value = String(p)), (cur.value = c), dirty()), commit };
    });
    const filter = input({ type: 'search', placeholder: 'Find an item', 'aria-label': 'Find an item', id: 'shop-search' });
    const tbody = h('tbody', {}, ...rows.map((x) => x.tr));
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      for (const { tr, it } of rows) tr.hidden = (!!q && !(tr.dataset.name ?? '').includes(q)) || (kind === 'off' ? it.active : kind !== 'all' && it.rarity !== kind);
    };
    filter.addEventListener('input', draw);
    const rarities = [...new Set(r.items.map((i) => i.rarity))];
    const chips = h('div', { class: 'adm-chips', id: 'shop-kinds' });
    for (const [k, label] of [['all', 'All'], ...rarities.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), ['off', 'Off sale']]) {
      chips.append(
        h('button', { type: 'button', class: 'adm-chip', 'data-k': k, 'aria-pressed': String(k === kind), onclick: () => ((kind = k), chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k))), draw()) }, label),
      );
    }

    // One price for a whole rarity (e.g. every Rare 400 gems), saved for each of them.
    const perRarity = rarities.map((rar) => {
      const mine = rows.filter((x) => x.it.rarity === rar);
      const first = mine[0].it;
      const box = input({ type: 'number', min: 1, step: 1, value: first.coins ?? first.gems ?? 1, inputmode: 'numeric', id: `bulk-price-${rar}`, 'aria-label': `${rar} price` });
      const c = h('select', { class: 'adm-sel', id: `bulk-cur-${rar}`, 'aria-label': `${rar} currency` }, h('option', { value: 'coins' }, 'coins'), h('option', { value: 'gems' }, 'gems')) as HTMLSelectElement;
      c.value = first.coins !== null ? 'coins' : 'gems';
      const go = btn(`Apply to all ${mine.length}`, () =>
        void act(go, async () => {
          for (const x of mine) {
            x.set(Number(box.value), c.value);
            await x.commit();
          }
        }, `Every ${rar} is now ${n(Number(box.value))} ${c.value}.`), { small: true, id: `bulk-go-${rar}` });
      return field(`${rar[0].toUpperCase() + rar.slice(1)} (${mine.length})`, h('div', { class: 'adm-inline' }, box, c, go));
    });

    // Coin earn rates and caps.
    const rates = RATES.map(([key, label, hint]) => {
      const box = input({ type: 'number', min: 0, step: 1, value: r.config[key] ?? 0, inputmode: 'numeric', id: `econ-${key}` });
      const save = btn('Save', () => void act(save, () => api('econ-set', { setting: key, amount: Number(box.value) }), `${label}: saved.`), { small: true });
      return field(label, h('div', { class: 'adm-inline' }, box, save), hint || undefined);
    });

    // A gift.
    const who = h('select', { class: 'adm-sel', id: 'gift-member', 'aria-label': 'Player' }, ...members.map((m) => h('option', { value: m.id }, m.name ?? m.login))) as HTMLSelectElement;
    const what = h('select', { class: 'adm-sel', id: 'gift-item', 'aria-label': 'Character' }, ...r.items.map((it) => h('option', { value: it.id }, it.name))) as HTMLSelectElement;
    const give = btn('Give', () => void act(give, () => api('give-item', { member: who.value, item: what.value }), 'Given. They can wear it now.'), { icon: 'sparkles', kind: 'gold', id: 'gift-go' });

    main.append(
      stats,
      card('Gift a character', 'sparkles', h('div', { class: 'adm-inline' }, who, what, give)),
      card('Price per rarity', 'sparkles', h('p', { class: 'adm-hint' }, 'Sets the same price on every item of that rarity. Players see it straight away.'), h('div', { class: 'adm-fields3' }, ...perRarity)),
      card('Items', 'sparkles', h('div', { class: 'adm-inline' }, h('div', { class: 'adm-search' }, filter), chips), h('table', { class: 'adm-table', id: 'shop-table' }, h('thead', {}, h('tr', {}, ...['Item', 'Price', 'On sale', 'Owners', ''].map((t) => h('th', {}, t)))), tbody)),
      card('Coins from playing', 'sparkles', h('p', { class: 'adm-hint' }, 'What each thing pays, and the daily caps. Changes apply straight away.'), h('div', { class: 'adm-fields3' }, ...rates)),
    );
  },
};
