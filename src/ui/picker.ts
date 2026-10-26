import type Phaser from 'phaser';
import { skinDef, SKINS, type Skin } from '../characters';
import { NAME_MAX } from '../prefs';
import { icon } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { moveButtons, skinPreview } from './skinPreview';
import { play } from './sounds';

// Your wardrobe: "Who are you?" on a first visit, then "Your character". Your name, a big preview that walks,
// attacks and jumps, and only the characters you can wear (the free starters and anything you've bought).
// Buying lives in the Shop (src/ui/store.ts); members get a "More in the Shop" card at the end.
export type PickResult = { character: Skin; name: string };
const FAV_KEY = 'diesel-house.fav-skins';
const MANY = 12; // more than this: search and ★ Saved

function favourites(): Set<Skin> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as Skin[]);
  } catch {
    return new Set();
  }
}
function saveFavourites(f: Set<Skin>) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...f]));
  } catch {
    // private browsing: not remembered
  }
}

// Resolves with the choice; null if closed without changing (only when `canClose`: not a first visit);
// 'shop' if they tapped "More in the Shop".
export function pickCharacter(
  textures: Phaser.Textures.TextureManager,
  current: Skin | null,
  currentName: string | null,
  canClose = current !== null && currentName !== null,
  wearable: Skin[] = SKINS.filter((s) => s.rarity === 'starter').map((s) => s.key),
  shopLink = false,
): Promise<PickResult | null | 'shop'> {
  return new Promise((resolve) => {
    let selected: Skin = current && wearable.includes(current) ? current : wearable[0];
    let query = '';
    let savedOnly = false;
    const favs = favourites();
    const { panel, scrim } = openModal('picker', { dismissable: canClose, onDismiss: () => finish(null, false), label: 'picker-title' });
    panel.classList.add('dh-picker');

    const head = el('div', 'dh-row');
    const title = el('h2', '', canClose ? 'Your character' : 'Who are you?');
    title.id = 'picker-title';
    head.append(title);
    if (canClose) {
      const x = el('button', 'dh-iconbtn');
      x.type = 'button';
      x.id = 'picker-close';
      x.setAttribute('aria-label', 'Close');
      x.append(icon('x'));
      x.addEventListener('click', () => finish(null));
      head.append(x);
    }

    const nameField = el('div', 'dh-field');
    const nameLabel = el('label', 'dh-label', 'Your name');
    const nameInput = el('input', 'dh-input');
    nameInput.id = 'player-name';
    nameLabel.htmlFor = nameInput.id;
    nameInput.maxLength = NAME_MAX;
    nameInput.value = currentName ?? '';
    nameInput.placeholder = 'What your friends call you';
    nameInput.setAttribute('autocomplete', 'nickname');
    nameField.append(nameLabel, nameInput);

    // ---- The preview: the selected character, big, doing a move ----
    const preview = el('div', 'dh-pick-preview');
    const pv = skinPreview(textures, selected);
    const info = el('div', 'info');
    const pName = el('b');
    pName.id = 'picker-selected';
    const pTag = el('span', 'dh-rarity');
    const fav = el('button', 'dh-iconbtn dh-fav');
    fav.type = 'button';
    fav.id = 'picker-fav';
    fav.textContent = '★';
    fav.addEventListener('click', () => {
      if (favs.has(selected)) favs.delete(selected);
      else favs.add(selected);
      saveFavourites(favs);
      play('click', 0.3);
      showSelected();
      renderGrid();
    });
    info.append(pName, pTag, moveButtons((m) => pv.move(m)));
    preview.append(pv.canvas, info, fav);

    // ---- Search and ★ Saved (only with lots to choose from) ----
    const filters = el('div', 'dh-pick-filters');
    const search = el('input', 'dh-input');
    search.id = 'picker-search';
    search.type = 'search';
    search.placeholder = 'Search your characters';
    search.setAttribute('aria-label', 'Search your characters');
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      renderGrid();
    });
    const saved = el('button', 'dh-chip', '★ Saved');
    saved.type = 'button';
    saved.id = 'picker-saved';
    saved.setAttribute('aria-pressed', 'false');
    saved.addEventListener('click', () => {
      savedOnly = !savedOnly;
      saved.setAttribute('aria-pressed', String(savedOnly));
      renderGrid();
    });
    filters.append(search, saved);
    filters.hidden = wearable.length <= MANY;

    const count = el('div', 'dh-label');
    count.id = 'picker-count';
    const grid = el('div', 'dh-picks');
    grid.id = 'picker-grid';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-labelledby', 'picker-count');

    const error = el('p', 'dh-error');
    error.id = 'picker-error';
    error.hidden = true;
    const done = el('button', 'dh-btn');
    done.type = 'button';
    done.id = 'picker-done';
    const doneText = el('span', '', 'Done');
    done.append(icon('check'), doneText);
    done.addEventListener('click', () => {
      const name = nameInput.value.trim().slice(0, NAME_MAX);
      error.textContent = name ? '' : 'Type your name first.';
      error.hidden = !!name;
      if (!name) {
        nameInput.focus();
        return play('error', 0.4);
      }
      finish({ character: selected, name });
    });
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && done.click());
    const foot = el('div', 'dh-pick-foot');
    foot.append(error, done);

    panel.append(head, nameField, preview, filters, count, grid, foot);
    if (!currentName) nameInput.focus();

    function renderGrid() {
      const shown = SKINS.filter((s) => wearable.includes(s.key) && (!savedOnly || favs.has(s.key)) && (!query || s.name.toLowerCase().includes(query)));
      count.textContent = savedOnly && !shown.length ? 'No saved characters yet: tap ★ on one you like' : `Yours to wear · ${shown.length}`;
      const cards = shown.map((s) => {
        const b = el('button', `dh-pick r-${s.rarity}`);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(s.key === selected));
        const state = s.key === current ? 'Wearing' : s.rarity === 'starter' ? 'Free' : 'Owned';
        b.setAttribute('aria-label', `${s.name}, ${state.toLowerCase()}`);
        b.dataset.character = s.key;
        b.append(portrait(s.key, 48), el('span', 'nm', s.name), el('span', `st${s.key === current ? ' own' : ''}`, state));
        if (favs.has(s.key)) b.append(el('span', 'fv', '★'));
        b.addEventListener('click', () => select(s.key));
        return b;
      });
      // The way to more characters: the Shop (members, not on a first visit).
      if (shopLink && canClose) {
        const more = el('button', 'dh-pick dh-pick--shop');
        more.type = 'button';
        more.id = 'picker-shop';
        more.append(icon('shopping-bag', { width: 28, height: 28 }), el('span', 'nm', 'More in the Shop'), el('span', 'st', `${SKINS.length - wearable.length} more`));
        more.addEventListener('click', () => finish('shop'));
        cards.push(more);
      }
      grid.replaceChildren(...cards);
    }

    function showSelected() {
      const s = skinDef(selected)!;
      pName.textContent = s.name;
      pTag.textContent = selected === current ? 'Wearing' : s.rarity === 'starter' ? 'Free' : 'Owned';
      pTag.dataset.rarity = selected === current ? 'starter' : s.rarity;
      fav.setAttribute('aria-label', favs.has(selected) ? `Unsave ${s.name}` : `Save ${s.name}`);
      fav.setAttribute('aria-pressed', String(favs.has(selected)));
      doneText.textContent = canClose && selected !== current ? `Wear ${s.name}` : 'Done';
      pv.show(selected);
    }

    function select(key: Skin) {
      selected = key;
      grid.querySelectorAll<HTMLButtonElement>('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.character === key)));
      error.hidden = true;
      play('click', 0.25);
      showSelected();
    }

    renderGrid();
    showSelected();
    grid.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest' });

    function finish(result: PickResult | null | 'shop', remove = true) {
      pv.stop();
      if (remove) scrim.remove();
      resolve(result);
    }
  });
}
