import Phaser from 'phaser';
import { portraitFrame } from '../characters';
import type { RoomId } from '../config';

// The look of the house: night tint with warm light pools, door frames, and nameplates over each door
// showing the room's name and who's inside. Matches design/login/login.html.

const NIGHT_TINT = 0xb7aecd; // multiplied over everything: a ~25% dusk, like the login scene's night
const LIGHT_DEPTH = 70_000; // above people and furniture tops (50 000), below name tags (100 000)
const PLATE_DEPTH = 80_000;
const ROOM_LIVE_ALPHA = 0.09; // extra warmth in rooms with people in them
const WOOD = 0x7a4b31;
const WOOD_DARK = 0x4d2e1e;
const EDGE = 0x0d0912;
const PANEL = 0x2b2034;
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
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  t.refresh();
}

export class HouseLook {
  private roomGlow = new Map<RoomId, Phaser.GameObjects.Rectangle>();
  private plates = new Map<RoomId, Nameplate>();

  constructor(
    private scene: Phaser.Scene,
    map: Phaser.Tilemaps.Tilemap,
    rooms: { name: RoomId; rect: Phaser.Geom.Rectangle }[],
  ) {
    glowTexture(scene);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Night: tint the whole house (people included), then add warm light back.
    scene.add
      .rectangle(0, 0, map.widthInPixels, map.heightInPixels, NIGHT_TINT)
      .setOrigin(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(LIGHT_DEPTH);
    for (const r of rooms) {
      const glow = scene.add
        .rectangle(r.rect.x, r.rect.y, r.rect.width, r.rect.height, 0xf4b860, 1)
        .setOrigin(0)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT_DEPTH + 1);
      this.roomGlow.set(r.name, glow);
    }
    for (const l of map.getObjectLayer('lights')?.objects ?? []) {
      const radius = Number(prop(l, 'radius') ?? 32);
      const colour = Phaser.Display.Color.HexStringToColor(String(prop(l, 'color') ?? '#f4b860')).color;
      const img = scene.add
        .image(l.x!, l.y!, 'glow')
        .setDisplaySize(radius * 2, radius * 2)
        .setTint(colour)
        .setAlpha(0.32)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT_DEPTH + 2);
      // Fire and fairy lights flicker a little, like the login screen.
      if (!reduce && (radius >= 60 || radius === 30))
        scene.tweens.add({ targets: img, alpha: 0.2, duration: 600 + Math.random() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    for (const d of map.getObjectLayer('doors')?.objects ?? []) {
      this.drawDoorFrame(d);
      this.plates.set(d.name as RoomId, new Nameplate(scene, d));
    }
  }

  // Open doorway: wooden posts either side of the gap through the wall face, and a threshold strip.
  private drawDoorFrame(d: Obj) {
    const g = this.scene.add.graphics().setDepth(1); // above floor/walls, below people
    const x = d.x!;
    const w = d.width!;
    const faceTop = d.y! + 16; // the gap's wall-face part starts below the dark wall row
    const faceH = 32;
    for (const px of [x - 3, x + w]) {
      g.fillStyle(EDGE).fillRect(px, faceTop - 2, 3, faceH + 2);
      g.fillStyle(WOOD).fillRect(px + (px < x ? 0 : 1), faceTop - 1, 2, faceH);
    }
    g.fillStyle(EDGE).fillRect(x - 3, faceTop - 3, w + 6, 3);
    g.fillStyle(WOOD).fillRect(x - 2, faceTop - 2, w + 4, 1);
    const sillY = prop(d, 'side') === 'north' ? faceTop + faceH - 2 : d.y! + 14;
    g.fillStyle(WOOD_DARK, 0.8).fillRect(x, sillY, w, 2);
  }

  setRoomName(room: RoomId, name: string) {
    this.plates.get(room)?.setName(name);
  }

  // Who's in each room: lights it up a little and shows faces on the door's nameplate.
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

// A pixel sign hung on the wall above a door: "Room 3" plus up to 4 faces, then "+2".
class Nameplate {
  private box: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.Text;
  private more: Phaser.GameObjects.Text;
  private heads: Phaser.GameObjects.Image[] = [];
  private headKey = '';

  constructor(
    private scene: Phaser.Scene,
    door: Obj,
  ) {
    const cx = door.x! + door.width! / 2;
    const cy = door.y! + 8; // centred on the dark wall row above the doorway
    this.bg = scene.add.graphics();
    this.text = scene.add
      .text(0, 0, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '8px', color: CREAM })
      .setOrigin(0, 0.5)
      .setResolution(6);
    this.more = scene.add
      .text(0, 0, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '7px', color: '#f4b860' })
      .setOrigin(0, 0.5)
      .setResolution(6);
    this.box = scene.add.container(cx, cy, [this.bg, this.text, this.more]).setDepth(PLATE_DEPTH);
    this.box.setName(`plate-${door.name}`);
    this.setName(`Room ${Number(String(door.name).slice(-2))}`);
  }

  get label() {
    return this.text.text;
  }

  get headCount() {
    return this.heads.length + (this.more.text ? Number(this.more.text.slice(1)) : 0);
  }

  setName(name: string) {
    this.text.setText(name);
    this.layout();
  }

  setHeads(characters: number[]) {
    const key = characters.join(',');
    if (key === this.headKey) return;
    this.headKey = key;
    this.heads.forEach((h) => h.destroy());
    this.heads = characters.slice(0, MAX_HEADS).map((c) => {
      // Face only: a 10x10 crop of the character's front-facing pose.
      const { key: tex, frame } = portraitFrame(c);
      const img = this.scene.add.image(0, 0, tex, frame).setOrigin(0, 0).setCrop(3, 3, 10, 10);
      this.box.add(img);
      return img;
    });
    this.more.setText(characters.length > MAX_HEADS ? `+${characters.length - MAX_HEADS}` : '');
    this.layout();
  }

  private layout() {
    const gap = 2;
    const headsW = this.heads.length * 9 + (this.more.text ? Math.ceil(this.more.width) + 1 : 0);
    const w = Math.ceil(this.text.width) + 8 + (headsW ? headsW + gap : 0);
    const h = 12;
    this.bg.clear();
    this.bg.fillStyle(EDGE).fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 2);
    this.bg.fillStyle(PANEL).fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    this.bg.fillStyle(0xf4b860, 0.85).fillRect(-w / 2 + 2, -h / 2, w - 4, 1); // lamp-lit top edge
    let x = -w / 2 + 4;
    this.text.setPosition(x, 0.5);
    x += Math.ceil(this.text.width) + gap;
    for (const img of this.heads) {
      // Crop keeps the frame's origin, so shift by the crop offset to line the face up.
      img.setPosition(x - 3, -h / 2 + 1 - 3);
      x += 9;
    }
    this.more.setPosition(x, 0.5);
  }
}
