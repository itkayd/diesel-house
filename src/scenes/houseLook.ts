import Phaser from 'phaser';
import { portraitFrame } from '../characters';
import type { RoomId } from '../config';
import { DOORS, iconDataUrl, MOOD_COLOURS, MOODS, type DoorState, type IconName, type Mood } from '../ui/icons';
import { faceTop } from '../ui/portrait';

// The look of the house, after design/game/mvp.html: furniture sprites depth-sorted with people, a night
// tint with warm light pools (and occupied rooms glowing), and a wooden nameplate over each door with
// the room's name, door state, mood, and the faces of who's inside.

const NIGHT = 0x8a7fae; // multiplied over everything, like the mock's #dark layer
const LIGHT_DEPTH = 70_000; // above people (depth = feet y) and furniture, below name tags (100 000)
const PLATE_DEPTH = 80_000;
const ROOM_LIVE_ALPHA = 0.32;
const WOOD = 0x7a4b31;
const WOOD_HI = 0x9a6440;
const LOCKED = 0x4a3a57;
const KNOCK = 0xc9822f;
const EDGE = 0x0d0912;
const CREAM = '#fff4e0';
const MAX_HEADS = 4;
// Sit-on things you can walk over; everything else (not rugs or wall hangings) blocks at its base.
const WALK_OVER = new Set(['stool', 'chair_a', 'chair_b', 'chair_c']);

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

export class HouseLook {
  private roomGlow = new Map<RoomId, Phaser.GameObjects.Image>();
  private plates = new Map<RoomId, Nameplate>();
  readonly solids: Phaser.Physics.Arcade.StaticGroup;

  constructor(
    private scene: Phaser.Scene,
    map: Phaser.Tilemaps.Tilemap,
    rooms: { name: RoomId; rect: Phaser.Geom.Rectangle }[],
  ) {
    glowTexture(scene);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.solids = scene.physics.add.staticGroup();
    const sheet = scene.textures.get('limezu_interiors');

    for (const o of map.getObjectLayer('furniture')?.objects ?? []) {
      const key = o.name;
      if (!sheet.has(key)) sheet.add(key, 0, Number(prop(o, 'sx')), Number(prop(o, 'sy')), o.width!, o.height!);
      const x = o.x!;
      const y = o.y!;
      const w = o.width!;
      const h = o.height!;
      // Rugs under everyone; wall hangings just above the walls; the rest sorted with people by base.
      const depth = o.type === 'rug' ? 1 : o.type === 'wall' ? 2 : y + h;
      scene.add.image(x, y, 'limezu_interiors', key).setOrigin(0).setDepth(depth);
      if (o.type === 'thing' && !WALK_OVER.has(key)) {
        // Block only the base, so you can stand "behind" the top of tall things.
        const bh = w <= 16 ? 5 : Math.max(6, Math.round(h * 0.45));
        const block = scene.add.rectangle(x + 1, y + h - bh, w - 2, bh).setOrigin(0).setVisible(false);
        this.solids.add(block);
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
      const top = r.rect.y < 12 * 16;
      const ox = r.rect.x;
      const oy = top ? r.rect.y : r.rect.y + 16;
      const glow = scene.add
        .image(ox + 80, oy + 96, 'glow')
        .setDisplaySize(190, 160)
        .setTint(0xf4b860)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT_DEPTH + 1);
      this.roomGlow.set(r.name, glow);
    }

    for (const d of map.getObjectLayer('doors')?.objects ?? []) this.plates.set(d.name as RoomId, new Nameplate(scene, d));
  }

