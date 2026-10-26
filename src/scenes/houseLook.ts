import Phaser from 'phaser';
import { skinFrame, type Skin } from '../characters';
import type { RoomId } from '../config';
import { DND_COLOUR, DND_ICON, iconDataUrl, type IconName } from '../ui/icons';
import { roomDef } from '../house/rooms';
import { DEPTH, depthOf, toScreen } from '../house/projection';

// The look of the house, after design/game/mvp.html: furniture sprites depth-sorted with people, a night
// tint with warm light pools (and occupied rooms glowing), and a wooden nameplate over each door with
// the room's name, a "Do not disturb" moon, and the faces of who's inside.

const NIGHT = 0x8a7fae; // multiplied over everything, like the mock's #dark layer
const LIGHT_DEPTH = DEPTH.light;
const PLATE_DEPTH = DEPTH.plate;
const ROOM_LIVE_ALPHA = 0.32;
const WOOD = 0x7a4b31;
const WOOD_HI = 0x9a6440;
const QUIET = 0x4a3a57; // the board when someone inside asked not to be disturbed
const EDGE = 0x0d0912;
const CREAM = '#fff4e0';
const MAX_HEADS = 4;

type Obj = Phaser.Types.Tilemaps.TiledObject;
const prop = (o: Obj, name: string) => (o.properties as { name: string; value: unknown }[] | undefined)?.find((p) => p.name === name)?.value;

function glowTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('glow')) return;
  const size = 128;
  const t = scene.textures.createCanvas('glow', size, size)!;
  const g = t.getContext();
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  t.refresh();
}

// Lucide icons as small textures for the in-world nameplates (loaded once, async).
const iconWaiters = new Map<string, (() => void)[]>();
function iconTexture(scene: Phaser.Scene, name: IconName, colour: string, ready: () => void) {
  const key = `icon-${name}-${colour}`;
  if (scene.textures.exists(key)) return key;
  if (!iconWaiters.has(key)) {
    iconWaiters.set(key, []);
    const img = new Image();
    img.onload = () => {
      if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
      iconWaiters.get(key)!.forEach((f) => f());
    };
    img.src = iconDataUrl(name, colour);
  }
  iconWaiters.get(key)!.push(ready);
  return null;
}

// Hide and seek: which furniture you can get into or behind, and what it's called on the button.
export type HideSpot = { id: string; kind: string; x: number; y: number; w: number; h: number };
const HIDE_KINDS: [RegExp, string][] = [
  [/^wardrobe|^dresser|^cabinet/, 'the cupboard'],
  [/^bookcase|^bookshelf/, 'the bookcase'],
  [/^fridge/, 'the fridge'],
  [/^sofa/, 'the sofa'],
  [/^bed_/, 'the bed'],
  [/^plant_(big|palm|tall|tree)|^tree_|^bush/, 'the plant'],
  [/^counter_long|^sink_counter/, 'the counter'],
  [/^arcade_/, 'the arcade machine'],
  [/^dj_booth|^speaker_tall|^jukebox/, 'the speakers'],
  [/^aquarium/, 'the fish tank'],
  [/^table_long|^desk_/, 'the table'],
];
export function hideKind(key: string) {
  return HIDE_KINDS.find(([re]) => re.test(key))?.[1] ?? null;
}

export class HouseLook {
  private roomGlow = new Map<RoomId, Phaser.GameObjects.Image>();
  private plates = new Map<RoomId, Nameplate>();
  readonly solids: Phaser.Physics.Arcade.StaticGroup;
  private tall: { x: number; y: number; w: number; h: number; depth: number }[] = []; // things you can stand behind
  // Furniture you can hide in or behind (Hide and seek, src/house/hideSeek.ts): its footprint, world px.
  readonly hideSpots: HideSpot[] = [];

