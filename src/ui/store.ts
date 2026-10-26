import type Phaser from 'phaser';
import { skinDef, type Rarity, type Skin } from '../characters';
import { buy, coinsToday, currentWallet, fmtAmount, onStore, ownsItem, shopItems, type ShopItem } from '../net/store';
import { icon, type IconName } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { moveButtons, skinPreview } from './skinPreview';
import { play } from './sounds';
import { toast } from './toasts';

// The Shop (STORE.md S2, design/store/store.html, UI-REVIEW §3): its own sheet, not the character picker.
// Your coins and gems up top; tabs Featured · Characters · Gems; cards with the rarity, the face, the name
// and the price (or Owned / Wearing). Tapping a card opens its buy card: the character doing its moves, the
// maths (you have, price, after) and one gold button. After buying: Wear now. The server decides every
// number (src/net/store.ts); this only shows what it last said.
export type StoreTab = 'featured' | 'characters' | 'gems';
export type StoreDeps = {
  textures: Phaser.Textures.TextureManager;
  wearing: () => Skin;
  wear: (key: Skin) => Promise<void>;
  tryOn: (key: Skin) => void;
  guest: boolean;
};

const TABS: [StoreTab, string, IconName][] = [
  ['featured', 'Featured', 'sparkles'],
  ['characters', 'Characters', 'shirt'],
  ['gems', 'Gems', 'gem'],
];
const RARITY: Record<Rarity, string> = { starter: 'Free', common: 'Common', rare: 'Rare', epic: 'Epic' };
const FILTERS = [
  ['all', 'All'],
  ['coins', 'Coins'],
  ['gems', 'Gems'],
  ['owned', 'Owned'],
] as const;
type Filter = (typeof FILTERS)[number][0];
const WEEK = 7 * 86_400_000;
const MONDAY = Date.UTC(2024, 0, 1); // a Monday: the weekly pick changes at 00:00 UTC every Monday

const cost = (it: ShopItem) => (it.coins !== null ? { n: it.coins, unit: 'coins' as const } : { n: it.gems ?? 0, unit: 'gems' as const });
const rarityOf = (it: ShopItem) => (it.rarity in RARITY ? (it.rarity as Rarity) : 'common');

function price(it: ShopItem, cls = 'dh-price') {
  const c = cost(it);
  const p = el('span', `${cls} ${c.unit}`);
  p.append(icon(c.unit === 'coins' ? 'coins' : 'gem', { width: 14, height: 14 }), el('b', '', fmtAmount(c.n)));
  return p;
}

