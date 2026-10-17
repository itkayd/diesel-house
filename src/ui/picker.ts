import type Phaser from 'phaser';
import { CHARACTER_COUNT, characterFrames, portraitFrame } from '../characters';
import { NAME_MAX } from '../prefs';
import { icon } from './icons';
import { el, openModal } from './modal';

const SCALE = 3;

function drawFrame(c: HTMLCanvasElement, textures: Phaser.Textures.TextureManager, key: string, frame: number) {
  const f = textures.getFrame(key, frame);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, 16, 32, 0, 0, c.width, c.height);
}

function portrait(textures: Phaser.Textures.TextureManager, index: number) {
  const c = document.createElement('canvas');
  c.width = 16 * SCALE;
  c.height = 32 * SCALE;
  const { key, frame } = portraitFrame(index);
  drawFrame(c, textures, key, frame);
  return c;
}

// The selected character moves gently: LimeZu ones breathe (idle strip), chibis step in place.
function animationFrames(index: number) {
  const f = characterFrames(index);
  return index < 16 ? f.walk.down : f.idle.down;
}

// "Who are you?" card (design/game/mvp.html `showPicker`): name, then character, then Done.
// Resolves with the choice, or null if closed without changing (only when `canClose`: not first launch).
export function pickCharacter(
  textures: Phaser.Textures.TextureManager,
  current: number | null,
  currentName: string | null,
  canClose = current !== null && currentName !== null,
  choices: number[] = Array.from({ length: CHARACTER_COUNT }, (_, i) => i), // guests get GUEST_CHARACTERS
): Promise<{ character: number; name: string } | null> {
  return new Promise((resolve) => {
    let selected = current !== null && choices.includes(current) ? current : null;
    let raf = 0;
    const { panel, scrim } = openModal('picker', { dismissable: canClose, onDismiss: () => finish(null, false), label: 'picker-title' });

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

    const charLabel = el('div', 'dh-label', 'Pick your character');
    charLabel.id = 'picker-characters';
    const grid = el('div', 'dh-picks');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-labelledby', 'picker-characters');
    const buttons: HTMLButtonElement[] = [];
    const canvases: HTMLCanvasElement[] = [];
    for (const i of choices) {
      const b = el('button', 'dh-pick');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Character ${i + 1}`);
      const at = buttons.length;
      b.setAttribute('aria-checked', 'false');
      b.dataset.character = String(i);
      const c = portrait(textures, i);
      canvases[i] = c;
      b.appendChild(c);
      b.addEventListener('click', () => select(i));
      buttons[at] = b;
      grid.appendChild(b);
    }

    const error = el('p', 'dh-error');
    error.id = 'picker-error';
    error.hidden = true;
    const done = el('button', 'dh-btn');
    done.type = 'button';
    done.id = 'picker-done';
    done.append(icon('check'), 'Done');
    done.addEventListener('click', () => {
      const name = nameInput.value.trim().slice(0, NAME_MAX);
      const problem = !name ? 'Type your name first.' : selected === null ? 'Pick a character.' : '';
      error.textContent = problem;
      error.hidden = !problem;
      if (!name) nameInput.focus();
      if (!problem) finish({ character: selected!, name });
    });
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && done.click());

    panel.append(head, nameField, charLabel, grid, error, done);
    if (!currentName) nameInput.focus();

    function select(i: number) {
      if (selected !== null) {
        const { key, frame } = portraitFrame(selected);
        drawFrame(canvases[selected], textures, key, frame);
      }
      selected = i;
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.character === String(i))));
      buttons[choices.indexOf(i)].scrollIntoView?.({ block: 'nearest' });
    }
    if (selected !== null) select(selected);

    const tick = (t: number) => {
      if (selected !== null) {
        const fs = animationFrames(selected);
        const f = fs[Math.floor(t / (selected < 16 ? 220 : 140)) % fs.length];
        drawFrame(canvases[selected], textures, f.key, f.frame);
      }
      raf = requestAnimationFrame(tick);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);

    function finish(result: { character: number; name: string } | null, remove = true) {
      cancelAnimationFrame(raf);
      if (remove) scrim.remove();
      resolve(result);
    }
  });
}