  constructor(
    private scene: Phaser.Scene,
    map: Phaser.Tilemaps.Tilemap,
    rooms: { name: RoomId; box: { x: number; y: number; w: number; h: number } }[], // px
  ) {
    glowTexture(scene);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.solids = scene.physics.add.staticGroup();
    for (const o of map.getObjectLayer('furniture')?.objects ?? []) {
      // Each piece carries its art (sheet + rectangle, from src/house/art/topdown.json), its depth point and
      // its footprint (scripts/build-map.mjs).
      const key = o.name;
      const sheetKey = String(prop(o, 'sheet') ?? 'limezu_interiors');
      const sheet = scene.textures.get(sheetKey);
      if (!sheet.has(key)) sheet.add(key, 0, Number(prop(o, 'sx')), Number(prop(o, 'sy')), o.width!, o.height!);
      const at = toScreen(o.x!, o.y!);
      // Rugs under everyone; wall hangings just above the walls; the rest sorted with people.
      const depth = o.type === 'rug' ? DEPTH.rug : o.type === 'wall' ? DEPTH.wallDecor : depthOf(Number(prop(o, 'depthX')), Number(prop(o, 'depthY')));
      scene.add.image(at.x, at.y, sheetKey, key).setOrigin(0).setDepth(depth);
      if (o.type === 'thing') this.tall.push({ x: at.x, y: at.y, w: o.width!, h: o.height!, depth });
      const foot = prop(o, 'foot');
      if (o.type === 'thing' && foot) {
        // Only the footprint blocks, so you can stand "behind" the top of tall things.
        const [fx, fy, fw, fh] = String(foot).split(',').map(Number);
        this.solids.add(scene.add.rectangle(fx, fy, fw, fh).setOrigin(0).setVisible(false));
        const kind = hideKind(key);
        if (kind) this.hideSpots.push({ id: `${key}@${fx},${fy}`, kind, x: fx, y: fy, w: fw, h: fh });
      }
      const light = prop(o, 'light');
      if (light) this.addLight(o, String(light), reduce);
    }
    this.solids.refresh();

    // Night: tint everything (people included), then add warm light back.
    scene.add
      .rectangle(0, 0, map.widthInPixels, map.heightInPixels, NIGHT)
      .setOrigin(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(LIGHT_DEPTH);
    for (const r of rooms) {
      // A warm wash over rooms with people in them: you can see which rooms are lively from the hallway.
      const { x, y, w, h } = r.box;
      const glow = scene.add
        .image(x + w / 2, y + h * 0.6, 'glow')
        .setDisplaySize(w * 1.2, h)
        .setTint(0xf4b860)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT_DEPTH + 1);
      this.roomGlow.set(r.name, glow);
    }

    for (const d of map.getObjectLayer('doors')?.objects ?? []) this.plates.set(d.name as RoomId, new Nameplate(scene, d));
  }

