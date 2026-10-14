import Phaser from 'phaser';
import { ROOM_IDS, TILE_SIZE, type RoomId, type Zone } from '../config';
import type { Dir } from '../characters';
import { Presence, type PlayerInfo, type PosMsg } from '../net/presence';
import { Voice } from '../net/voice';
import { saveCharacter, savedCharacter, saveName, savedName } from '../prefs';
import { showStatus, showZone } from '../ui/overlay';
import { isTouchDevice, Joystick } from '../ui/joystick';
import { addChangeCharacterButton, pickCharacter } from '../ui/picker';
import { VoiceControls } from '../ui/voiceControls';
import { Avatar } from './Avatar';

const SPEED = 80; // px per second
const SEND_EVERY = 100; // ms between position updates while moving (~10/s)
const IDLE_RESEND = 5000; // ms between "still here" updates while standing still
const INTERP_DELAY = 150; // ms: other players are drawn this far in the past so we can smooth between updates
const STALE_AFTER = 15000; // ms without any update before someone is hidden (locked phone, closed tab)
const JOIN_VOICE_AFTER = 300; // ms standing in a room before joining its voice (avoids flapping in doorways)

type ZoneRect = { name: Zone; rect: Phaser.Geom.Rectangle };
type Snapshot = { t: number; x: number; y: number; dir: Dir; moving: boolean };
// clockOffset: smallest (our clock - their clock) seen; maps their timestamps onto our timeline.
type Remote = { avatar: Avatar; info: PlayerInfo; snaps: Snapshot[]; clockOffset: number; lastHeard: number; active: boolean };

export class HouseScene extends Phaser.Scene {
  private me!: Avatar;
  private player!: Phaser.GameObjects.Sprite;
  private body!: Phaser.Physics.Arcade.Body;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private zones: ZoneRect[] = [];
  private zone: Zone | null = null;
  private joystick: Joystick | null = null;
  private character = 0;
  private name = '';
  private canMove = false;

  private presence: Presence | null = null;
  private remotes = new Map<string, Remote>();
  private lastSent = 0;
  private wasMoving = false;
  private voice: Voice | null = null;
  private voiceControls: VoiceControls | null = null;
  private voiceTimer: Phaser.Time.TimerEvent | null = null;

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
    const name = savedName();
    this.character = saved ?? 0;
    this.name = name ?? '';
    this.me = new Avatar(this, spawn.x!, spawn.y!, this.character, this.name);
    this.player = this.me.sprite;
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(10, 6).setOffset(3, 26);
    this.physics.add.collider(this.player, walls);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.body.setCollideWorldBounds(true);