  private addLight(o: Obj, colour: string, reduce: boolean) {
    const fire = o.name === 'fireplace';
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

  setRoom(room: RoomId, info: { name: string; mood: Mood | null; door: DoorState }) {
    this.plates.get(room)?.setInfo(info);
  }

  // Who's in each room: warms it up and shows faces on the door's nameplate.
  setOccupants(room: RoomId, characters: number[]) {
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
}

// A wooden board hung over a door (top rooms: on the hallway wall; bottom rooms: by the doorway), with up
// to 4 faces above it, then "+2". Locked doors get a dark board, knock-first doors an amber one.
class Nameplate {
  private box: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private doorIcon: Phaser.GameObjects.Image | null = null;
  private moodIcon: Phaser.GameObjects.Image | null = null;
  private heads: Phaser.GameObjects.GameObject[] = [];
  private headKey = '';
  private info: { name: string; mood: Mood | null; door: DoorState };
  private count = 0;
  private readonly topY: number;
  private readonly north: boolean;

  constructor(
    private scene: Phaser.Scene,
    door: Obj,
  ) {
    const north = prop(door, 'side') === 'north';
    this.north = north;
    const cx = door.x! + door.width! / 2;
    // Same anchor points as the mock: just under the dark band on the hallway's north wall, or at the
    // hallway's south edge for the bottom rooms.
    this.topY = north ? 12 * 16 + 3 : 19 * 16 - 4;
    this.board = scene.add.graphics();
    this.text = scene.add
      .text(0, 0, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '7px', color: CREAM })
      .setOrigin(0, 0.5)
      .setResolution(8);
    this.box = scene.add.container(cx, this.topY, [this.board, this.text]).setDepth(PLATE_DEPTH);
    this.box.setName(`plate-${door.name}`);
    this.info = { name: `Room ${Number(String(door.name).slice(-2))}`, mood: null, door: 'open' };
    this.render();
  }

  get label() {
    return this.text.text;
  }

  get headCount() {
    return this.count;
  }

  get door() {
    return this.info.door;
  }

  setInfo(info: { name: string; mood: Mood | null; door: DoorState }) {
    this.info = info;
    this.render();
  }

  setHeads(characters: number[]) {
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
      // 8x8 face: a 16x16 crop of the front-facing pose at half size, on a dark tile.
      const bg = this.scene.add.rectangle(x - 1, -1, 10, 10, EDGE).setOrigin(0);
      const { key: tex, frame } = portraitFrame(c);
      const img = this.scene.add
        .image(x, 0, tex, frame)
        .setOrigin(0)
        .setCrop(0, faceTop(c), 16, 16)
        .setScale(0.5);
      img.y = -faceTop(c) * 0.5; // the crop keeps the frame's origin
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
    const { name, mood, door } = this.info;
    this.text.setText(name);
    this.doorIcon?.destroy();
    this.moodIcon?.destroy();
    this.doorIcon = this.moodIcon = null;
    const again = () => this.render();
    const dKey = door === 'open' ? null : iconTexture(this.scene, DOORS[door][0], '#fff4e0', again);
    const mKey = mood ? iconTexture(this.scene, MOODS[mood][0], MOOD_COLOURS[mood], again) : null;
    const iconW = 6;
    const pad = 4;
    const w = pad + (dKey ? iconW + 3 : 0) + Math.ceil(this.text.width) + (mKey ? 3 + iconW : 0) + pad;
    const h = 10;
    // Faces sit above the board: on the north wall the plate grows upwards, on the south side downwards.
    const by = this.count ? 10 : 0;
    this.box.y = this.north && this.count ? this.topY - 10 : this.topY;
    this.board.clear();
    this.board.fillStyle(EDGE).fillRect(-w / 2 - 1, by - 1, w + 2, h + 2);
    this.board.fillStyle(door === 'locked' ? LOCKED : door === 'knock' ? KNOCK : WOOD).fillRect(-w / 2, by, w, h);
    this.board.fillStyle(WOOD_HI, door === 'open' ? 1 : 0.4).fillRect(-w / 2, by, w, 1);
    this.board.fillStyle(0x000000, 0.35).fillRect(-w / 2, by + h - 1, w, 1);
    let x = -w / 2 + pad;
    const cy = by + h / 2;
    if (dKey) {
      this.doorIcon = this.scene.add.image(x + iconW / 2, cy, dKey).setDisplaySize(iconW, iconW);
      this.box.add(this.doorIcon);
      x += iconW + 3;
    }
    this.text.setPosition(x, cy + 0.5);
    x += Math.ceil(this.text.width) + 3;
    if (mKey) {
      this.moodIcon = this.scene.add.image(x + iconW / 2, cy, mKey).setDisplaySize(iconW, iconW);
      this.box.add(this.moodIcon);
    }
    this.box.bringToTop(this.text);
  }
}