  private addLight(o: Obj, colour: string, reduce: boolean) {
    const fire = o.name.startsWith('fireplace') || o.name === 'fire_pit';
    const fairy = o.name === 'fairy_lights';
    const r = fire ? 70 : fairy ? 26 : 46;
    const img = this.scene.add
      .image(o.x! + o.width! / 2, o.y! + (fairy ? 6 : o.height! * 0.3), 'glow')
      .setDisplaySize(r * 2, r * 2)
      .setTint(Phaser.Display.Color.HexStringToColor(colour).color)
      .setAlpha(fire ? 0.6 : 0.45)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LIGHT_DEPTH + 2);
    if (!reduce && (fire || fairy))
      this.scene.tweens.add({ targets: img, alpha: fire ? 0.4 : 0.25, duration: fire ? 180 + Math.random() * 200 : 900 + Math.random() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  setRoom(room: RoomId, info: { name: string; dnd: boolean }) {
    this.plates.get(room)?.setInfo(info);
  }

  // Who's in each room: warms it up and shows faces on the door's nameplate.
  setOccupants(room: RoomId, characters: Skin[]) {
    const glow = this.roomGlow.get(room);
    if (glow) {
      const target = characters.length ? ROOM_LIVE_ALPHA : 0;
      if (glow.getData('target') !== target) {
        glow.setData('target', target);
        this.scene.tweens.add({ targets: glow, alpha: target, duration: 600 });
      }
    }
    this.plates.get(room)?.setHeads(characters);
  }

  plate(room: RoomId) {
    return this.plates.get(room);
  }

  // Is someone standing at (x, y) (feet, screen px) half hidden behind furniture drawn in front of them?
  hides(x: number, y: number, depth: number) {
    const inside = (px: number, py: number) => this.tall.some((t) => t.depth > depth && px > t.x + 2 && px < t.x + t.w - 2 && py > t.y + 2 && py < t.y + t.h - 2);
    return inside(x, y - 3) && inside(x, y - 8);
  }
}

// A wooden board hung over a door (rooms above the hall: on the hall's wall; others: by the doorway), with
// up to 4 faces above it, then "+2". "Do not disturb" makes it dark, with a moon.
class Nameplate {
  private box: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private dndIcon: Phaser.GameObjects.Image | null = null;
  private heads: Phaser.GameObjects.GameObject[] = [];
  private headKey = '';
  private info: { name: string; dnd: boolean };
  private count = 0;
  private readonly topY: number;
  private readonly north: boolean;

  constructor(
    private scene: Phaser.Scene,
    door: Obj,
  ) {
    const north = prop(door, 'side') === 'north';
    this.north = north;
    // Where the map builder put it: on the hall's wall face just below a door that goes up (north), or
    // just above the doorway for the others.
    const cx = Number(prop(door, 'plateX'));
    this.topY = Number(prop(door, 'plateY'));
    this.board = scene.add.graphics();
    this.text = scene.add
      .text(0, 0, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '7px', color: CREAM })
      .setOrigin(0, 0.5)
      .setResolution(8);
    this.box = scene.add.container(cx, this.topY, [this.board, this.text]).setDepth(PLATE_DEPTH);
    this.box.setName(`plate-${door.name}`);
    this.info = { name: roomDef(String(door.name))?.name ?? String(door.name), dnd: false };
    this.render();
  }

  get label() {
    return this.text.text;
  }

  get headCount() {
    return this.count;
  }

  get dnd() {
    return this.info.dnd;
  }

  setInfo(info: { name: string; dnd: boolean }) {
    if (info.name === this.info.name && info.dnd === this.info.dnd) return;
    this.info = info;
    this.render();
  }

  setHeads(characters: Skin[]) {
    const key = characters.join(',');
    if (key === this.headKey) return;
    this.headKey = key;
    this.count = characters.length;
    this.heads.forEach((h) => h.destroy());
    this.heads = [];
    const shown = characters.slice(0, MAX_HEADS);
    const more = characters.length - shown.length;
    const total = shown.length * 9 + (more ? 10 : 0) - 1;
    let x = -total / 2;
    for (const c of shown) {
      // 8x8 face: the front-facing pose (16 px) at half size, on a dark tile.
      const bg = this.scene.add.rectangle(x - 1, -1, 10, 10, EDGE).setOrigin(0);
      const { key: tex, frame } = skinFrame(c, 'idle', 'down');
      const img = this.scene.add.image(x, 0, tex, frame).setOrigin(0).setScale(0.5);
      this.box.add([bg, img]);
      this.heads.push(bg, img);
      x += 9;
    }
    if (more) {
      const t = this.scene.add
        .text(x + 4, 4, `+${more}`, { fontFamily: '"Pixelify Sans", monospace', fontSize: '6px', color: CREAM, backgroundColor: '#2b2034' })
        .setOrigin(0.5)
        .setResolution(8);
      this.box.add(t);
      this.heads.push(t);
    }
    this.render();
  }

  private render() {
    const { name, dnd } = this.info;
    this.text.setText(name);
    this.dndIcon?.destroy();
    this.dndIcon = null;
    const dKey = dnd ? iconTexture(this.scene, DND_ICON, DND_COLOUR, () => this.render()) : null;
    const iconW = 6;
    const pad = 4;
    const w = pad + (dKey ? iconW + 3 : 0) + Math.ceil(this.text.width) + pad;
    const h = 10;
    // Faces sit above the board: on the north wall the plate grows upwards, on the south side downwards.
    const by = this.count ? 10 : 0;
    this.box.y = this.north && this.count ? this.topY - 10 : this.topY;
    this.board.clear();
    this.board.fillStyle(EDGE).fillRect(-w / 2 - 1, by - 1, w + 2, h + 2);
    this.board.fillStyle(dnd ? QUIET : WOOD).fillRect(-w / 2, by, w, h);
    this.board.fillStyle(WOOD_HI, dnd ? 0.4 : 1).fillRect(-w / 2, by, w, 1);
    this.board.fillStyle(0x000000, 0.35).fillRect(-w / 2, by + h - 1, w, 1);
    let x = -w / 2 + pad;
    const cy = by + h / 2;
    if (dKey) {
      this.dndIcon = this.scene.add.image(x + iconW / 2, cy, dKey).setDisplaySize(iconW, iconW);
      this.box.add(this.dndIcon);
      x += iconW + 3;
    }
    this.text.setPosition(x, cy + 0.5);
    this.box.bringToTop(this.text);
  }
}
