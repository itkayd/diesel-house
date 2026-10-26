import type Phaser from 'phaser';
import { DIRS, skinFrame, walkSteps, type Dir, type Skin } from '../characters';

// A character, big, doing a move (the wardrobe and the shop's buy card). Walking turns to face each way;
// attack and jump face the viewer. Still (first frame) when the device asks for reduced motion.
export type Move = 'walk' | 'attack' | 'jump';

export function skinPreview(textures: Phaser.Textures.TextureManager, skin: Skin, cls = 'stage', scale = 4) {
  const canvas = document.createElement('canvas');
  canvas.className = cls;
  canvas.width = canvas.height = 16 * scale;
  let key = skin;
  let move: Move = 'walk';
  let raf = 0;
  const draw = (t: number) => {
    const step = Math.floor(t / 150);
    const dir: Dir = move === 'walk' ? DIRS[Math.floor(t / 2400) % DIRS.length] : 'down';
    const f = move === 'walk' ? skinFrame(key, 'walk', dir, step % walkSteps) : step % 4 < 2 ? skinFrame(key, move, dir) : skinFrame(key, 'idle', dir);
    const fr = textures.getFrame(f.key, f.frame);
    if (!fr) return;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(fr.source.image as CanvasImageSource, fr.cutX, fr.cutY, 16, 16, 0, 0, canvas.width, canvas.height);
  };
  const tick = (t: number) => {
    if (!canvas.isConnected && raf) return; // removed with its card
    draw(t);
    raf = requestAnimationFrame(tick);
  };
  draw(0);
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);
  return {
    canvas,
    show(next: Skin) {
      key = next;
      draw(0);
    },
    move(m: Move) {
      move = m;
    },
    stop: () => cancelAnimationFrame(raf),
  };
}

// Walk · Attack · Jump buttons for a preview.
export function moveButtons(onMove: (m: Move) => void, start: Move = 'walk') {
  const box = document.createElement('div');
  box.className = 'moves';
  for (const m of ['walk', 'attack', 'jump'] as const) {
    const b = document.createElement('button');
    b.className = 'dh-chip';
    b.type = 'button';
    b.textContent = m[0].toUpperCase() + m.slice(1);
    b.dataset.move = m;
    b.setAttribute('aria-pressed', String(m === start));
    b.addEventListener('click', () => {
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onMove(m);
    });
    box.append(b);
  }
  return box;
}
