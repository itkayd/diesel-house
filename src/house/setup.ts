import Phaser from 'phaser';
import { type RoomId } from '../config';
import { Zones } from './zones';
import { HALL, ROOMS } from './rooms';
import { DEFAULT_SKIN, GUEST_SKINS, STARTERS } from '../characters';
import { installAudioUnlock } from '../net/audio';
import { signOut } from '../net/auth';
import { currentUser } from '../net/profile';
import { GameSpots } from '../scenes/gameSpots';
import { loadSounds } from '../ui/sounds';
import { addSoundSettings } from '../ui/soundSettings';
import { saveCharacter, savedCharacter, savedName, savedShowOwnTag, saveShowOwnTag } from '../prefs';
import { el } from '../ui/modal';
import { openCredits } from '../ui/credits';
import { addOldRooms } from '../ui/oldRooms';
import { icon } from '../ui/icons';
import { setPortraitSource } from '../ui/portrait';
import { isTouchDevice, Joystick } from '../ui/joystick';
import { addSettingsSection, switchRow } from '../ui/settings';
import { Avatar } from '../scenes/Avatar';
import { HouseLook } from '../scenes/houseLook';
import type { HouseScene } from '../scenes/HouseScene';

// Building the scene: the map, zones, furniture, you, physics, doors, the camera and the first settings.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

