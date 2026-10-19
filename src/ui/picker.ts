import type Phaser from 'phaser';
import { DIRS, SKINS, skinDef, skinFrame, walkSteps, type Dir, type Skin, type SkinCategory } from '../characters';
import { NAME_MAX } from '../prefs';
import { icon } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { play } from './sounds';

// "Who are you?" (REDESIGN.md R4, store card look from design/store/store.html): your name, a big preview
// that walks, attacks and jumps, then every character as a card with its rarity. Free starters can be
// worn now; the rest come with the shop (STORE.md, phase S2) and can be tried on for 60 s (only you see
// it). Filter by category, search by name, star favourites (kept on this device).
export type PickResult = { character: Skin; name: string; tryOn?: Skin };

const CATS: [SkinCategory | 'all' | 'fav', string][] = [
  ['all', 'All'],
  ['fav', '★ Saved'],
  ['people', 'People'],
  ['ninja', 'Ninja'],
  ['animal', 'Animal folk'],
  ['fantasy', 'Fantasy'],
];
const RARITY_LABEL = { starter: 'Free', common: 'Common', rare: 'Rare', epic: 'Epic' } as const;
const FAV_KEY = 'diesel-house.fav-skins';
const PREVIEW = 4; // preview scale (16 px → 64 px)

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

