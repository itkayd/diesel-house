import Phaser from 'phaser';
import { ART_SIZE, paintCritter } from '../critters/art';
import { critterFor, CRITTERS, placeFor, slotAt, SLOT_MS, type CritterId } from '../critters/critters';
import type { Pt } from './pathfind';

// Critters in the world: the one for this 2-minute slot (src/critters/critters.ts) hops about on its spot
// until someone walks into it or the slot ends. Every device works out the same critter and the same
// spot; catches come from the database (src/net/critters.ts) and arrive live for everyone.

const NEAR = 14; // px from your feet to catch it
export type Spawn = { slot: number; id: CritterId; x: number; y: number };

export class Critters {
  private slot = -1;
  private spawn: Spawn | null = null;
  private img: Phaser.GameObjects.Image | null = null;
  private shadow: Phaser.GameObjects.Ellipse | null = null;
  private hop: Phaser.Tweens.Tween | null = null;
  private caught = new Map<number, string>(); // slot -> who caught it
  private given = new Set<number>(); // slots we stopped trying (too late, daily limit…)

  constructor(
    private scene: Phaser.Scene,
    readonly places: Pt[],
    private h: {
      appeared: (s: Spawn) => void;
      near: (s: Spawn) => void; // walked into it (asked once per slot until `giveUp` or caught)
    },
    public now: () => number = () => Date.now(), // (tests set a pretend clock)
  ) {
    for (const c of CRITTERS) {
      const key = `critter-${c.id}`;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, ART_SIZE, ART_SIZE)!;
      paintCritter(tex.getContext(), c.id);
      tex.refresh();
    }
  }

  get current() {
    return this.spawn && !this.caught.has(this.spawn.slot) ? this.spawn : null;
  }

  // Seconds until this slot ends (the critter wanders off).
  get secondsLeft() {
    return Math.max(0, Math.ceil(((this.slot + 1) * SLOT_MS - this.now()) / 1000));
  }

  update(feet: { x: number; y: number }) {
    const slot = slotAt(this.now());
    if (slot !== this.slot) this.newSlot(slot);
    const s = this.current;
    if (!s || this.given.has(s.slot)) return;
    if (Math.hypot(feet.x - s.x, feet.y - s.y) < NEAR) {
      this.given.add(s.slot); // one try per slot; markCaught / giveUp decide what happens next
      this.h.near(s);
    }
  }

  // Try again later in this slot (e.g. the database couldn't be reached).
  retry(slot: number) {
    this.given.delete(slot);
  }

  markCaught(slot: number, by: string) {
    this.caught.set(slot, by);
    if (this.spawn?.slot === slot) this.remove(true);
  }

  caughtBy(slot: number) {
    return this.caught.get(slot) ?? null;
  }

  private newSlot(slot: number) {
    this.slot = slot;
    this.remove(false);
    for (const k of [...this.caught.keys()]) if (k < slot - 2) this.caught.delete(k);
    const id = critterFor(slot);
    if (!id || !this.places.length) return;
    const p = this.places[placeFor(slot, this.places.length)];
    this.spawn = { slot, id, x: p.x, y: p.y };
    if (this.caught.has(slot)) return;
    this.show(this.spawn);
    this.h.appeared(this.spawn);
  }

  private show(s: Spawn) {
    this.shadow = this.scene.add.ellipse(s.x, s.y, 10, 3, 0x0d0912, 0.35).setDepth(s.y - 1);
    this.img = this.scene.add.image(s.x, s.y, `critter-${s.id}`).setOrigin(0.5, 1).setDepth(s.y);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      this.hop = this.scene.tweens.add({ targets: this.img, y: s.y - 3, duration: 180, yoyo: true, repeat: -1, repeatDelay: 900, ease: 'Stepped' });
  }

  private remove(poof: boolean) {
    this.hop?.remove();
    this.hop = null;
    const img = this.img;
    this.shadow?.destroy();
    this.shadow = null;
    this.img = null;
    if (!img) return;
    if (!poof) return void img.destroy();
    // A little jump up and fade.
    this.scene.tweens.add({ targets: img, y: img.y - 14, alpha: 0, duration: 420, ease: 'Stepped', onComplete: () => img.destroy() });
  }
}