export function create(this: HouseScene) {
  const map = this.make.tilemap({ key: 'house' });
  setPortraitSource(this.textures);
  const tiles = [map.addTilesetImage('limezu_room_builder', 'limezu_room_builder')!, map.addTilesetImage('house_extra', 'house_extra')!];
  const floor = map.createLayer('floor', tiles)!;
  const walls = map.createLayer('walls', tiles)!;
  walls.setCollisionByExclusion([-1]);
  this.wallLayer = walls;

  // Where each part of the house is comes from src/house/rooms.ts (the map is built from the same file).
  this.zones = new Zones(map.width, map.height);
  // Rooms whose floor is one of the plain greys get a colour.
  for (const a of [{ id: 'hallway', ...HALL }, ...ROOMS]) {
    if (!a.tint) continue;
    const colour = Phaser.Display.Color.HexStringToColor(a.tint).color;
    for (const [tx, ty] of this.zones.tintTiles(a.id)) {
      const t = floor.getTileAt(tx, ty);
      if (t) t.tint = colour;
    }
  }
  this.look = new HouseLook(
    this,
    map,
    ROOMS.map((r) => ({ name: r.id, box: this.zones.box(r.id)! })),
  );

  this.spots = new GameSpots(this, map);
  this.setupDisco();
  this.setupRoomExtras(map);

  // Sprite position is the character's feet; the physics body is a small box around them.
  const spawnObj = map.findObject('zones', (o) => o.name === 'spawn');
  const spawn = { x: spawnObj?.x ?? 0, y: spawnObj?.y ?? 0 };
  this.spawnAt = spawn;
  const isGuest = !!currentUser()?.guest;
  const remembered = savedCharacter();
  // Guests choose from 2, members from the starters (the shop adds owned characters, phase S2).
  const saved = remembered !== null && (isGuest ? GUEST_SKINS : STARTERS).includes(remembered) ? remembered : null;
  const name = savedName();
  this.character = saved ?? DEFAULT_SKIN;
  if (saved) saveCharacter(saved); // an old number (before R4) is kept as its key from now on
  this.name = name ?? '';
  this.me = new Avatar(this, spawn.x!, spawn.y!, this.character, this.name, true);
  this.player = this.me.sprite;
  this.physics.add.existing(this.player);
  this.body = this.player.body as Phaser.Physics.Arcade.Body;
  this.body.setSize(10, 6).setOffset(3, 10); // the feet of a 16 px Ninja Adventure person
  this.physics.add.collider(this.player, walls);
  this.physics.add.collider(this.player, this.look.solids); // furniture bases
  // Doorways: an invisible barrier that only stops you when someone inside asked not to be disturbed
  // (and you haven't said you'll go in anyway).
  const doorBlocks = this.physics.add.staticGroup();
  for (const d of map.getObjectLayer('doors')?.objects ?? []) {
    const room = d.name as RoomId;
    const props = Object.fromEntries(((d.properties as { name: string; value: unknown }[] | undefined) ?? []).map((p) => [p.name, p.value]));
    // Where to stand in the hall just outside the door (worked out by the map builder).
    this.doorSpots.set(room, { x: Number(props.ax), y: Number(props.ay), north: props.side === 'north' });
    doorBlocks.add(this.add.rectangle(d.x!, d.y!, d.width!, d.height!).setOrigin(0).setVisible(false).setData('room', room));
  }
  doorBlocks.refresh();
  this.doorBlocks = doorBlocks;
  this.setupCritters();
  this.physics.add.collider(
    this.player,
    doorBlocks,
    (_p, b) => this.bumpQuietDoor((b as Phaser.GameObjects.Rectangle).getData('room')),
    (_p, b) => this.quietDoor((b as Phaser.GameObjects.Rectangle).getData('room')),
    this,
  );
  void loadSounds();
  addSoundSettings();
  this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  this.body.setCollideWorldBounds(true);

  // No key capture, so letters still reach text boxes (name, chat).
  this.keys = this.input.keyboard!.addKeys('up,down,left,right,w,a,s,d', false) as typeof this.keys;
  if (isTouchDevice()) this.joystick = new Joystick();
  installAudioUnlock(); // first tap/key anywhere switches sound on (needed on iPhone)

  const cam = this.cameras.main;
  cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  cam.startFollow(this.player, true, 0.15, 0.15, 0, 16);
  this.fitCamera(true);
  this.scale.on('resize', () => this.fitCamera(), this);
  // Turning the phone always re-fits (after the browser has settled on the new size).
  const refit = () => setTimeout(() => this.fitCamera(true), 300);
  addEventListener('orientationchange', refit);
  screen.orientation?.addEventListener?.('change', refit);

  this.setupProgress(); // includes the XP chip, which opens your profile
  this.me.onTagTap(() => this.openMyProfile());
  if (!savedShowOwnTag()) this.me.setTagVisible(false);
  addSettingsSection(
    30,
    (box) =>
      box.append(
        switchRow('show-own-tag', 'Show my name tag', 'Others always see it', savedShowOwnTag(), (on) => {
          saveShowOwnTag(on);
          this.me.setTagVisible(on);
        }),
      ),
    false,
    'more',
  );
  addSettingsSection(
    90,
    (box) => {
      const user = currentUser();
      if (!user) return;
      const out = el('button', 'dh-btn dh-btn--quiet');
      out.type = 'button';
      out.id = 'sign-out';
      out.textContent = user.guest ? 'Leave' : 'Sign out';
      out.addEventListener('click', async () => {
        out.disabled = true;
        try {
          this.voice?.leave();
          this.presence?.leave();
          await signOut();
        } finally {
          location.reload(); // even offline, so you're never left stuck on a dead button (BUGS.md #2)
        }
      });
      const credits = el('button', 'dh-btn dh-btn--quiet', 'Credits');
      credits.type = 'button';
      credits.id = 'credits-button';
      credits.addEventListener('click', openCredits);
      out.prepend(icon('log-out'));
      credits.style.flex = out.style.flex = '1';
      const row = el('div', 'dh-row');
      row.append(credits, out);
      const host = this.hosts.get(user.id);
      const who = el('small', 'dh-lede', !user.guest ? `Signed in as ${this.name}` : host ? `Visiting as ${host}'s friend (${this.name})` : `Visiting as a guest (${this.name})`);
      box.append(who, row);
    },
    true,
  );
  if (!isGuest) addOldRooms();
  void this.identify(saved, name);

  if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
}