// "3d 4h" / "5h 20m" until a time.
function until(t: number) {
  const m = Math.max(1, Math.round((t - Date.now()) / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

// The same picks for everyone: one Epic a week, three things a day.
function picks(all: ShopItem[]) {
  const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
  const week = Math.floor((Date.now() - MONDAY) / WEEK);
  const epics = sorted.filter((i) => i.rarity === 'epic');
  const hero = (epics.length ? epics : sorted)[week % Math.max(1, (epics.length ? epics : sorted).length)] ?? null;
  const day = Math.floor(Date.now() / 86_400_000);
  const rest = sorted.filter((i) => i !== hero);
  const daily: ShopItem[] = [];
  for (const r of ['common', 'rare', 'epic']) {
    const pool = rest.filter((i) => i.rarity === r);
    if (pool.length) daily.push(pool[(day * 7) % pool.length]);
  }
  return { hero, daily, heroEnds: MONDAY + (week + 1) * WEEK, dayEnds: (day + 1) * 86_400_000 };
}

export function openStore(deps: StoreDeps, start: StoreTab = 'featured') {
  let tab: StoreTab = start;
  let filter: Filter = 'all';
  const { panel, close } = openModal('store', { dismissable: true, label: 'store-title' });
  panel.classList.add('dh-store');

  // ---- Head: title, your coins and gems, close ----
  const head = el('div', 'dh-store-head');
  const title = el('h2', '');
  title.id = 'store-title';
  title.append(icon('shopping-bag', { width: 20, height: 20 }), 'Shop');
  const purse = el('div', 'dh-store-purse');
  purse.id = 'store-wallet';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'store-close';
  x.setAttribute('aria-label', 'Close the shop');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(title, purse, x);

  // ---- Tabs ----
  const tabs = el('div', 'dh-store-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Shop sections');
  for (const [id, label, ic] of TABS) {
    const b = el('button', 'dh-store-tab');
    b.type = 'button';
    b.id = `store-tab-${id}`;
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'store-body');
    b.append(icon(ic, { width: 16, height: 16 }), label);
    b.addEventListener('click', () => show(id));
    tabs.append(b);
  }
  const body = el('div', 'dh-store-body');
  body.id = 'store-body';
  body.setAttribute('role', 'tabpanel');
  panel.append(head, tabs, body);

  function renderPurse() {
    const w = currentWallet();
    purse.replaceChildren();
    if (!w) return;
    const coins = el('span', 'dh-coin coin');
    coins.setAttribute('aria-label', `${fmtAmount(w.coins)} coins`);
    coins.append(icon('coins', { width: 16 }), el('b', '', fmtAmount(w.coins)));
    const gems = el('button', 'dh-coin gem dh-store-gems');
    gems.type = 'button';
    gems.setAttribute('aria-label', `${fmtAmount(w.gems)} gems: about gems`);
    gems.append(icon('gem', { width: 16 }), el('b', '', fmtAmount(w.gems)), el('span', 'plus', '+'));
    gems.addEventListener('click', () => show('gems'));
    purse.append(coins, gems);
  }

  function show(next: StoreTab) {
    const same = next === tab;
    tab = next;
    tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    body.setAttribute('aria-labelledby', `store-tab-${tab}`);
    renderPurse();
    const top = body.scrollTop;
    body.replaceChildren(...(tab === 'featured' ? featured() : tab === 'characters' ? characters() : gemsTab()));
    body.scrollTop = same ? top : 0;
  }

  // ---- A card: rarity, face, name, price or Owned / Wearing ----
  function card(it: ShopItem) {
    const r = rarityOf(it);
    const mine = ownsItem(it.id);
    const wearing = deps.wearing() === it.id;
    const name = skinDef(it.id)?.name ?? it.name;
    const b = el('button', `dh-scard r-${r}${mine ? ' own' : ''}`);
    b.type = 'button';
    b.dataset.item = it.id;
    b.append(el('span', 'tag', RARITY[r]), portrait(it.id, 56), el('span', 'nm', name));
    if (mine) {
      const s = el('span', 'st');
      s.append(icon('check', { width: 14, height: 14 }), wearing ? 'Wearing' : 'Owned');
      b.append(s);
    } else b.append(price(it));
    const c = cost(it);
    b.setAttribute('aria-label', `${name}, ${RARITY[r]}, ${mine ? (wearing ? 'wearing' : 'owned') : `${fmtAmount(c.n)} ${c.unit}`}`);
    b.addEventListener('click', () => openItem(it.id));
    return b;
  }

  function sectHead(label: string, side: string) {
    const h = el('div', 'dh-store-sect');
    h.append(el('span', '', label), el('span', 'side', side));
    return h;
  }
  function section(label: string, side: string, items: ShopItem[]) {
    const h = sectHead(label, side);
    const g = el('div', 'dh-store-grid');
    g.append(...items.map(card));
    return [h, g];
  }

  function featured(): HTMLElement[] {
    const all = shopItems();
    if (!all.length) return [el('p', 'dh-lede', 'The shop is closed right now. Try again in a bit.')];
    const { hero, daily, heroEnds, dayEnds } = picks(all);
    const out: HTMLElement[] = [];
    if (hero) {
      out.push(sectHead('This week’s pick', `new in ${until(heroEnds)}`));
      const h = el('button', `dh-store-hero r-${rarityOf(hero)}`);
      h.type = 'button';
      h.dataset.item = hero.id;
      h.id = 'store-hero';
      const pv = skinPreview(deps.textures, hero.id, 'stage', 4);
      const info = el('div', 'info');
      const nm = skinDef(hero.id)?.name ?? hero.name;
      info.append(el('span', `dh-rarity`, RARITY[rarityOf(hero)]), el('b', '', nm), ownsItem(hero.id) ? el('span', 'st', 'Owned') : price(hero));
      info.querySelector('.dh-rarity')!.setAttribute('data-rarity', rarityOf(hero));
      h.append(pv.canvas, info, icon('chevron-right', { width: 20, height: 20 }));
      h.setAttribute('aria-label', `This week’s pick: ${nm}`);
      h.addEventListener('click', () => openItem(hero.id));
      out.push(h);
    }
    out.push(...section('Today’s picks', `new in ${until(dayEnds)}`, daily));
    out.push(earnCard());
    return out;
  }

  function characters(): HTMLElement[] {
    const seg = el('div', 'dh-seg dh-store-filter');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Show');
    for (const [id, label] of FILTERS) {
      const b = el('button', 'dh-seg-btn', label);
      b.type = 'button';
      b.dataset.filter = id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === filter));
      b.addEventListener('click', () => {
        filter = id;
        show('characters');
      });
      seg.append(b);
    }
    const keep = (it: ShopItem) => {
      const mine = ownsItem(it.id);
      if (filter === 'owned') return mine;
      if (filter === 'coins') return it.coins !== null;
      if (filter === 'gems') return it.gems !== null;
      return true;
    };
    // Not owned first, then by name, under each rarity.
    const all = shopItems().filter(keep).sort((a, b) => Number(ownsItem(a.id)) - Number(ownsItem(b.id)) || a.name.localeCompare(b.name));
    const out: HTMLElement[] = [seg];
    for (const r of ['common', 'rare', 'epic'] as const) {
      const list = all.filter((i) => i.rarity === r);
      if (!list.length) continue;
      const prices = new Set(list.map((i) => `${cost(i).n} ${cost(i).unit}`));
      const side = prices.size === 1 ? `${fmtAmount(cost(list[0]).n)} ${cost(list[0]).unit} each` : `${list.length}`;
      out.push(...section(RARITY[r], side, list));
    }
    if (out.length === 1) out.push(el('p', 'dh-lede', filter === 'owned' ? 'Nothing bought yet. Everything you buy shows up here and in your wardrobe.' : 'Nothing here right now.'));
    return out;
  }

  function earnCard() {
    const t = coinsToday();
    const box = el('div', 'dh-store-earn');
    box.id = 'store-earn';
    const top = el('div', 'top');
    top.append(icon('coins', { width: 18, height: 18 }), el('b', '', 'Earn coins by playing'));
    const bar = el('div', 'v2-bar');
    const fill = el('b');
    fill.style.width = `${Math.min(100, (100 * t.earned) / Math.max(1, t.cap))}%`;
    bar.append(fill);
    const today = el('span', 'today', `Today: ${fmtAmount(t.earned)} of ${fmtAmount(t.cap)}`);
    const ways = el('ul');
    for (const w of ['Your daily visit (more on a streak)', 'Challenges', 'Games at the games table', 'Catching critters', 'A new Night Raid best', 'Levelling up']) ways.append(el('li', '', w));
    box.append(top, bar, today, ways);
    return box;
  }

  function gemsTab(): HTMLElement[] {
    const w = currentWallet();
    const have = el('div', 'dh-store-gembox');
    have.append(icon('gem', { width: 28, height: 28 }), el('b', '', w ? fmtAmount(w.gems) : '–'), el('span', '', 'gems'));
    const soon = el('div', 'dh-store-note');
    soon.id = 'store-packs';
    soon.append(el('b', '', 'Gem packs are coming soon'), el('p', '', 'You’ll be able to buy gems here. They pay for Rare and Epic characters.'));
    const coins = el('div', 'dh-store-note');
    coins.append(el('b', '', 'Coins can’t be bought'), el('p', '', 'You earn them by playing, and they pay for Common characters.'));
    const fine = el('p', 'dh-store-fine', 'Gems never expire. Everything in the shop is just for looks: it never helps you win a game.');
    return [have, soon, coins, earnCard(), fine];
  }

  // ---- The buy card ----
  function openItem(id: Skin) {
    const it = shopItems().find((i) => i.id === id);
    if (!it) return;
    play('click', 0.25);
    const { panel: card, close: closeItem } = openModal('store-item', { dismissable: true, label: 'store-item-name', quiet: true });
    card.classList.add('dh-store-item');
    const pv = skinPreview(deps.textures, id, 'stage', 6);
    const stage = el('div', `dh-store-stage r-${rarityOf(it)}`);
    stage.append(pv.canvas);
    const nm = skinDef(id)?.name ?? it.name;
    const info = el('div', 'info');
    const name = el('h2', '', nm);
    name.id = 'store-item-name';
    const tag = el('span', 'dh-rarity', RARITY[rarityOf(it)]);
    tag.dataset.rarity = rarityOf(it);
    info.append(tag, name, moveButtons((m) => pv.move(m)));
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'store-item-close';
    x.setAttribute('aria-label', 'Back to the shop');
    x.append(icon('x'));
    x.addEventListener('click', closeItem);
    const top = el('div', 'top');
    top.append(stage, info, x);
    const rest = el('div', 'dh-store-buy');
    card.append(top, rest);
    const off = onStore(() => (card.isConnected ? fill() : off()));
    fill();

    function fill(justBought = false) {
      const w = currentWallet();
      const mine = ownsItem(id);
      const wearing = deps.wearing() === id;
      const c = cost(it!);
      const parts: HTMLElement[] = [];
      const error = el('p', 'dh-error');
      error.id = 'store-error';
      error.hidden = true;
      if (mine) {
        if (justBought) {
          const yay = el('p', 'dh-store-yay');
          yay.id = 'store-yay';
          yay.append(icon('sparkles', { width: 18, height: 18 }), `${nm} is yours!`);
          parts.push(yay);
        } else parts.push(el('p', 'dh-lede', wearing ? 'You’re wearing it.' : 'It’s yours. Wear it any time from here or your wardrobe.'));
        const row = el('div', 'act');
        const back = el('button', 'dh-btn dh-btn--quiet', justBought ? 'Keep shopping' : 'Close');
        back.type = 'button';
        back.addEventListener('click', closeItem);
        const wear = el('button', 'dh-btn');
        wear.type = 'button';
        wear.id = 'store-wear';
        wear.disabled = wearing;
        wear.append(icon('shirt', { width: 18 }), wearing ? 'Wearing' : 'Wear now');
        wear.addEventListener('click', async () => {
          wear.disabled = true;
          await deps.wear(id);
          play('click', 0.4);
          closeItem();
          close();
        });
        row.append(back, wear);
        parts.push(row);
      } else if (deps.guest || !w) {
        parts.push(el('p', 'dh-lede', deps.guest ? 'Members can shop. Ask your host for an invite.' : 'Couldn’t reach the shop. Try again in a moment.'));
        if (deps.guest) parts.push(tryButton());
      } else {
        const have = c.unit === 'coins' ? w.coins : w.gems;
        const after = have - c.n;
        const maths = el('div', 'maths');
        maths.id = 'store-maths';
        const row = (label: string, value: string, cls = '') => {
          const r = el('div', `r ${cls}`);
          r.append(el('span', '', label), el('b', '', value));
          return r;
        };
        maths.append(row('You have', `${fmtAmount(have)} ${c.unit}`), row('Price', `− ${fmtAmount(c.n)}`), row('After', after >= 0 ? `${fmtAmount(after)} ${c.unit}` : `need ${fmtAmount(-after)} more`, after >= 0 ? 'after' : 'short'));
        parts.push(maths);
        const note = el('p', 'v2-note');
        note.id = 'store-note';
        if (w.locked) note.textContent = 'Your gem balance is negative after a refund. Top up to keep shopping.';
        else if (after < 0 && c.unit === 'gems') note.textContent = 'Gem packs are coming soon.';
        else if (after < 0) {
          const t = coinsToday();
          note.textContent = `Earn coins by playing: your daily visit, challenges, games and catching critters (today ${fmtAmount(t.earned)} of ${fmtAmount(t.cap)}).`;
        }
        if (note.textContent) parts.push(note);
        const act = el('div', 'act');
        const buyBtn = el('button', 'dh-btn');
        buyBtn.type = 'button';
        buyBtn.id = 'store-buy';
        const short = after < 0 || w.locked;
        buyBtn.disabled = short;
        buyBtn.append(icon(c.unit === 'coins' ? 'coins' : 'gem', { width: 18 }), short && !w.locked ? `Need ${fmtAmount(-after)} more` : `Buy for ${fmtAmount(c.n)} ${c.unit}`);
        buyBtn.addEventListener('click', async () => {
          buyBtn.disabled = true;
          buyBtn.replaceChildren(document.createTextNode('Buying…'));
          const r = await buy(id);
          if (!card.isConnected) return;
          if (r.ok) {
            play('coin', 0.6);
            toast({ icon: 'sparkles', id: 'bought', who: `${nm} is yours`, what: 'Wear it now, or any time from your wardrobe.', small: true, ttl: 3500 });
            fill(true);
          } else {
            play('error', 0.4);
            fill();
            const e = card.querySelector<HTMLElement>('#store-error');
            if (e) {
              e.textContent = r.why;
              e.hidden = false;
            }
          }
        });
        act.append(tryButton(), buyBtn);
        parts.push(act);
      }
      parts.push(error);
      if (!mine) parts.push(el('p', 'dh-store-fine', 'Just for looks: it never helps you win a game.'));
      rest.replaceChildren(...parts);
    }

    function tryButton() {
      const t = el('button', 'dh-btn dh-btn--quiet');
      t.type = 'button';
      t.id = 'store-try';
      t.append(icon('timer', { width: 18 }), 'Try on 60 s');
      t.addEventListener('click', () => {
        closeItem();
        close();
        deps.tryOn(id);
      });
      return t;
    }
  }

  const off = onStore(() => (panel.isConnected ? show(tab) : off()));
  show(tab);
  return { close };
}
