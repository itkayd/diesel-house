import Phaser from 'phaser';
import type { SpotId } from '../games/table';

// Game spots on the map (maps/house.tmj "spots", UPDATE.md Phase 12): the games table at the west end of
// the hallway and the room tables. Each gets a little bobbing "Games" sign (design/game/v2.html .v2-sign);
// the hallway table has two dice on it. Standing within NEAR px of a spot offers "Play games".

const NEAR = 34;
const LAMP = 0xf4b860;
const EDGE = 0x0d0912;

export class GameSpots {
  readonly spots: { id: SpotId; x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap) {
    for (const o of map.getObjectLayer('spots')?.objects ?? []) this.spots.push({ id: o.name as SpotId, x: o.x!, y: o.y! });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const s of this.spots) {
      const text = scene.add.text(0, 0, 'GAMES', { fontFamily: '"Pixelify Sans", monospace', fontSize: '6px', color: '#0d0912' }).setOrigin(0.5).setResolution(8);
      const w = Math.ceil(text.width) + 6;
      const bg = scene.add.graphics();
      bg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -5, w + 2, 10);
      bg.fillStyle(LAMP, 1).fillRect(-w / 2, -4, w, 8);
      const sign = scene.add.container(s.x, s.y - 56, [bg, text]).setDepth(90_000);
      if (!reduce) scene.tweens.add({ targets: sign, y: s.y - 57, duration: 800, yoyo: true, repeat: -1, ease: 'Stepped' });
    }
    // Two dice on the hallway table (11 px, from the cards pack).
    const hall = this.spots.find((s) => s.id === 'hall');
    if (hall && scene.textures.exists('cards')) {
      for (const [dx, dy, n] of [[-13, -44, 5], [1, -39, 3]] as const)
        scene.add.image(hall.x + dx, hall.y + dy, 'cards', `die_${n}`).setOrigin(0).setScale(11 / 32).setDepth(hall.y - 10);
    }
  }

  // The spot you're standing at, if any.
  near(x: number, y: number): SpotId | null {
    let best: SpotId | null = null;
    let bestD = NEAR;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) [best, bestD] = [s.id, d];
    }
    return best;
  }
}
