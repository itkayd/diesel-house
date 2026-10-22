import Phaser from 'phaser';
import { ART_SIZE, paintCritter } from '../critters/art';
import { critterAt, CRITTERS, countFor, placesFor, slotAt, SLOT_MS, type CritterId } from '../critters/critters';
import type { Pt } from './pathfind';
import { depthOf, toScreen } from '../house/projection';

// Critters in the world: the ones for this 2-minute slot (src/critters/critters.ts) hop about on their
// spots until someone walks into them or the slot ends. How many depends on how many people are in the
// house (one each, plus a coin-flip extra); if more people arrive mid-slot, more turn up. Every device
// works out the same critters and spots; catches come from the database (src/net/critters.ts) and arrive
// live for everyone, so a caught critter disappears for all.

const NEAR = 14; // px from your feet to catch it
export type Spawn = { slot: number; idx: number; id: CritterId; x: number; y: number };
type Shown = { spawn: Spawn; img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Ellipse; hop: Phaser.Tweens.Tween | null };

const key = (slot: number, idx: number) => `${slot}:${idx}`;

export class Critters {
  private slot = -1;
  private count = 0;
  private spawns: Spawn[] = [];
  private shown = new Map<number, Shown>(); // idx -> sprite
  private caught = new Map<string, string>(); // "slot:idx" -> who caught it
  private given = new Set<string>(); // critters we stopped trying for this slot (too late, daily limit…)

  constructor(
    private scene: Phaser.Scene,
    readonly places: Pt[],
    private h: {
      appeared: (s: Spawn[]) => void; // new critters turned up (all at once)
      near: (s: Spawn) => void; // walked into one (asked once per critter until `retry` or caught)
      people: () => number; // how many are in the house (you included)
    },
    public now: () => number = () => Date.now(), // (tests set a pretend clock)
  ) {
    for (const c of CRITTERS) {
      const k = `critter-${c.id}`;
      if (scene.textures.exists(k)) continue;
      const tex = scene.textures.createCanvas(k, ART_SIZE, ART_SIZE)!;
      paintCritter(tex.getContext(), c.id);
      tex.refresh();
    }
  }

  // The critters still to catch right now.
  get current(): Spawn[] {
    return this.spawns.filter((s) => !this.caught.has(key(s.slot, s.idx)));
  }

  // Seconds until this slot ends (they wander off).
  get secondsLeft() {
    return Math.max(0, Math.ceil(((this.slot + 1) * SLOT_MS - this.now()) / 1000));
  }

  update(feet: { x: number; y: number }) {
    const slot = slotAt(this.now());
    if (slot !== this.slot) this.newSlot(slot);
    else this.grow();
    for (const s of this.current) {
      const k = key(s.slot, s.idx);
      if (this.given.has(k) || Math.hypot(feet.x - s.x, feet.y - s.y) >= NEAR) continue;
      this.given.add(k); // one try per critter; markCaught / retry decide what happens next
      this.h.near(s);
    }
  }

  // Switched off on the admin page: they all wander off; when it's back on, the next update brings this
  // slot's critters back.
  clear() {
    for (const idx of [...this.shown.keys()]) this.hide(idx, false);
    this.slot = -1;
  }

  // Try that one again (e.g. the database couldn't be reached).
  retry(slot: number, idx: number) {
    this.given.delete(key(slot, idx));
  }

  markCaught(slot: number, idx: number, by: string) {
    this.caught.set(key(slot, idx), by);
    if (slot === this.slot) this.hide(idx, true);
  }

  private newSlot(slot: number) {
    this.slot = slot;
    for (const idx of [...this.shown.keys()]) this.hide(idx, false);
    this.spawns = []; // a quiet slot has none (the last ones have wandered off)
    this.count = 0;
    for (const k of [...this.caught.keys()]) if (Number(k.split(':')[0]) < slot - 2) this.caught.delete(k);
    for (const k of [...this.given]) if (Number(k.split(':')[0]) < slot - 2) this.given.delete(k);
    this.grow();
  }

  // Bring the number of critters up to what the people in the house call for (never fewer mid-slot).
  private grow() {
    if (!this.places.length || !critterAt(this.slot, 0)) return;
    const want = countFor(this.slot, this.h.people());
    if (want <= this.count) return;
    const at = placesFor(this.slot, want, this.places.length);
    const added: Spawn[] = [];
    for (let idx = this.count; idx < want; idx++) {
      const id = critterAt(this.slot, idx);
      if (!id) continue;
      const p = this.places[at[idx]];
      const s: Spawn = { slot: this.slot, idx, id, x: p.x, y: p.y };
      this.spawns.push(s);
      if (this.caught.has(key(s.slot, idx))) continue;
      this.show(s);
      added.push(s);
    }
    this.count = want;
    if (added.length) this.h.appeared(added);
  }

  private show(s: Spawn) {
    const at = toScreen(s.x, s.y);
    const shadow = this.scene.add.ellipse(at.x, at.y, 10, 3, 0x0d0912, 0.35).setDepth(depthOf(s.x, s.y) - 1);
    const img = this.scene.add.image(at.x, at.y, `critter-${s.id}`).setOrigin(0.5, 1).setDepth(depthOf(s.x, s.y));
    const hop = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : this.scene.tweens.add({ targets: img, y: at.y - 3, duration: 180, yoyo: true, repeat: -1, repeatDelay: 700 + s.idx * 130, ease: 'Stepped' });
    this.shown.set(s.idx, { spawn: s, img, shadow, hop });
  }

  private hide(idx: number, poof: boolean) {
    const sh = this.shown.get(idx);
    if (!sh) return;
    this.shown.delete(idx);
    sh.hop?.remove();
    sh.shadow.destroy();
    if (!poof) return void sh.img.destroy();
    // A little jump up and fade, with pixel sparkles flying out.
    this.scene.tweens.add({ targets: sh.img, y: sh.img.y - 14, alpha: 0, duration: 420, ease: 'Stepped', onComplete: () => sh.img.destroy() });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cols = [0xffd36b, 0xf4b860, 0x6fdc8c, 0x9ec9ff, 0xff9fb2];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const bit = this.scene.add.rectangle(sh.spawn.x, sh.spawn.y - 6, 2, 2, cols[i % cols.length]).setDepth(depthOf(sh.spawn.x, sh.spawn.y) + 50);
      this.scene.tweens.add({
        targets: bit,
        x: sh.spawn.x + Math.cos(a) * 16,
        y: sh.spawn.y - 6 + Math.sin(a) * 12 - 4,
        alpha: 0,
        duration: 500,
        ease: 'Cubic.easeOut',
        onComplete: () => bit.destroy(),
      });
    }
  }

  // Shown sprites (read by automated checks).
  get sprites() {
    return this.shown.size;
  }
}
