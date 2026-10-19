import { bounds, ROOMS } from './rooms';
import { TILE } from './projection';
import { icon } from '../ui/icons';
import { isTouchDevice } from '../ui/joystick';
import { overlay } from '../ui/overlay';
import { currentUser } from '../net/profile';
import { arcadeBoard, submitArcade } from '../net/arcade';
import type { HouseScene } from '../scenes/HouseScene';

// The arcade cabinets (any 'arcade_*' furniture in src/house/rooms.ts): stand in front of one for
// "Play Night Raid" (E). The game loads only when it's first opened. (Part of the house scene.)

// Where you stand to play each cabinet: just below it (world px). Cabinets are 18 × 32 px.
export const ARCADE_SPOTS = ROOMS.flatMap((r) => {
  const b = bounds(r.polygon);
  return r.furniture.filter(([name]) => name.startsWith('arcade_')).map(([, fx, fy]) => ({ x: (b.x + fx) * TILE + 9, y: (b.y + fy) * TILE + 32 + 8 }));
});
export const nearArcade = (x: number, y: number) => ARCADE_SPOTS.some((s) => Math.abs(s.x - x) < 14 && Math.abs(s.y - y) < 14);

export function showArcadePrompt(this: HouseScene, on: boolean) {
  if (on === !!this.arcadePrompt) return;
  this.arcadePrompt?.remove();
  this.arcadePrompt = null;
  if (!on) return;
  const box = document.createElement('div');
  box.className = 'v2-act';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dh-btn';
  b.id = 'arcade-prompt';
  b.append(icon('gamepad-2'), document.createTextNode('Play Night Raid'));
  if (!isTouchDevice()) {
    const k = document.createElement('kbd');
    k.textContent = 'E';
    b.append(k);
  }
  b.addEventListener('click', () => void this.openArcade());
  box.append(b);
  overlay().append(box);
  this.arcadePrompt = box;
}

export async function openArcade(this: HouseScene) {
  const { openNightRaid } = await import('../games/nightRaid');
  this.body.setVelocity(0, 0);
  this.canMove = false;
  openNightRaid({
    me: () => ({ id: this.presence?.id ?? '', skin: this.character, guest: !!currentUser()?.guest }),
    submit: async (score, waves, ms) => {
      const r = await submitArcade(score, waves, ms);
      if (r.ok && r.progress) this.gotProgress(r.progress);
      if (r.ok && r.record && r.xp) this.cheer(); // "!" over your head for everyone
      return r;
    },
    board: arcadeBoard,
    onClose: () => (this.canMove = true),
  });
}