// Resolves with the choice, or null if closed without changing (only when `canClose`: not first launch).
export function pickCharacter(
  textures: Phaser.Textures.TextureManager,
  current: Skin | null,
  currentName: string | null,
  canClose = current !== null && currentName !== null,
  wearable: Skin[] = SKINS.filter((s) => s.rarity === 'starter').map((s) => s.key),
  guest = false,
): Promise<PickResult | null> {
  return new Promise((resolve) => {
    let selected: Skin = current ?? wearable[0];
    let move: 'walk' | 'attack' | 'jump' = 'walk';
    let cat: (typeof CATS)[number][0] = 'all';
    let query = '';
    const favs = favourites();
    let raf = 0;
    const { panel, scrim } = openModal('picker', { dismissable: canClose, onDismiss: () => finish(null, false), label: 'picker-title' });
    panel.classList.add('dh-picker');

    const head = el('div', 'dh-row');
    const title = el('h2', '', canClose ? 'You' : 'Who are you?');
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

    const nameField = el('div');
    nameField.style.cssText = 'display:grid;gap:6px';
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
    const stage = el('canvas', 'stage');
    stage.width = stage.height = 16 * PREVIEW;
    const info = el('div', 'info');
    const pName = el('b');
    pName.id = 'picker-selected';
    const pTag = el('span', 'dh-rarity');
    const pNote = el('span', 'note');
    const moves = el('div', 'moves');
    for (const m of ['walk', 'attack', 'jump'] as const) {
      const b = el('button', 'dh-chip', m[0].toUpperCase() + m.slice(1));
      b.type = 'button';
      b.dataset.move = m;
      b.addEventListener('click', () => {
        move = m;
        moves.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      });
      b.setAttribute('aria-pressed', String(m === move));
      moves.append(b);
    }
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
      if (cat === 'fav') renderGrid();
    });
    const tryOn = el('button', 'dh-btn dh-btn--quiet');
    tryOn.type = 'button';
    tryOn.id = 'picker-try';
    tryOn.append(icon('timer', { width: 18 }), 'Try it on for 60 s');
    tryOn.addEventListener('click', () => {
      const name = nameInput.value.trim().slice(0, NAME_MAX) || currentName || '';
      if (!name || !current) return;
      finish({ character: current, name, tryOn: selected });
    });
    info.append(pName, pTag, pNote, moves);
    preview.append(stage, info, fav);

    // ---- Filters ----
    const filters = el('div', 'dh-pick-filters');
    const cats = el('div', 'cats');
    cats.setAttribute('role', 'tablist');
    for (const [id, label] of CATS) {
      const b = el('button', 'dh-chip', label);
      b.type = 'button';
      b.dataset.cat = id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === cat));
      b.addEventListener('click', () => {
        cat = id;
        cats.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        renderGrid();
      });
      cats.append(b);
    }
    const search = el('input', 'dh-input');
    search.id = 'picker-search';
    search.type = 'search';
    search.placeholder = 'Search characters';
    search.setAttribute('aria-label', 'Search characters');
    search.addEventListener('input', () => {
      query = search.value.trim().toLowerCase();
      renderGrid();
    });
    filters.append(cats, search);

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
    done.append(icon('check'), 'Done');
    const doneText = el('span', '', 'Done');
    done.replaceChildren(icon('check'), doneText);
    done.addEventListener('click', () => {
      const name = nameInput.value.trim().slice(0, NAME_MAX);
      // A shop character is only being looked at: Done keeps what you're wearing.
      const wear = wearable.includes(selected) ? selected : current;
      const problem = !name ? 'Type your name first.' : !wear ? 'That one is coming to the shop. Pick a free one to wear.' : '';
      error.textContent = problem;
      error.hidden = !problem;
      if (!name) nameInput.focus();
      if (!problem) finish({ character: wear!, name });
      else play('error', 0.4);
    });
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && done.click());
    const foot = el('div', 'dh-pick-foot');
    foot.append(error, tryOn, done);

    panel.append(head, nameField, preview, filters, count, grid, foot);
    if (!currentName) nameInput.focus();

    function renderGrid() {
      const shown = SKINS.filter((s) => {
        if (cat === 'fav' ? !favs.has(s.key) : cat !== 'all' && s.cat !== cat) return false;
        return !query || s.name.toLowerCase().includes(query);
      }).sort((a, b) => Number(!wearable.includes(a.key)) - Number(!wearable.includes(b.key)));
      count.textContent = cat === 'fav' && !shown.length ? 'No saved characters yet: tap ★ on one you like' : `${shown.length} character${shown.length === 1 ? '' : 's'}`;
      grid.replaceChildren(
        ...shown.map((s) => {
          const own = wearable.includes(s.key);
          const b = el('button', `dh-pick r-${s.rarity}${own ? '' : ' locked'}`);
          b.type = 'button';
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(s.key === selected));
          b.setAttribute('aria-label', `${s.name}, ${own ? (s.key === current ? 'wearing' : 'free') : `${RARITY_LABEL[s.rarity]}, in the shop soon`}`);
          b.dataset.character = s.key;
          const state = s.key === current ? 'Wearing' : own ? 'Free' : `${RARITY_LABEL[s.rarity]} · soon`;
          b.append(portrait(s.key, 48), el('span', 'nm', s.name), el('span', `st${own ? ' own' : ''}`, state));
          if (favs.has(s.key)) b.append(el('span', 'fv', '★'));
          b.addEventListener('click', () => select(s.key));
          return b;
        }),
      );
    }

    function showSelected() {
      const s = skinDef(selected)!;
      const own = wearable.includes(selected);
      pName.textContent = s.name;
      pTag.textContent = own ? (selected === current ? 'Wearing' : 'Free') : RARITY_LABEL[s.rarity];
      pTag.dataset.rarity = own ? 'starter' : s.rarity;
      pNote.textContent = own ? '' : guest ? 'Members can get this one in the shop.' : 'Coming to the shop. Try it on to see it in the house.';
      fav.setAttribute('aria-label', favs.has(selected) ? `Unsave ${s.name}` : `Save ${s.name}`);
      fav.setAttribute('aria-pressed', String(favs.has(selected)));
      tryOn.hidden = own || !current || guest;
      doneText.textContent = !own && current ? `Keep wearing ${skinDef(current)?.name ?? 'yours'}` : 'Done';
      draw(0);
    }

    function select(key: Skin) {
      selected = key;
      grid.querySelectorAll<HTMLButtonElement>('.dh-pick').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.character === key)));
      error.hidden = true;
      play('click', 0.25);
      showSelected();
    }

    // The preview turns to face each way while walking; attack and jump face the viewer.
    function draw(t: number) {
      const step = Math.floor(t / 150);
      const dir: Dir = move === 'walk' ? DIRS[Math.floor(t / 2400) % DIRS.length] : 'down';
      const f = move === 'walk' ? skinFrame(selected, 'walk', dir, step % walkSteps) : step % 4 < 2 ? skinFrame(selected, move, dir) : skinFrame(selected, 'idle', dir);
      const fr = textures.getFrame(f.key, f.frame);
      if (!fr) return;
      const g = stage.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, stage.width, stage.height);
      g.drawImage(fr.source.image as CanvasImageSource, fr.cutX, fr.cutY, 16, 16, 0, 0, stage.width, stage.height);
    }

    renderGrid();
    showSelected();
    grid.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest' });
    const tick = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(tick);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);

    function finish(result: PickResult | null, remove = true) {
      cancelAnimationFrame(raf);
      if (remove) scrim.remove();
      resolve(result);
    }
  });
}
