import Phaser from 'phaser';
import { TILE_SIZE, type RoomId, type Zone } from '../config';
import { zoneLabel } from '../ui/overlay';
import { toast } from '../ui/toasts';
import { friendMenuOpen } from '../ui/friendMenu';
import { WalkGrid, type Rect } from '../scenes/pathfind';
import { critterById } from '../critters/critters';
import type { HouseScene } from '../scenes/HouseScene';
import { SPEED, SLOW, Remote } from './consts';
import { toWorld } from './projection';

// Moving: keys, joystick and tap-to-walk, walking somewhere by itself (Who's where), and the camera.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// About 19x12 tiles in view (design/game/mvp.html `fit`).
// Whole-number zoom only (2, 3 or 4: keeps pixels sharp). Phones fire resize when the address bar slides
// in or out and when the keyboard opens, so only re-fit when the size really changes (over 20%), never
// while typing, or when forced (first time, phone turned). Then re-centre on the player.
export function fitCamera(this: HouseScene, force = false) {
  const { width, height } = this.scale;
  if (!force) {
    const typing = document.activeElement instanceof HTMLElement && !!document.activeElement.closest('input, textarea, select');
    if (typing) return;
    const changed = (a: number, b: number) => !b || Math.abs(a - b) / b > 0.2;
    if (!changed(width, this.fitSize.w) && !changed(height, this.fitSize.h)) return;
  }
  this.fitSize = { w: width, h: height };
  const cam = this.cameras.main;
  const zoom = Phaser.Math.Clamp(Math.floor(Math.min(width / (19 * TILE_SIZE), height / (12 * TILE_SIZE))), 2, 4);
  if (zoom !== cam.zoom) cam.setZoom(zoom);
  if (this.player) cam.centerOn(this.player.x, this.player.y);
}

export function inputVelocity(this: HouseScene) {
  const v = this.manualVelocity();
  if (v.lengthSq() > 0) {
    this.autoPath = null; // any move of your own stops walking by itself
    this.autoDoor = null;
    return v;
  }
  return this.autoVelocity();
}

export function manualVelocity(this: HouseScene) {
  // Typing in a box (chat, names) must never walk your character around.
  const focus = document.activeElement;
  if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || focus instanceof HTMLSelectElement) {
    if (!this.joystick || !(this.joystick.vector.x || this.joystick.vector.y)) return new Phaser.Math.Vector2(0, 0);
  }
  // Joystick wins over everything else. Rounded to 8 directions and 2 speeds so thumb wobble
  // doesn't count as a change of movement (each change is a network message).
  if (this.joystick && (this.joystick.vector.x || this.joystick.vector.y)) {
    const { x, y } = this.joystick.vector;
    return eightWay(x, y).scale(Math.hypot(x, y) < 0.6 ? SPEED * SLOW : SPEED);
  }

  const k = this.keys;
  let vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
  let vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);

  // Mouse: hold to walk towards the pointer. Touch uses the joystick instead.
  const p = this.input.activePointer;
  if (!p.isDown) this.tappedAvatar = false;
  if (!vx && !vy && p.isDown && !p.wasTouch && !this.tappedAvatar && !friendMenuOpen()) {
    const tap = toWorld(p.worldX, p.worldY);
    const dx = tap.x - this.player.x;
    const dy = tap.y - (this.player.y - 8);
    if (Math.hypot(dx, dy) > 4) return eightWay(dx, dy).scale(SPEED);
  }
  const v = new Phaser.Math.Vector2(vx, vy);
  return v.lengthSq() > 0 ? v.normalize().scale(SPEED) : v;
}

