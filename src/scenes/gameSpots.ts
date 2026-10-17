import Phaser from 'phaser';
import type { SpotId } from '../games/table';

export type SpotKind = 'table' | 'sofa';

// Game spots on the map (maps/house.tmj "spots", UPDATE.md Phase 12): the games table at the west end of
// the hallway and the room tables. Each gets a little bobbing "Games" sign (design/game/v2.html .v2-sign);
// the hallway table has two dice on it. Standing within NEAR px of a spot offers "Play games".
// Rooms without a table have a sofa corner instead (kind 'sofa'): only the games that need no table.

const NEAR = 34;
const LAMP = 0xf4b860;
const EDGE = 0x0d0912;

export class GameSpots {
  readonly spots: { id: SpotId; x: number; y: number; kind: SpotKind }[] = [];
  // The noticeboard (Phase 14): where you stand to read it.
  board: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap) {
    for (const o of map.getObjectLayer('spots')?.objects ?? []) {
      const props = (o.properties as { name: string; value: unknown }[] | undefined) ?? [];
      const prop = (n: string) => props.find((p) => p.name === n)?.value;
      if (prop('kind') === 'board') {
        this.board = { x: o.x!, y: o.y! };
        drawBoard(scene, Number(prop('boardX')), Number(prop('boardY')));
        continue;
      }
      const kind = prop('kind') === 'sofa' ? 'sofa' : 'table';
      this.spots.push({ id: o.name as SpotId, x: o.x!, y: o.y!, kind });
    }
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

  // Standing at the noticeboard (and not at a games spot, which wins when both are close).
  nearBoard(x: number, y: number) {
    return !!this.board && Math.hypot(this.board.x - x, this.board.y - y) < 26 && !this.near(x, y);
  }

  kind(id: SpotId): SpotKind | null {
    return this.spots.find((s) => s.id === id)?.kind ?? null;
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

// A cork board with pinned notes (design/game/v2.html .v2-board), 30 x 20 px, on the wall.
function drawBoard(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(3);
  g.fillStyle(EDGE, 1).fillRect(x - 1, y - 1, 32, 22);
  g.fillStyle(0x6b3f22, 1).fillRect(x, y, 30, 20);
  g.fillStyle(0xa8743f, 1).fillRect(x + 2, y + 2, 26, 16);
  [0xffe9a8, 0xffb3c7, 0x9ec9ff, 0x9be0a8, 0xfff4e0].forEach((c, i) => {
    const nx = x + 3 + (i % 3) * 8;
    const ny = y + 3 + Math.floor(i / 3) * 8;
    g.fillStyle(0x000000, 0.25).fillRect(nx + 1, ny + 1, 6, 6);
    g.fillStyle(c, 1).fillRect(nx, ny, 6, 6);
    g.fillStyle(0xd94f4f, 1).fillRect(nx + 2, ny, 2, 1);
  });
  // A little "CHALLENGES" sign above it, like the games signs.
  const text = scene.add.text(0, 0, 'CHALLENGES', { fontFamily: '"Pixelify Sans", monospace', fontSize: '6px', color: '#0d0912' }).setOrigin(0.5).setResolution(8);
  const w = Math.ceil(text.width) + 6;
  const bg = scene.add.graphics();
  bg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -5, w + 2, 10);
  bg.fillStyle(LAMP, 1).fillRect(-w / 2, -4, w, 8);
  scene.add.container(x + 15, y - 9, [bg, text]).setDepth(90_000);
}
