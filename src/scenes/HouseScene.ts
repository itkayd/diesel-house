import Phaser from 'phaser';
import { ROOM_IDS, TILE_SIZE, type Zone } from '../config';
import { showZone } from '../ui/overlay';
import { isTouchDevice, Joystick } from '../ui/joystick';

const SPEED = 80; // px per second

type ZoneRect = { name: Zone; rect: Phaser.Geom.Rectangle };

export class HouseScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private body!: Phaser.Physics.Arcade.Body;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private zones: ZoneRect[] = [];
  private zone: Zone | null = null;
  private joystick: Joystick | null = null;

  constructor() {
    super('House');
  }

  create() {
    const map = this.make.tilemap({ key: 'house' });
    const tiles = map.addTilesetImage('limezu_room_builder', 'limezu_room_builder')!;
    map.createLayer('floor', tiles);
    const walls = map.createLayer('walls', tiles)!;
    walls.setCollisionByExclusion([-1]);

    for (const obj of map.getObjectLayer('zones')!.objects) {
      if (obj.name === 'hallway' || (ROOM_IDS as readonly string[]).includes(obj.name))
        this.zones.push({ name: obj.name as Zone, rect: new Phaser.Geom.Rectangle(obj.x!, obj.y!, obj.width!, obj.height!) });
    }
    this.addRoomLabels();

    // Stand-in player until the character sprites arrive in Phase 2.
    const spawn = map.findObject('zones', (o) => o.name === 'spawn')!;
    this.player = this.add.circle(spawn.x!, spawn.y!, 5, 0xffd34d).setStrokeStyle(1, 0x1b1b24);
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setCircle(5);
    this.physics.add.collider(this.player, walls);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.body.setCollideWorldBounds(true);

    this.keys = this.input.keyboard!.addKeys('up,down,left,right,w,a,s,d') as typeof this.keys;
    if (isTouchDevice()) this.joystick = new Joystick();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.15, 0.15);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);

    if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
  }

  // About 18x14 tiles in view, never so far out that the house stops filling the screen.
  private fitCamera() {
    const { width, height } = this.scale;
    const bounds = this.cameras.main.getBounds();
    const fit = Math.min(width / (18 * TILE_SIZE), height / (14 * TILE_SIZE));
    const fill = Math.max(width / bounds.width, height / bounds.height);
    const zoom = Phaser.Math.Clamp(Math.max(fit, fill), 1.5, 4);
    this.cameras.main.setZoom(zoom);
  }

  private addRoomLabels() {
    for (const z of this.zones) {
      if (z.name === 'hallway') continue;
      const n = Number(z.name.slice(-2));
      this.add
        .text(z.rect.centerX, z.rect.centerY, `Room ${n}`, { fontFamily: 'system-ui, sans-serif', fontSize: '10px', color: '#ffffff', stroke: '#1b1b24', strokeThickness: 3 })
        .setOrigin(0.5)
        .setAlpha(0.8)
        .setResolution(4);
    }
  }

  update() {
    const k = this.keys;
    let vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);

    // Mouse: hold to walk towards the pointer. Touch uses the joystick instead.
    const p = this.input.activePointer;
    if (!vx && !vy && p.isDown && !p.wasTouch) {
      const dx = p.worldX - this.player.x;
      const dy = p.worldY - this.player.y;
      if (Math.hypot(dx, dy) > 4) {
        vx = dx;
        vy = dy;
      }
    }

    const v = new Phaser.Math.Vector2(vx, vy);
    if (v.lengthSq() > 0) v.normalize().scale(SPEED);

    // Joystick wins over everything else; its push distance sets the speed.
    if (this.joystick && (this.joystick.vector.x || this.joystick.vector.y)) {
      v.set(this.joystick.vector.x, this.joystick.vector.y).scale(SPEED);
    }
    this.body.setVelocity(v.x, v.y);

    const zone = this.zones.find((z) => z.rect.contains(this.player.x, this.player.y))?.name ?? null;
    if (zone !== this.zone) {
      this.zone = zone;
      showZone(zone);
    }
  }
}
