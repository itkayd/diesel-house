import Phaser from 'phaser';
import { ROOM_IDS, TILE_SIZE, type RoomId, type Zone } from '../config';
import type { Dir } from '../characters';
// Presence and Voice (and the Supabase client behind them) load after the picker; see start().
import type { MoveMsg, PlayerInfo, Presence } from '../net/presence';
import { installAudioUnlock } from '../net/audio';
import { msgStats } from '../net/stats';
import type { Voice } from '../net/voice';
import { saveCharacter, savedCharacter, saveName, savedName, savedShowOwnTag, saveShowOwnTag, savedVolume, saveVolume } from '../prefs';
import { showStatus, showZone } from '../ui/overlay';
import { isTouchDevice, Joystick } from '../ui/joystick';
import { addProfileButton, pickCharacter } from '../ui/picker';
import { askForMic } from '../ui/micPrompt';
import { addSettingsSection, switchRow } from '../ui/settings';
import { addVoiceSettings } from '../ui/voiceSettings';
import { showVolumePopover, volumePopoverOpen } from '../ui/volumePopover';
import { showSoundBanner } from '../ui/soundBanner';
import { VoiceControls } from '../ui/voiceControls';
import { Avatar } from './Avatar';
import { HouseLook } from './houseLook';

const SPEED = 80; // px per second
const SLOW = 0.5; // joystick half-push speed, as a fraction of SPEED
// Movement messages: one when movement changes, a correction every 500 ms while walking, a heartbeat
// every 15 s while standing still. Other screens extrapolate in between (dead reckoning).
const CORRECT_EVERY = 500;
const IDLE_RESEND = 15_000;
const EXTRAPOLATE_MAX = 750; // ms past the last message we keep walking someone forward (then wait for news)
const SNAP_OVER = 24; // px: corrections bigger than this jump; smaller ones glide
const GLIDE_MS = 150; // ms to glide out a small correction
const STALE_AFTER = 40_000; // ms without any message before someone is hidden (locked phone, closed tab)
const JOIN_VOICE_AFTER = 300; // ms standing in a room before joining its voice (avoids flapping in doorways)