    // No key capture, so letters still reach text boxes (name, chat).
    this.keys = this.input.keyboard!.addKeys('up,down,left,right,w,a,s,d', false) as typeof this.keys;
    if (isTouchDevice()) this.joystick = new Joystick();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.15, 0.15, 0, 16);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);

    addChangeCharacterButton(() => this.choose());
    if (saved === null || name === null) this.choose();
    else this.start();

    if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
  }

  private async choose() {
    this.canMove = false;
    this.body.setVelocity(0, 0);
    const { character, name } = await pickCharacter(this.textures, savedCharacter(), savedName());
    this.character = character;
    this.name = name;
    saveCharacter(character);
    saveName(name);
    this.me.setCharacter(character);
    this.me.setName(name);
    if (this.presence) this.presence.update({ character, name });
    this.start();
  }

  // Joins the house once we know who we are.
  private start() {
    this.canMove = true;
    if (this.presence) return;
    this.presence = new Presence(
      { name: this.name, character: this.character, zone: this.zone },
      {
        onJoin: (p) => this.addRemote(p),
        onLeave: (id) => this.removeRemote(id),
        onInfo: (p) => this.updateRemote(p),
        onPos: (m) => this.receivePos(m),
        onStatus: (s) => this.showPresenceStatus(s),
      },
    );
    this.presence.connect();

    const forceRelay = import.meta.env.DEV && new URLSearchParams(location.search).has('relay'); // test TURN on its own
    this.voice = new Voice(
      this.presence.id,
      {
        onSpeaking: (id, on) => (id === this.presence!.id ? this.me : this.remotes.get(id)?.avatar)?.setSpeaking(on),
        onStatus: (s) => this.voiceControls?.show(s),
      },
      { forceRelay },
    );
    this.voiceControls = new VoiceControls({
      onMute: (m) => this.voice!.setMuted(m),
      onPushToTalk: (on) => this.voice!.setPushToTalk(on),
      onTalking: (t) => this.voice!.setTalking(t),
    });
    this.updateVoice();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice?.leave());
    window.addEventListener('pagehide', () => this.voice?.leave());
  }

  // Leaving a room cuts voice at once; joining waits until you've actually stepped in.
  private updateVoice() {
    if (!this.voice) return;
    this.voiceTimer?.remove();
    this.voiceTimer = null;
    const room = this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null;
    if (!room) {
      this.voice.leave();
      return;
    }
    if (this.voice.room === room) return;
    this.voice.leave();
    this.voiceTimer = this.time.delayedCall(JOIN_VOICE_AFTER, () => void this.voice!.join(room));
  }

  private showPresenceStatus(s: 'connecting' | 'online' | 'offline') {
    if (s === 'connecting') showStatus('Connecting…', false);
    else if (s === 'offline') showStatus('Offline', false);
    else showStatus(`${this.activeCount()} in the house`, true);
  }

  private activeCount() {
    let n = 1;
    for (const r of this.remotes.values()) if (r.active) n++;
    return n;
  }

  private addRemote(p: PlayerInfo) {
    const avatar = new Avatar(this, 0, 0, p.character, p.name);
    avatar.setVisible(false); // shown once we know where they are
    this.remotes.set(p.id, { avatar, info: p, snaps: [], clockOffset: Infinity, lastHeard: 0, active: false });
    this.sendPos(true); // so the newcomer sees us straight away
    this.showPresenceStatus('online');
  }

  private removeRemote(id: string) {
    this.remotes.get(id)?.avatar.destroy();
    this.remotes.delete(id);
    this.showPresenceStatus('online');
  }

  private updateRemote(p: PlayerInfo) {
    const r = this.remotes.get(p.id);
    if (!r) return;
    if (r.info.character !== p.character) r.avatar.setCharacter(p.character);
    if (r.info.name !== p.name) r.avatar.setName(p.name);
    r.info = { ...p, zone: r.info.zone }; // zone from position updates is fresher than presence
  }

  private receivePos(m: PosMsg) {
    const r = this.remotes.get(m.id);
    if (!r) return;
    const now = Date.now();
    r.clockOffset = Math.min(r.clockOffset, now - m.t);
    const t = m.t + r.clockOffset;
    if (r.snaps.length && t <= r.snaps[r.snaps.length - 1].t) return; // out of order
    r.snaps.push({ t, x: m.x, y: m.y, dir: m.dir, moving: m.moving });
    if (r.snaps.length > 30) r.snaps.shift();
    r.info.zone = m.zone;
    r.lastHeard = now;
    if (!r.active) {
      r.active = true;
      r.avatar.setPosition(m.x, m.y);
      r.avatar.setVisible(true);
      this.showPresenceStatus('online');
    }
  }

  private sendPos(force = false) {
    if (!this.presence) return;
    const moving = this.body.velocity.lengthSq() > 0;
    const now = performance.now();
    const due = moving ? SEND_EVERY : IDLE_RESEND;
    const stopped = this.wasMoving && !moving;
    if (!force && !stopped && now - this.lastSent < due) return;
    this.lastSent = now;
    this.wasMoving = moving;
    this.presence.sendPos({ x: Math.round(this.player.x), y: Math.round(this.player.y), dir: this.me.facing, moving, zone: this.zone });
  }

  // Draws each remote player a little in the past, blending between the two updates either side.
  private interpolateRemotes() {
    const now = Date.now();
    const renderT = now - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      if (r.active && now - r.lastHeard > STALE_AFTER) {
        r.active = false;
        r.snaps = [];
        r.avatar.setVisible(false);
        this.showPresenceStatus('online');
      }
      const s = r.snaps;
      if (!r.active || !s.length) continue;
      while (s.length >= 2 && s[1].t <= renderT) s.shift();
      const a = s[0];
      const b = s[1];
      let x = a.x;
      let y = a.y;
      if (b && renderT > a.t) {
        const k = Math.min(1, (renderT - a.t) / (b.t - a.t));
        x = a.x + (b.x - a.x) * k;
        y = a.y + (b.y - a.y) * k;
      }
      const moved = Math.abs(x - r.avatar.sprite.x) + Math.abs(y - r.avatar.sprite.y) > 0.01;
      r.avatar.setPosition(x, y);
      r.avatar.animate(moved || (b?.moving ?? a.moving), (b ?? a).dir);
    }
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

    const moving = v.lengthSq() > 0;
    const dir: Dir = !moving
      ? this.me.facing
      : Math.abs(v.x) > Math.abs(v.y)
        ? v.x > 0
          ? 'right'
          : 'left'
        : v.y > 0
          ? 'down'
          : 'up';
    this.me.animate(moving, dir);
    this.me.sync();

    const zone = this.zones.find((z) => z.rect.contains(this.player.x, this.player.y - 3))?.name ?? null;
    if (zone !== this.zone) {
      this.zone = zone;
      showZone(zone);
      this.presence?.update({ zone });
      this.sendPos(true);
      this.updateVoice();
    } else {
      this.sendPos();
    }

    this.interpolateRemotes();
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
