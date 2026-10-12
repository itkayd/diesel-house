import Phaser from 'phaser';
import { ROOM_IDS, TILE_SIZE, type Zone } from '../config';
import { animKey, type Dir, saveCharacter, savedCharacter } from '../characters';
import { showZone } from '../ui/overlay';
import { isTouchDevice, Joystick } from '../ui/joystick';
import { addChangeCharacterButton, pickCharacter } from '../ui/picker';

const SPEED = 80; // px per second

type ZoneRect = { name: Zone; rect: Phaser.Geom.Rectangle };

export class HouseScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private body!: Phaser.Physics.Arcade.Body;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private zones: ZoneRect[] = [];
  private zone: Zone | null = null;
  private joystick: Joystick | null = null;
  private character = 0;
  private facing: Dir = 'down';
  private canMove = false;

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

    // Sprite position is the character's feet; the physics body is a small box around them.
    const spawn = map.findObject('zones', (o) => o.name === 'spawn')!;
    const saved = savedCharacter();
    this.character = saved ?? 0;
    this.player = this.add.sprite(spawn.x!, spawn.y!, 'chibis_a').setOrigin(0.5, 1);
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(10, 6).setOffset(3, 26);
    this.physics.add.collider(this.player, walls);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.body.setCollideWorldBounds(true);
    this.playAnim('idle');

    this.keys = this.input.keyboard!.addKeys('up,down,left,right,w,a,s,d') as typeof this.keys;
    if (isTouchDevice()) this.joystick = new Joystick();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.15, 0.15, 0, 16);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);

    addChangeCharacterButton(() => this.choose());
    if (saved === null) this.choose();
    else this.canMove = true;

    if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
  }

  private async choose() {
    this.canMove = false;
    this.body.setVelocity(0, 0);
    this.setCharacter(await pickCharacter(this.textures, savedCharacter()));
    this.canMove = true;
  }

  setCharacter(index: number) {
    this.character = index;
    saveCharacter(index);
    this.playAnim('idle');
  }

  private playAnim(kind: 'walk' | 'idle') {
    this.player.play(animKey(this.character, kind, this.facing), true);
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
        .text(z.rect.centerX, z.rect.centerY, `Room ${n}`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '10px',
          color: '#ffffff',
          stroke: '#1b1b24',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setAlpha(0.8)
        .setResolution(4);
    }
  }

  update() {
    const v = this.canMove ? this.inputVelocity() : new Phaser.Math.Vector2(0, 0);
    this.body.setVelocity(v.x, v.y);

    if (v.lengthSq() > 0) {
      this.facing = Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'right' : 'left') : v.y > 0 ? 'down' : 'up';
      this.playAnim('walk');
    } else {
      this.playAnim('idle');
    }
    this.player.setDepth(this.player.y);

    const zone = this.zones.find((z) => z.rect.contains(this.player.x, this.player.y - 3))?.name ?? null;
    if (zone !== this.zone) {
      this.zone = zone;
      showZone(zone);
    }
  }

  private inputVelocity() {
    // Joystick wins over everything else; its push distance sets the speed.
    if (this.joystick && (this.joystick.vector.x || this.joystick.vector.y))
      return new Phaser.Math.Vector2(this.joystick.vector.x, this.joystick.vector.y).scale(SPEED);

    const k = this.keys;
    let vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);

    // Mouse: hold to walk towards the pointer. Touch uses the joystick instead.
    const p = this.input.activePointer;
    if (!vx && !vy && p.isDown && !p.wasTouch) {
      const dx = p.worldX - this.player.x;
      const dy = p.worldY - (this.player.y - 8);
      if (Math.hypot(dx, dy) > 4) {
        vx = dx;
        vy = dy;
      }
    }
    const v = new Phaser.Math.Vector2(vx, vy);
    return v.lengthSq() > 0 ? v.normalize().scale(SPEED) : v;
  }
}