type ZoneRect = { name: Zone; rect: Phaser.Geom.Rectangle };
// Last movement heard from someone, with t already moved onto our clock.
type Motion = { t: number; x: number; y: number; vx: number; vy: number; dir: Dir };
// clockOffset: smallest (our clock - their clock) seen; maps their timestamps onto our timeline.
// glide: leftover display error from the last correction, faded out over GLIDE_MS.
type Remote = {
  avatar: Avatar;
  info: PlayerInfo;
  motion: Motion | null;
  glide: { dx: number; dy: number; at: number };
  clockOffset: number;
  lastHeard: number;
  active: boolean;
};
type Sent = { vx: number; vy: number; dir: Dir; at: number };

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
  // Movement that arrived before presence told us who sent it (presence is slower); used once they join.
  private earlyMoves = new Map<string, MoveMsg>();
  private sent: Sent | null = null;
  readonly msgStats = msgStats; // dev checks: messages per minute
  private voice: Voice | null = null;
  private voiceControls: VoiceControls | null = null;
  private voiceTimer: Phaser.Time.TimerEvent | null = null;
  private starting = false;
  private presenceState: 'connecting' | 'online' | 'offline' = 'connecting';
  look!: HouseLook;
  private tappedAvatar = false; // pointer went down on a character: don't start walking towards it

  constructor() {
    super('House');
  }

  create() {
    const map = this.make.tilemap({ key: 'house' });
    const tiles = [
      map.addTilesetImage('limezu_room_builder', 'limezu_room_builder')!,
      map.addTilesetImage('limezu_interiors', 'limezu_interiors', 16, 16, 0, 0)!,
      map.addTilesetImage('kenney_indoor', 'kenney_indoor', 16, 16, 0, 1)!,
    ];
    const floor = map.createLayer('floor', tiles)!;
    const walls = map.createLayer('walls', tiles)!;
    walls.setCollisionByExclusion([-1]);
    map.createLayer('decor', tiles);
    map.createLayer('furniture', tiles);
    map.createLayer('furniture_top', tiles)!.setDepth(50_000); // tops of plants and lamps: over people behind them
    const solid = map.createLayer('collision', tiles)!.setVisible(false);
    solid.setCollisionByExclusion([-1]);

    for (const obj of map.getObjectLayer('zones')!.objects) {
      if (obj.name === 'hallway' || (ROOM_IDS as readonly string[]).includes(obj.name))
        this.zones.push({ name: obj.name as Zone, rect: new Phaser.Geom.Rectangle(obj.x!, obj.y!, obj.width!, obj.height!) });
      // Rooms whose floor is one of the plain greys get a colour (see scripts/build-map.mjs).
      const tint = (obj.properties as { name: string; value: string }[] | undefined)?.find((p) => p.name === 'floorTint')?.value;
      if (tint) {
        const colour = Phaser.Display.Color.HexStringToColor(tint).color;
        // Rooms above the hallway end in their doorway row, which has hallway floor: leave that untinted.
        const hall = this.zones.find((z) => z.name === 'hallway')!.rect;
        const rows = obj.height! / TILE_SIZE - (obj.y! < hall.y ? 1 : 0);
        floor.forEachTile((t) => (t.tint = colour), this, obj.x! / TILE_SIZE, obj.y! / TILE_SIZE, obj.width! / TILE_SIZE, rows);
      }
    }
    this.look = new HouseLook(
      this,
      map,
      this.zones.filter((z) => z.name !== 'hallway') as { name: RoomId; rect: Phaser.Geom.Rectangle }[],
    );

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
    this.physics.add.collider(this.player, solid);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.body.setCollideWorldBounds(true);

    // No key capture, so letters still reach text boxes (name, chat).
    this.keys = this.input.keyboard!.addKeys('up,down,left,right,w,a,s,d', false) as typeof this.keys;
    if (isTouchDevice()) this.joystick = new Joystick();
    installAudioUnlock(); // first tap/key anywhere switches sound on (needed on iPhone)

    const cam = this.cameras.main;
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    cam.startFollow(this.player, true, 0.15, 0.15, 0, 16);
    this.fitCamera();
    this.scale.on('resize', this.fitCamera, this);

    addProfileButton(() => void this.choose());
    if (!savedShowOwnTag()) this.me.setTagVisible(false);
    addSettingsSection(30, (box) =>
      box.append(
        switchRow('show-own-tag', 'Show my name tag', savedShowOwnTag(), (on) => {
          saveShowOwnTag(on);
          this.me.setTagVisible(on);
        }),
      ),
    );
    if (saved === null || name === null) void this.choose();
    else void this.start();

    if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
  }

  private async choose() {
    this.canMove = false;
    this.body.setVelocity(0, 0);
    const choice = await pickCharacter(this.textures, savedCharacter(), savedName());
    if (!choice) {
      this.canMove = true; // closed without changes
      return;
    }
    const { character, name } = choice;
    this.character = character;
    this.name = name;
    saveCharacter(character);
    saveName(name);
    this.me.setCharacter(character);
    this.me.setName(name);
    if (this.presence) this.presence.update({ character, name });
    void this.start();
  }

  // Joins the house once we know who we are.
  private async start() {
    this.canMove = true;
    if (this.starting) return;
    this.starting = true;
    showStatus('Connecting…', 'warn');
    const [{ Presence }, { Voice }] = await Promise.all([import('../net/presence'), import('../net/voice')]);
    this.presence = new Presence(
      { name: this.name, character: this.character, zone: this.zone },
      {
        onJoin: (p) => this.addRemote(p),
        onLeave: (id) => this.removeRemote(id),
        onInfo: (p) => this.updateRemote(p),
        onMove: (m) => this.receiveMove(m),
        onStatus: (s) => this.showPresenceStatus(s),
      },
      { lagMs: import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('lag')) || 0 : 0 },
    );
    this.presence.connect();

    const forceRelay = import.meta.env.DEV && new URLSearchParams(location.search).has('relay'); // test TURN on its own
    this.voice = new Voice(
      this.presence.id,
      {
        onSpeaking: (id, on) => (id === this.presence!.id ? this.me : this.remotes.get(id)?.avatar)?.setSpeaking(on),
        onStatus: (s) => this.voiceControls?.show(s),
        onAudioLocked: showSoundBanner,
        askMic: askForMic,
        volumeFor: (id) => savedVolume(this.remotes.get(id)?.info.name ?? ''),
      },
      { forceRelay },
    );
    this.voiceControls = new VoiceControls({
      onMute: (m) => this.voice!.setMuted(m),
      onPushToTalk: (on) => this.voice!.setPushToTalk(on),
      onTalking: (t) => this.voice!.setTalking(t),
    });
    addVoiceSettings(this.voice, this.voiceControls);
    this.updateVoice();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice?.leave());
    window.addEventListener('pagehide', () => {
      this.voice?.leave();
      this.presence?.leave();
    });
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
    this.presenceState = s;
    this.refreshRooms();
    if (s === 'connecting') showStatus('Connecting…', 'warn');
    else if (s === 'offline') showStatus('Offline', 'bad');
    else if (this.zone && this.zone !== 'hallway') showStatus(`${this.countIn(this.zone)} here`, 'ok');
    else showStatus(`${this.activeCount()} in the house`, 'ok');
  }

  // Nameplate faces and room warmth, from who's where.
  private refreshRooms() {
    for (const room of ROOM_IDS) {
      const chars: number[] = [];
      if (this.zone === room) chars.push(this.character);
      for (const r of this.remotes.values()) if (r.active && r.info.zone === room) chars.push(r.info.character);
      this.look.setOccupants(room, chars);
    }
  }

  // People in a zone, counting you if you're there.
  countIn(zone: Zone) {
    let n = this.zone === zone ? 1 : 0;
    for (const r of this.remotes.values()) if (r.active && r.info.zone === zone) n++;
    return n;
  }

  private activeCount() {
    let n = 1;
    for (const r of this.remotes.values()) if (r.active) n++;
    return n;
  }

  private addRemote(p: PlayerInfo) {
    const avatar = new Avatar(this, 0, 0, p.character, p.name);
    avatar.setVisible(false); // shown once we know where they are
    avatar.sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tapAvatar(p.id));
    this.remotes.set(p.id, { avatar, info: p, motion: null, glide: { dx: 0, dy: 0, at: 0 }, clockOffset: Infinity, lastHeard: 0, active: false });
    this.sendMove(true); // so the newcomer sees us straight away
    const early = this.earlyMoves.get(p.id);
    this.earlyMoves.delete(p.id);
    if (early) this.receiveMove(early);
    this.showPresenceStatus('online');
  }

  // Tapping someone you're in a voice room with opens their volume slider.
  private tapAvatar(id: string) {
    this.tappedAvatar = true;
    const r = this.remotes.get(id);
    if (!r || !this.voice?.hasPeer(id)) return;
    const name = r.info.name;
    showVolumePopover(name, savedVolume(name), (v) => {
      saveVolume(name, v);
      this.voice?.setVolume(id, v);
    });
  }

  private removeRemote(id: string) {
    this.earlyMoves.delete(id);
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

  private receiveMove(m: MoveMsg) {
    const r = this.remotes.get(m.id);
    if (!r) {
      if (this.earlyMoves.size < 32) this.earlyMoves.set(m.id, m);
      return;
    }
    const now = Date.now();
    r.clockOffset = Math.min(r.clockOffset, now - m.t);
    const motion: Motion = { t: m.t + r.clockOffset, x: m.x, y: m.y, vx: m.vx, vy: m.vy, dir: m.dir };
    if (r.motion && motion.t <= r.motion.t) return; // out of order
    const moved = r.info.zone !== m.zone;
    r.info.zone = m.zone;
    r.lastHeard = now;
    if (moved && r.active) this.showPresenceStatus(this.presenceState);
    if (!r.active) {
      r.active = true;
      r.motion = motion;
      r.avatar.setPosition(m.x, m.y);
      r.avatar.setVisible(true);
      this.showPresenceStatus('online');
      return;
    }
    // Where the new message says they are now, versus where we're drawing them: glide small differences
    // away, jump big ones (e.g. a wall stopped them before we heard).
    r.motion = motion;
    const [px, py] = this.predict(motion, now);
    const dx = r.avatar.sprite.x - px;
    const dy = r.avatar.sprite.y - py;
    r.glide = Math.hypot(dx, dy) > SNAP_OVER ? { dx: 0, dy: 0, at: 0 } : { dx, dy, at: now };
  }

  private predict(m: Motion, now: number): [number, number] {
    const dt = Math.min(Math.max(now - m.t, 0), EXTRAPOLATE_MAX) / 1000;
    return [m.x + m.vx * dt, m.y + m.vy * dt];
  }

  // Sends our movement only when it changes, plus corrections and a heartbeat (see CORRECT_EVERY).
  private sendMove(force = false) {
    if (!this.presence) return;
    // Velocity we're really moving at: input, minus any direction a wall is blocking.
    const b = this.body.blocked;
    let { x: vx, y: vy } = this.body.velocity;
    if ((vx < 0 && b.left) || (vx > 0 && b.right)) vx = 0;
    if ((vy < 0 && b.up) || (vy > 0 && b.down)) vy = 0;
    vx = Math.round(vx);
    vy = Math.round(vy);
    const dir = this.me.facing;
    const now = performance.now();
    const s = this.sent;
    const moving = vx !== 0 || vy !== 0;
    const changed = !s || s.vx !== vx || s.vy !== vy || s.dir !== dir;
    const due = s && now - s.at >= (moving ? CORRECT_EVERY : IDLE_RESEND);
    if (!force && !changed && !due) return;
    this.sent = { vx, vy, dir, at: now };
    // Body position, not the sprite: the sprite only catches up with physics after this update runs.
    const tenth = (n: number) => Math.round(n * 10) / 10; // whole pixels would make corrections wobble back and forth
    this.presence.sendMove({ x: tenth(this.body.center.x), y: tenth(this.body.bottom), vx, vy, dir, zone: this.zone });
  }

  // Draws everyone else where their last message says they should be by now, gliding out corrections.
  private moveRemotes() {
    const now = Date.now();
    for (const r of this.remotes.values()) {
      if (r.active && now - r.lastHeard > STALE_AFTER) {
        r.active = false;
        r.motion = null;
        r.avatar.setVisible(false);
        this.showPresenceStatus('online');
      }
      if (!r.active || !r.motion) continue;
      const m = r.motion;
      let [x, y] = this.predict(m, now);
      const k = r.glide.at ? Math.max(0, 1 - (now - r.glide.at) / GLIDE_MS) : 0;
      x += r.glide.dx * k;
      y += r.glide.dy * k;
      r.avatar.setPosition(x, y);
      const walking = (m.vx !== 0 || m.vy !== 0) && now - m.t < EXTRAPOLATE_MAX;
      r.avatar.animate(walking, m.dir);
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
      this.showPresenceStatus(this.presenceState);
      this.presence?.update({ zone });
      this.sendMove(true);
      this.updateVoice();
    } else {
      this.sendMove();
    }

    this.moveRemotes();
  }

  private inputVelocity() {
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
    if (!vx && !vy && p.isDown && !p.wasTouch && !this.tappedAvatar && !volumePopoverOpen()) {
      const dx = p.worldX - this.player.x;
      const dy = p.worldY - (this.player.y - 8);
      if (Math.hypot(dx, dy) > 4) return eightWay(dx, dy).scale(SPEED);
    }
    const v = new Phaser.Math.Vector2(vx, vy);
    return v.lengthSq() > 0 ? v.normalize().scale(SPEED) : v;
  }
}

// Unit vector along the nearest of the 8 compass directions.
function eightWay(x: number, y: number) {
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
  return new Phaser.Math.Vector2(Math.round(Math.cos(a) * 1e6) / 1e6, Math.round(Math.sin(a) * 1e6) / 1e6);
}
