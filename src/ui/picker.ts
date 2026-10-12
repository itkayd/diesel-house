import type Phaser from 'phaser';
import { CHARACTER_COUNT, portraitFrame } from '../characters';
import { overlay } from './overlay';

const SCALE = 3;

function portrait(textures: Phaser.Textures.TextureManager, index: number) {
  const { key, frame } = portraitFrame(index);
  const f = textures.getFrame(key, frame);
  const c = document.createElement('canvas');
  c.width = 16 * SCALE;
  c.height = 32 * SCALE;
  c.style.cssText = 'image-rendering:pixelated;display:block;margin:0 auto';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, 16, 32, 0, 0, c.width, c.height);
  return c;
}

// Full-screen grid of characters. Resolves with the chosen index.
export function pickCharacter(textures: Phaser.Textures.TextureManager, current: number | null): Promise<number> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.style.cssText = `position:absolute;inset:0;pointer-events:auto;background:rgba(15,15,22,.92);overflow-y:auto;
      display:flex;flex-direction:column;align-items:center;padding:calc(20px + env(safe-area-inset-top)) 16px 24px;box-sizing:border-box`;
    const title = document.createElement('h2');
    title.textContent = 'Pick your character';
    title.style.cssText = 'margin:0 0 16px;font-size:20px;font-weight:600';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:10px;width:100%;max-width:520px';

    for (let i = 0; i < CHARACTER_COUNT; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Character ${i + 1}`);
      b.dataset.character = String(i);
      const selected = i === current;
      b.style.cssText = `padding:8px 0;border-radius:12px;cursor:pointer;background:${selected ? 'rgba(255,211,77,.25)' : 'rgba(255,255,255,.08)'};
        border:2px solid ${selected ? '#ffd34d' : 'transparent'}`;
      b.appendChild(portrait(textures, i));
      b.addEventListener('click', () => {
        panel.remove();
        resolve(i);
      });
      grid.appendChild(b);
    }
    panel.append(title, grid);
    overlay().appendChild(panel);
  });
}

// Small round button (top-right) that reopens the picker.
export function addChangeCharacterButton(onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Change character';
  b.style.cssText = `position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;pointer-events:auto;padding:6px 12px;border:0;
    border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font:14px system-ui,sans-serif;cursor:pointer`;
  b.addEventListener('click', onClick);
  overlay().appendChild(b);
}
