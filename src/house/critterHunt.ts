import Phaser from 'phaser';
import { currentUser } from '../net/profile';
import { play } from '../ui/sounds';
import { modalOpen } from '../ui/modal';
import { buzz } from '../games/juice';
import { critterToast } from '../ui/progressUi';
import { WalkGrid, type Rect } from '../scenes/pathfind';
import { Critters, type Spawn } from '../scenes/critters';
import { critterById, slotAt } from '../critters/critters';
import { canCatch, caughtSlots, catchCritter as tryToCatch } from '../net/critters';
import type { HouseScene } from '../scenes/HouseScene';
import { DEPTH } from './projection';

// Critters in the house: where they can turn up, catching them, and hearing about others' catches.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Where critters can turn up: free floor in the hallway and the rooms, away from the game spots, the
// noticeboard and the front door. Worked out from the map alone, so it's the same on every device.
export function setupCritters(this: HouseScene) {
  const b = this.body;
  const feet = { x: b.offset.x + b.width / 2 - this.player.displayOriginX, y: b.offset.y + b.height / 2 - this.player.displayOriginY };
  const blocked: Rect[] = [];
  this.wallLayer.forEachTile((t) => {
    if (t.index !== -1) blocked.push({ x: t.pixelX, y: t.pixelY, w: t.width, h: t.height });
  });
  for (const o of this.look.solids.getChildren() as Phaser.GameObjects.Rectangle[]) blocked.push({ x: o.x, y: o.y, w: o.width, h: o.height });
  const grid = new WalkGrid(this.wallLayer.width, this.wallLayer.height, blocked, { hw: b.width / 2 + 4, hh: b.height / 2 + 4 });
  const door = this.spawnAt;
  const avoid = [...this.spots.spots, ...(this.spots.board ? [this.spots.board] : []), door];
  const canReach = grid.reachableFrom({ x: door.x + feet.x, y: door.y + feet.y }); // from the front door
  const places = grid
    .freePoints(2)
    .filter(canReach)
    .map((p) => ({ x: p.x - feet.x, y: p.y - feet.y }))
    .filter((p) => this.zones.at(p.x, p.y - 3) !== null && avoid.every((a) => Math.hypot(a.x - p.x, a.y - p.y) > 28));
  this.critters = new Critters(this, places, {
    appeared: (s) => this.critterAppeared(s),
    near: (s) => void this.catchCritter(s),
    people: () => 1 + [...this.remotes.values()].filter((r) => r.active).length,
  });
  // Arriving mid-slot: some may have been caught already.
  void caughtSlots(slotAt(Date.now()) - 1).then((rows) => rows.forEach((r) => this.critters?.markCaught(r.slot, r.idx, r.user_id)));
}

export function zoneOf(this: HouseScene, x: number, y: number) {
  return this.zones.at(x, y - 3);
}

// Critters turned up: one hint, about the ones where we are (or how many are about).
export function critterAppeared(this: HouseScene, list: Spawn[]) {
  if (modalOpen() || document.hidden) return;
  const here = list.filter((s) => this.zoneOf(s.x, s.y) === this.zone);
  if (here.length === 1) {
    const c = critterById(here[0].id)!;
    critterToast(here[0].id, `A ${c.name.toLowerCase()} turned up ${this.zone === 'hallway' ? 'in the Great Hall' : 'in here'}!`, `Walk into it to catch it · +${c.xp} XP`);
  } else if (here.length > 1) {
    critterToast(here[0].id, `${here.length} critters turned up ${this.zone === 'hallway' ? 'in the Great Hall' : 'in here'}!`, 'Walk into them to catch them.');
  } else if (list.length > 1) {
    critterToast(list[0].id, `${list.length} critters are about`, 'Check the map to find them.');
  }
}

export async function catchCritter(this: HouseScene, s: Spawn) {
  const user = currentUser();
  const c = critterById(s.id)!;
  if (user?.guest) {
    critterToast(s.id, `The ${c.name.toLowerCase()} ran off`, 'Only members can catch critters.');
    return;
  }
  // Dev test mode / no Supabase: catch it here only, no XP.
  if (!canCatch() || !this.presence) {
    this.critters?.markCaught(s.slot, s.idx, this.presence?.id ?? 'me');
    this.floatWorld(s.x, s.y - 14, 'Caught!');
    play('coin', 0.8);
    critterToast(s.id, `You caught the ${c.name.toLowerCase()}!`, 'Test mode: no XP.');
    return;
  }
  const r = await tryToCatch(s.slot, s.idx);
  if (r.ok) {
    this.critters?.markCaught(s.slot, s.idx, this.presence.id);
    this.floatWorld(s.x, s.y - 14, `+${r.xp} XP`);
    buzz([15, 30, 15]);
    play('coin', 0.9);
    critterToast(s.id, `You caught the ${c.name.toLowerCase()}!`, `+${r.xp} XP`);
    this.gotProgress(r.progress);
  } else if (r.why === 'taken') {
    this.critters?.markCaught(s.slot, s.idx, r.by ?? '');
    const who = r.by ? (this.remotes.get(r.by)?.info.name ?? 'Someone') : 'Someone';
    critterToast(s.id, `${who} got the ${c.name.toLowerCase()} first`, 'Be quicker next time!');
  } else if (r.why === 'enough') {
    critterToast(s.id, 'That’s 25 catches today', 'The critters need a rest. More tomorrow!');
  } else if (r.why === 'error') {
    critterToast(s.id, 'Couldn’t catch it just now', 'Step off and walk into it again.');
    this.time.delayedCall(2000, () => this.critters?.retry(s.slot, s.idx)); // couldn't reach the database: try again
  }
}

// Pixel text rising out of the world (a catch).
export function floatWorld(this: HouseScene, x: number, y: number, text: string) {
  const t = this.add
    .text(x, y, text, { fontFamily: '"Pixelify Sans", monospace', fontSize: '8px', color: '#ffd36b', stroke: '#0d0912', strokeThickness: 3, resolution: 4 })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.tag);
  this.tweens.add({ targets: t, y: y - 18, alpha: { from: 1, to: 0 }, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
}

// Someone caught a critter (live, from the database).
export function someoneCaught(this: HouseScene, c: { slot: number; idx: number; user_id: string; critter: string; xp: number }) {
  const had = this.critters?.current.some((s) => s.slot === c.slot && s.idx === c.idx);
  this.critters?.markCaught(c.slot, c.idx, c.user_id);
  if (c.user_id === this.presence?.id || !had) return;
  const r = this.remotes.get(c.user_id);
  if (!r?.active || r.info.zone !== this.zone) return;
  critterToast(c.critter, `${r.info.name} caught the ${critterById(c.critter)?.name.toLowerCase() ?? 'critter'}`, `+${c.xp} XP`);
}
