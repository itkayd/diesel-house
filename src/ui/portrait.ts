import type Phaser from 'phaser';
import { portraitFrame } from '../characters';

// Face crops of characters for the HUD (volume popover, knock toasts, chat): a 16x16 crop of the
// front-facing pose, drawn crisp at `size` px. Uses the textures Phaser already loaded.
let textures: Phaser.Textures.TextureManager | null = null;
export const setPortraitSource = (t: Phaser.Textures.TextureManager) => (textures = t);

// Where the face sits in each sheet's 16x32 frame (chibis are small and stand low in theirs).
export const faceTop = (character: number) => (character < 16 ? 10 : 8);

export function portrait(character: number, size = 32, cls = 'dh-portrait') {
  const c = document.createElement('canvas');
  c.className = cls;
  c.width = c.height = size;
  c.style.width = c.style.height = `${size}px`;
  if (!textures) return c;
  const { key, frame } = portraitFrame(character);
  const f = textures.getFrame(key, frame);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY + faceTop(character), 16, 16, 0, 0, size, size);
  return c;
}
