import Phaser from 'phaser';
import { AMBIENT, animalFrame, type AnimalKey } from '../house/animals';
import { depthOf, toScreen } from '../house/projection';
import type { Zones } from '../house/zones';
import type { Pt, WalkGrid } from './pathfind';
import { animalsOn } from '../net/houseSettings';

// Animals that live in the house (REDESIGN.md R4): each room's animals (src/house/animals.ts AMBIENT)
// sit for a while, then wander to another free spot in their room along the walking grid, and sit again.
// Purely local: nothing is sent, so they cost no Realtime messages (UPDATE.md §6 budget).
const SPEED = 22; // px per second: an amble
const STEP_MS = 160; // the moving frame flips this often
type Wanderer = { key: AnimalKey; room: string; img: Phaser.GameObjects.Image; path: Pt[]; until: number; at: Pt };

export class HouseAnimals {
  private list: Wanderer[] = [];

  constructor(
    scene: Phaser.Scene,
    private zones: Zones,
    private grid: WalkGrid,
  ) {
    for (const [room, keys] of Object.entries(AMBIENT)) {
      for (const key of keys) {
        const at = this.spotIn(room);
        if (!at) continue;
        const img = scene.add.image(0, 0, 'animals', animalFrame(key, false)).setOrigin(0.5, 1);
        const w: Wanderer = { key, room, img, path: [], until: scene.time.now + Phaser.Math.Between(500, 4000), at };
        this.place(w);
        this.list.push(w);
      }
    }
  }

  // A random free spot (feet, world px) in a room, or null.
  private spotIn(room: string): Pt | null {
    const box = this.zones.box(room);
    if (!box) return null;
    for (let i = 0; i < 30; i++) {
      const p = { x: Phaser.Math.Between(box.x + 8, box.x + box.w - 8), y: Phaser.Math.Between(box.y + 8, box.y + box.h - 8) };
      if (this.zones.at(p.x, p.y) === room && this.grid.freeAt(p)) return p;
    }
    return null;
  }

  private place(w: Wanderer) {
    const s = toScreen(w.at.x, w.at.y);
    w.img.setPosition(Math.round(s.x), Math.round(s.y)).setDepth(depthOf(w.at.x, w.at.y));
  }

  update(now: number, dt: number) {
    for (const w of this.list) {
      // Switched off on the admin page (everywhere, or this room): out of sight until it's back on.
      const on = animalsOn(w.room);
      if (w.img.visible !== on) w.img.setVisible(on);
      if (!on) continue;
      if (!w.path.length) {
        w.img.setFrame(animalFrame(w.key, false));
        if (now < w.until) continue;
        const to = this.spotIn(w.room);
        const path = to && this.grid.find(w.at, to);
        // Not too far in one go; otherwise sit a bit longer.
        w.path = path && path.length < 8 ? path : [];
        w.until = now + Phaser.Math.Between(3000, 9000);
        continue;
      }
      const next = w.path[0];
      const dx = next.x - w.at.x;
      const dy = next.y - w.at.y;
      const d = Math.hypot(dx, dy);
      const step = (SPEED * dt) / 1000;
      if (d <= step) {
        w.at = { ...next };
        w.path.shift();
      } else {
        w.at = { x: w.at.x + (dx / d) * step, y: w.at.y + (dy / d) * step };
      }
      if (Math.abs(dx) > 0.5) w.img.setFlipX(dx < 0); // the art faces right
      w.img.setFrame(animalFrame(w.key, Math.floor(now / STEP_MS) % 2 === 0));
      this.place(w);
    }
  }

  // For tests: where everyone is.
  get state() {
    return this.list.map((w) => ({ key: w.key, room: w.room, x: Math.round(w.at.x), y: Math.round(w.at.y), zone: this.zones.at(w.at.x, w.at.y) }));
  }
}

// A pet: follows its owner a little behind, hops along when far, sits when close. Everyone draws it from
// the owner's position, so it needs no messages of its own.
export class PetSprite {
  readonly img: Phaser.GameObjects.Image;
  private at: Pt;

  constructor(
    scene: Phaser.Scene,
    readonly key: AnimalKey,
    from: Pt,
  ) {
    this.at = { x: from.x - 14, y: from.y + 2 };
    this.img = scene.add.image(0, 0, 'animals', animalFrame(key, false)).setOrigin(0.5, 1);
  }

  // `owner`: the owner's feet (world px); `facing`: which way they look, so the pet trails behind.
  update(owner: Pt, facing: 'down' | 'up' | 'left' | 'right', visible: boolean, now: number, dt: number) {
    // Behind and a little to the side, so it never hides under its owner.
    const back = { down: { x: 13, y: -5 }, up: { x: -13, y: 6 }, left: { x: 14, y: 2 }, right: { x: -14, y: 2 } }[facing];
    const target = { x: owner.x + back.x, y: owner.y + back.y };
    const dx = target.x - this.at.x;
    const dy = target.y - this.at.y;
    const d = Math.hypot(dx, dy);
    const moving = d > 4;
    if (d > 160) this.at = { ...target }; // left far behind (a jump across the map): catch up at once
    else if (moving) {
      const step = Math.min(d, (Math.max(40, d * 4) * dt) / 1000);
      this.at = { x: this.at.x + (dx / d) * step, y: this.at.y + (dy / d) * step };
    }
    if (Math.abs(dx) > 1) this.img.setFlipX(dx < 0);
    else if (!moving) this.img.setFlipX(owner.x < this.at.x);
    this.img.setFrame(animalFrame(this.key, moving && Math.floor(now / STEP_MS) % 2 === 0));
    const s = toScreen(this.at.x, this.at.y);
    this.img.setPosition(Math.round(s.x), Math.round(s.y)).setDepth(depthOf(this.at.x, this.at.y)).setVisible(visible);
  }

  get pos() {
    return { ...this.at };
  }

  destroy() {
    this.img.destroy();
  }
}
