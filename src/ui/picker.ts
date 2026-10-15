import type Phaser from 'phaser';
import { createElement, UserRound, X } from 'lucide';
import { CHARACTER_COUNT, characterFrames, portraitFrame } from '../characters';
import { NAME_MAX } from '../prefs';
import { hudButtons, overlay } from './overlay';

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
  c.style.cssText = 'image-rendering:pixelated;display:block;margin:0 auto;width:48px;height:96px';
  const { key, frame } = portraitFrame(index);
  drawFrame(c, textures, key, frame);
  return c;
}

// The selected character moves gently: LimeZu ones breathe (idle strip), chibis step in place.
function animationFrames(index: number) {
  const f = characterFrames(index);
  return index < 16 ? f.walk.down : f.idle.down;
}

// Name + character card. Resolves with the choice, or null if closed without changing (only possible
// when `canClose`, i.e. not the first launch).
export function pickCharacter(
  textures: Phaser.Textures.TextureManager,
  current: number | null,
  currentName: string | null,
  canClose = current !== null && currentName !== null,
): Promise<{ character: number; name: string } | null> {
  return new Promise((resolve) => {
    let selected = current;
    let raf = 0;
    const backdrop = document.createElement('div');
    backdrop.id = 'picker';
    backdrop.style.cssText = `position:absolute;inset:0;pointer-events:auto;background:rgba(20,15,28,.82);overflow-y:auto;
      display:flex;justify-content:center;align-items:flex-start;padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box`;
    const card = document.createElement('div');
    card.className = 'dh-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'picker-title');
    card.style.cssText = 'width:min(100%,520px);box-sizing:border-box;padding:20px;display:grid;gap:16px;margin:auto 0';

    const head = document.createElement('div');
    head.className = 'dh-sheet-head';
    const title = document.createElement('h2');
    title.id = 'picker-title';
    title.className = 'dh-title';
    title.textContent = canClose ? 'You' : 'Who are you?';
    head.append(title);
    if (canClose) {
      const close = document.createElement('button');
      close.type = 'button';
      close.id = 'picker-close';
      close.className = 'dh-icon-btn dh-sheet-close';
      close.setAttribute('aria-label', 'Close');
      close.append(createElement(X, { width: 22, height: 22 }));
      close.addEventListener('click', () => finish(null));
      head.append(close);
    }

    const nameField = document.createElement('div');
    const nameLabel = document.createElement('label');
    nameLabel.className = 'dh-label';
    nameLabel.textContent = 'Your name';
    const nameInput = document.createElement('input');
    nameInput.id = 'player-name';
    nameInput.className = 'dh-input';
    nameLabel.htmlFor = nameInput.id;
    nameInput.maxLength = NAME_MAX;
    nameInput.value = currentName ?? '';
    nameInput.placeholder = 'What your friends call you';
    nameInput.setAttribute('autocomplete', 'nickname');
    nameField.append(nameLabel, nameInput);

    const charLabel = document.createElement('div');
    charLabel.className = 'dh-label';
    charLabel.id = 'picker-characters';
    charLabel.textContent = 'Your character';
    const grid = document.createElement('div');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-labelledby', 'picker-characters');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:10px';
    const buttons: HTMLButtonElement[] = [];
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < CHARACTER_COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Character ${i + 1}`);
      b.dataset.character = String(i);
      b.style.cssText = 'padding:6px 0;border:0;border-radius:var(--radius);cursor:pointer;background:var(--panel-edge)';
      const c = portrait(textures, i);
      canvases.push(c);
      b.appendChild(c);
      b.addEventListener('click', () => select(i));
      buttons.push(b);
      grid.appendChild(b);
    }

    const error = document.createElement('p');
    error.id = 'picker-error';
    error.style.cssText = 'margin:0;color:var(--error);font-size:14px';
    error.hidden = true;
    const done = document.createElement('button');
    done.type = 'button';
    done.id = 'picker-done';
    done.className = 'dh-btn primary';
    done.textContent = 'Done';
    done.addEventListener('click', () => {
      const name = nameInput.value.trim().slice(0, NAME_MAX);
      const problem = !name ? 'Type your name first.' : selected === null ? 'Pick a character.' : '';
      error.textContent = problem;
      error.hidden = !problem;
      nameInput.classList.toggle('invalid', !name);
      if (!name) nameInput.focus();
      if (!problem) finish({ character: selected!, name });
    });
    nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && done.click());

    card.append(head, nameField, charLabel, grid, error, done);
    backdrop.append(card);
    overlay().appendChild(backdrop);
    if (!currentName) nameInput.focus();

    function select(i: number) {
      if (selected !== null) {
        const { key, frame } = portraitFrame(selected);
        drawFrame(canvases[selected], textures, key, frame);
      }
      selected = i;
      buttons.forEach((b, j) => {
        b.setAttribute('aria-checked', String(j === i));
        b.style.boxShadow = j === i ? '0 0 0 3px var(--lamp)' : 'none';
        b.style.background = j === i ? 'var(--panel-hi)' : 'var(--panel-edge)';
      });
      buttons[i].scrollIntoView?.({ block: 'nearest' });
    }
    if (selected !== null) select(selected);

    const frames = (i: number) => animationFrames(i);
    const tick = (t: number) => {
      if (selected !== null) {
        const fs = frames(selected);
        const f = fs[Math.floor(t / (selected < 16 ? 220 : 140)) % fs.length];
        drawFrame(canvases[selected], textures, f.key, f.frame);
      }
      raf = requestAnimationFrame(tick);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);

    function finish(result: { character: number; name: string } | null) {
      cancelAnimationFrame(raf);
      backdrop.remove();
      resolve(result);
    }
  });
}

// Profile button (top-right) that reopens the picker.
export function addProfileButton(onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'profile-button';
  b.className = 'dh-icon-btn';
  b.setAttribute('aria-label', 'You: name and character');
  b.append(createElement(UserRound, { width: 22, height: 22 }));
  b.addEventListener('click', onClick);
  hudButtons().prepend(b);
}
