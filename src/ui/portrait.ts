import type Phaser from 'phaser';
import { asSkin, faceFrame, type Skin } from '../characters';

// Faces for the HUD, menus, chat and boards: each skin's Faceset (38 × 38, from Ninja Adventure), drawn
// crisp at `size` px. Uses the textures Phaser already loaded. Accepts an old character number too
// (older copies of the game send those for one release).
let textures: Phaser.Textures.TextureManager | null = null;
export const setPortraitSource = (t: Phaser.Textures.TextureManager) => (textures = t);

export function portrait(character: Skin | number, size = 32, cls = 'dh-portrait') {
  const c = document.createElement('canvas');
  c.className = cls;
  c.width = c.height = size;
  c.style.width = c.style.height = `${size}px`;
  if (!textures) return c;
  const { key, frame } = faceFrame(asSkin(character));
  const f = textures.getFrame(key, frame);
  if (!f) return c;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, size, size);
  return c;
}

// An animal (src/house/animals.ts), sitting, facing right, at `size` px.
export function animalIcon(key: string, size = 48, frame = 0) {
  const c = document.createElement('canvas');
  c.className = 'dh-animal';
  c.width = c.height = size;
  c.style.width = c.style.height = `${size}px`;
  const f = textures?.getFrame('animals', frame);
  if (!f) return c;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, size, size);
  c.dataset.animal = key;
  return c;
}