export function whosWhere(this: HouseScene) {
  const here = (r: Remote) => r.info.zone ?? null;
  return {
    size: { w: this.wallLayer.width, h: this.wallLayer.height },
    zones: this.zones.ids.map((z) => ({ name: z, rect: this.zones.box(z)!, outline: this.zones.outline(z) })),
    me: { x: this.player.x, y: this.player.y, zone: this.zone },
    people: [...this.remotes.values()]
      .filter((r) => r.active)
      .map((r) => ({
        id: r.info.id,
        name: r.info.name,
        character: r.info.character,
        x: r.avatar.sprite.x,
        y: r.avatar.sprite.y,
        zone: here(r),
        talking: !!here(r) && here(r) !== 'hallway' && this.countIn(here(r)!) > 1,
      })),
    label: (z: Zone) => zoneLabel(z),
    critters: (this.critters?.current ?? []).map((s) => ({ id: s.id, name: critterById(s.id)!.name, x: s.x, y: s.y, zone: this.zoneOf(s.x, s.y) })),
    critterSeconds: this.critters?.secondsLeft ?? 0,
    goRoom: (room: RoomId) => this.walkToRoom(room),
    goTo: (id: string) => {
      const r = this.remotes.get(id);
      if (!r?.active) return;
      const s = r.avatar.sprite;
      if (this.walkTo(s.x + (s.x > this.player.x ? -14 : 14), s.y)) toast({ icon: 'footprints', who: `Walking to ${r.info.name}`, what: 'Move any way to stop.', small: true, ttl: 1600 });
    },
  };
}

// Into a room: the middle of its floor. A quiet room: walk up to its door and ask there.
export function walkToRoom(this: HouseScene, room: RoomId) {
  const c = this.zones.floorCentre(room);
  if (!c) return;
  if (this.quietDoor(room)) {
    const d = this.doorSpots.get(room);
    if (d && this.walkTo(d.x, d.y)) this.autoDoor = room;
    return;
  }
  this.walkTo(c.x, c.y);
}

// Walk the feet to (x, y), around walls, furniture and shut doors. False if there's no way there.
export function walkTo(this: HouseScene, x: number, y: number) {
  const b = this.body;
  const off = { x: b.center.x - this.player.x, y: b.center.y - this.player.y };
  const blocked: Rect[] = [];
  this.wallLayer.forEachTile((t) => {
    if (t.index !== -1) blocked.push({ x: t.pixelX, y: t.pixelY, w: t.width, h: t.height });
  });
  for (const o of [...(this.look.solids.getChildren() as Phaser.GameObjects.Rectangle[]), ...(this.doorBlocks.getChildren() as Phaser.GameObjects.Rectangle[])]) {
    const room = o.getData('room') as RoomId | undefined;
    if (room && !this.quietDoor(room)) continue;
    blocked.push({ x: o.x, y: o.y, w: o.width, h: o.height });
  }
  const grid = new WalkGrid(this.wallLayer.width, this.wallLayer.height, blocked, { hw: b.width / 2 + 2, hh: b.height / 2 + 2 } /* 2 px to spare, so corners don't catch */);
  const path = grid.find({ x: b.center.x, y: b.center.y }, { x: x + off.x, y: y + off.y });
  this.autoDoor = null;
  if (!path) {
    this.autoPath = null;
    toast({ icon: 'footprints', who: 'Can’t get there', what: 'Something’s in the way.', small: true, ttl: 1800 });
    return false;
  }
  this.autoPath = path;
  this.autoCheck = { t: this.time.now, x: b.center.x, y: b.center.y };
  return true;
}

export function autoVelocity(this: HouseScene) {
  const none = new Phaser.Math.Vector2(0, 0);
  const path = this.autoPath;
  if (!path) return none;
  const c = this.body.center;
  while (path.length && Math.hypot(path[0].x - c.x, path[0].y - c.y) < 2) path.shift();
  if (!path.length) {
    this.autoPath = null;
    if (this.autoDoor) this.bumpQuietDoor(this.autoDoor);
    this.autoDoor = null;
    return none;
  }
  // Stuck (a friend in the way, a door that just shut): give up rather than push forever.
  if (this.time.now - this.autoCheck.t > 900) {
    const moved = Math.hypot(c.x - this.autoCheck.x, c.y - this.autoCheck.y);
    this.autoCheck = { t: this.time.now, x: c.x, y: c.y };
    if (moved < 4) {
      this.autoPath = null;
      return none;
    }
  }
  const dx = path[0].x - c.x;
  const dy = path[0].y - c.y;
  // Last few px: slow down so we don't overshoot the point.
  const d = Math.hypot(dx, dy);
  return eightWay(dx, dy).scale(d < 6 ? SPEED * SLOW : SPEED);
}

// Unit vector along the nearest of the 8 compass directions.
function eightWay(x: number, y: number) {
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
  return new Phaser.Math.Vector2(Math.round(Math.cos(a) * 1e6) / 1e6, Math.round(Math.sin(a) * 1e6) / 1e6);
}
