import Phaser from 'phaser';
import { ROOM_IDS, TILE_SIZE, type RoomId, type Zone } from '../config';
import { GUEST_CHARACTERS, guestCharacter, type Dir } from '../characters';
// Presence and Voice (and the Supabase client behind them) load after the picker; see start().
import type { MoveMsg, PlayerInfo, Presence } from '../net/presence';
import { installAudioUnlock } from '../net/audio';
import { msgStats } from '../net/stats';
import { signOut } from '../net/auth';
import { currentUser, loadNames, loadProfile, saveProfile } from '../net/profile';
import { loadRooms, roomLabel, updateRoom, type Room } from '../net/rooms';
import { letIn, myPasses, removeFromRoom } from '../net/passes';
import { guestHosts } from '../net/guestCodes';
import type { DiceMsg, DoorMsg, EmoteMsg } from '../net/presence';
import { GameSpots } from './gameSpots';
import { Games, gamesFor, type GameId } from '../games/controller';
import { Duel, type DuelMsg } from '../games/rps';
import { parseRoll, roll, rollText, type Roll } from '../games/dice';
import { randomSeed } from '../games/fair';
import { recordGame } from '../net/games';
import { postMessage } from '../net/chat';
import { loadSounds, play } from '../ui/sounds';
import { addSoundSettings } from '../ui/soundSettings';
import { ChatPanel } from '../ui/chat';
import type { Space, Voice } from '../net/voice';
import { saveCharacter, savedCharacter, saveName, savedName, savedShowOwnTag, saveShowOwnTag, savedVolume, saveVolume } from '../prefs';
import { setNetBadge, setRoomInfo, showWhere, zoneLabel } from '../ui/overlay';
import { addRoomSettings } from '../ui/roomSettings';
import { addGuestSettings } from '../ui/guestSettings';
import { el } from '../ui/modal';
import { openCredits } from '../ui/credits';
import { icon } from '../ui/icons';
import { setPortraitSource } from '../ui/portrait';
import { toast } from '../ui/toasts';
import { isTouchDevice, Joystick } from '../ui/joystick';
import { addProfileButton, pickCharacter } from '../ui/picker';
import { openProfile } from '../ui/profile';
import { askForMic, micAlreadyAllowed, resetMicDecline, showMicHelp } from '../ui/micPrompt';
import { modalOpen } from '../ui/modal';
import { addSettingsSection, switchRow } from '../ui/settings';
import { addVoiceSettings } from '../ui/voiceSettings';
import { friendMenuOpen, showFriendMenu } from '../ui/friendMenu';
import { EMOTE_EVERY, EMOTES, EmoteButton, isEmote, type EmoteId } from '../ui/emotes';
import { showSoundBanner } from '../ui/soundBanner';
import { VoiceControls } from '../ui/voiceControls';
import { Avatar } from './Avatar';
import { HouseLook } from './houseLook';
import { Hallway, WHISPER } from './hallway';
import { WalkieButton } from '../ui/walkie';
import { addHallwaySettings } from '../ui/hallwaySettings';
import { net, type NetQuality } from '../net/netQuality';
import { reloadForUpdate, watchForNewVersion } from '../ui/update';

const SPEED = 80; // px per second
const ZONE_SETTLE_MS = 150; // a zone change counts once you have been in the new zone this long
const SLOW = 0.5; // joystick half-push speed, as a fraction of SPEED
// Movement messages: one when movement changes, a correction every 500 ms while walking, a heartbeat
// every 15 s while standing still. Other screens extrapolate in between (dead reckoning).
const CORRECT_EVERY = 500;
const IDLE_RESEND = 15_000;
const EXTRAPOLATE_MAX = 750; // ms past the last message we keep walking someone forward (then wait for news)
const SNAP_OVER = 24; // px: corrections bigger than this jump; smaller ones glide
const GLIDE_MS = 150; // ms to glide out a small correction
const STALE_AFTER = 30_000; // ms without any message before someone is hidden (locked phone, closed tab)
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
  private hosts = new Map<string, string>(); // guest id -> the member who invited them
  private hostsAsked = 0;
  private zoneCandidate: Zone | null = null;
  private zoneSince = 0;
  private micWarned = false;
  private lastStep = 0;
  private hallShown = 0;
  private myMic: PlayerInfo['mic'];
  private myNet: NetQuality | undefined;
  private stepFoot = false; // "Others can't hear you" shown this visit
  // Movement that arrived before presence told us who sent it (presence is slower); used once they join.
  private earlyMoves = new Map<string, MoveMsg>();
  private sent: Sent | null = null;
  readonly msgStats = msgStats; // dev checks: messages per minute
  private voice: Voice | null = null;
  private voiceControls: VoiceControls | null = null;
  private voiceTimer: Phaser.Time.TimerEvent | null = null;
  // Hallway voice: whisper + walkie-talkie rules, and the walkie button (UPDATE.md Phase 10).
  private hallway: Hallway | null = null;
  private walkie: WalkieButton | null = null;
  private lastEmote = 0; // when we last sent one
  private lastEmoteFrom = new Map<string, number>(); // when each person's last emote was shown
  private spots!: GameSpots;
  private games: Games | null = null;
  private duel: Duel | null = null;
  private duelInvite: { id: string; to: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastRoll = 0;
  private starting = false;
  private presenceState: 'connecting' | 'reconnecting' | 'online' | 'offline' = 'connecting';
  look!: HouseLook;
  private tappedAvatar = false; // pointer went down on a character: don't start walking towards it
  private rooms = new Map<RoomId, Room>();
  private ownerNames = new Map<string, string>();
  private replacedToast: (() => void) | null = null;
  // Doors: where each doorway is, which rooms you hold a pass for, and when you last knocked.
  private doorSpots = new Map<RoomId, { x: number; y: number; north: boolean }>();
  private passes = new Set<RoomId>();
  private lastDoorNote = 0;
  private lastKnock = new Map<RoomId, number>();
  private chat: ChatPanel | null = null;

  constructor() {
    super('House');
  }

  create() {
    const map = this.make.tilemap({ key: 'house' });
    setPortraitSource(this.textures);
    const tiles = map.addTilesetImage('limezu_room_builder', 'limezu_room_builder')!;
    const floor = map.createLayer('floor', tiles)!;
    const walls = map.createLayer('walls', tiles)!;
    walls.setCollisionByExclusion([-1]);

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

    this.spots = new GameSpots(this, map);

    // Sprite position is the character's feet; the physics body is a small box around them.
    const spawn = map.findObject('zones', (o) => o.name === 'spawn')!;
    const isGuest = !!currentUser()?.guest;
    const remembered = savedCharacter();
    const saved = isGuest && remembered !== null && !GUEST_CHARACTERS.includes(remembered) ? null : remembered; // guests: 2 choices
    const name = savedName();
    this.character = saved ?? 0;
    this.name = name ?? '';
    this.me = new Avatar(this, spawn.x!, spawn.y!, this.character, this.name, true);
    this.player = this.me.sprite;
    this.physics.add.existing(this.player);
    this.body = this.player.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(10, 6).setOffset(3, 26);
    this.physics.add.collider(this.player, walls);
    this.physics.add.collider(this.player, this.look.solids); // furniture bases
    // Doorways: an invisible barrier that only stops you going in when the door is shut to you.
    const doorBlocks = this.physics.add.staticGroup();
    for (const d of map.getObjectLayer('doors')?.objects ?? []) {
      const room = d.name as RoomId;
      const north = (d.properties as { name: string; value: string }[] | undefined)?.find((p) => p.name === 'side')?.value === 'north';
      this.doorSpots.set(room, { x: d.x! + d.width! / 2, y: north ? d.y! + d.height! + 14 : d.y! - 6, north });
      doorBlocks.add(this.add.rectangle(d.x!, d.y!, d.width!, d.height!).setOrigin(0).setVisible(false).setData('room', room));
    }
    doorBlocks.refresh();
    this.physics.add.collider(
      this.player,
      doorBlocks,
      (_p, b) => this.bumpDoor((b as Phaser.GameObjects.Rectangle).getData('room')),
      (_p, b) => this.doorShut((b as Phaser.GameObjects.Rectangle).getData('room')),
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

    addProfileButton(() => this.openMyProfile());
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
          this.voice?.leave();
          this.presence?.leave();
          await signOut();
          location.reload();
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
    void this.identify(saved, name);

    if (import.meta.env.DEV) (window as unknown as { __house: HouseScene }).__house = this; // used by automated checks
  }

  // Who are you? Your profile if you have one; otherwise the picker, once, saved to your profile.
  private async identify(saved: number | null, name: string | null) {
    const user = currentUser();
    if (user && !user.guest) {
      const profile = await loadProfile(user.id);
      if (profile && !profile.picked) {
        // Just joined: their name is known, the character isn't chosen yet.
        saveName(profile.display_name);
        return void this.choose(true);
      }
      if (profile) {
        this.applyIdentity(profile.character_index, profile.display_name);
        return void this.start();
      }
      // New here: offer the picker, prefilled with anything this device remembers.
      return void this.choose();
    }
    if (user?.guest) void this.hostOf(user.id); // for the settings line
    if (saved === null || name === null) void this.choose();
    else void this.start();
  }

  // Whose friend a guest is. Asks the database again (at most every 3 s) when someone new turns up.
  private async hostOf(id: string): Promise<string | null> {
    if (!this.hosts.has(id) && Date.now() - this.hostsAsked > 3000) {
      this.hostsAsked = Date.now();
      this.hosts = await guestHosts();
    }
    return this.hosts.get(id) ?? null;
  }

  // Why you might not hear someone in your room: shown on their name tag.
  // In a room, everyone's tag shows their mic: green = on, red crossed = muted or no mic, amber crossed =
  // mic not working (plus the words, since that one needs explaining). Connection bars show everywhere.
  private showMicNote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    const inRoom = !!r.info.zone && r.info.zone !== 'hallway';
    const mic = r.info.mic;
    r.avatar.setMic(!inRoom || !mic ? null : mic === 'on' ? 'on' : mic === 'silent' ? 'warn' : 'off');
    r.avatar.setNote(inRoom && mic === 'silent' ? 'mic not working' : null);
    r.avatar.setNet(r.info.net ?? null);
  }

  // Our own tag: the same mic icon (in a room) and our connection bars.
  private showMyMic() {
    const inRoom = !!this.zone && this.zone !== 'hallway' && !!this.voice?.room;
    const s = this.voice?.micState;
    this.me.setMic(!inRoom || !s ? null : s === 'on' ? 'on' : s === 'silent' ? 'warn' : 'off');
  }

  // Our mic is on but gives only silence (another app has it, usually): tell them, offer to try again.
  private warnSilentMic() {
    toast({
      icon: 'mic-off',
      id: 'mic-silent-toast',
      who: "Your mic isn't picking up any sound",
      what: 'Another app may be using it (a call, WhatsApp). Close it, then tap Try again.',
      ttl: 0,
      actions: [{ label: 'Try again', id: 'mic-silent-retry', onClick: () => void this.voice?.restartMic() }],
    });
  }

  private showHost(p: PlayerInfo) {
    if (p.guest) void this.hostOf(p.id).then((h) => this.remotes.get(p.id)?.avatar.setHost(h));
  }

  private applyIdentity(character: number, name: string) {
    this.character = character;
    this.name = name;
    saveCharacter(character);
    saveName(name);
    this.me.setCharacter(character);
    this.me.setName(name);
  }

  // `mustPick`: first visit, no way to close without choosing.
  private async choose(mustPick = false) {
    this.canMove = false;
    this.body.setVelocity(0, 0);
    const guest = !!currentUser()?.guest;
    const remembered = savedCharacter();
    const current = guest && remembered !== null && !GUEST_CHARACTERS.includes(remembered) ? null : remembered;
    const choice = await pickCharacter(this.textures, current, savedName(), mustPick ? false : undefined, guest ? GUEST_CHARACTERS : undefined);
    if (!choice) {
      this.canMove = true; // closed without changes
      void this.start(); // still join the house (does nothing if already in)
      return;
    }
    const { character, name } = choice;
    this.applyIdentity(character, name);
    const user = currentUser();
    if (user && !user.guest) await saveProfile(user.id, name, character);
    if (this.presence) this.presence.update({ character, name });
    void this.start();
  }

  // Walkie pressed: needs the mic (asked here, from the tap, if the hallway joined listening only).
  private async pressWalkie() {
    const voice = this.voice;
    const hall = this.hallway;
    if (!voice || !hall || voice.space !== 'hallway') return;
    if (!voice.micStream) {
      const ok = await askForMic(new Promise<void>(() => {}));
      if (ok) {
        voice.leave();
        await voice.join('hallway');
        toast({ icon: 'radio', id: 'walkie-ready', who: 'Walkie ready', what: 'Hold the button again to talk.', small: true, ttl: 2400 });
      }
      return;
    }
    hall.press();
  }

  // Walkie button, on-air strip, icons over heads, whisper "…" and our whisper ring.
  private showHallway() {
    const hall = this.hallway;
    if (!hall) return;
    const talker = hall.talkerId;
    const name = !talker ? null : talker === this.presence?.id ? this.name : (this.remotes.get(talker)?.info.name ?? null);
    this.walkie?.show(hall.meTalking ? 'talking' : hall.busy ? 'busy' : 'idle', this.zone === 'hallway' ? name : null, hall.secondsLeft);
    const inHall = this.zone === 'hallway' && this.voice?.space === 'hallway';
    this.me.setRadio(inHall && hall.meTalking);
    this.me.setWhisperRing(inHall && !hall.meTalking && hall.whisperOn && hall.someoneNear && !!this.voice?.micStream ? WHISPER : null);
    for (const r of this.remotes.values()) {
      const there = inHall && r.active && r.info.zone === 'hallway';
      r.avatar.setRadio(there && talker === r.info.id);
      r.avatar.setWhispering(there && talker !== r.info.id && r.avatar.speaking && hall.route(r.info.id).mode === 'whisper');
    }
  }

  // Your profile (HUD button, or tap your own name tag).
  private openMyProfile() {
    const user = currentUser();
    if (!user) return void this.choose();
    const owned = [...this.rooms.values()].find((r) => r.owner_id === user.id);
    openProfile({
      name: this.name,
      character: this.character,
      ownedRoom: owned ? zoneLabel(owned.id) : null,
      host: this.hosts.get(user.id) ?? null,
      changeCharacter: () => void this.choose(),
      rename: async (name) => {
        this.applyIdentity(this.character, name);
        if (!user.guest) {
          await saveProfile(user.id, name, this.character);
          this.ownerNames.set(user.id, name);
          this.showRooms();
        }
        this.presence?.update({ name });
      },
    });
  }

  // The mic isn't reaching anyone: if the browser or phone refused it, explain how to fix that first;
  // then ask again (rejoining the room re-runs the mic card and the browser prompt). A silent mic is
  // simply reopened.
  private async fixMic() {
    if (!this.voice) return;
    if (this.voice.isSilent) return void this.voice.restartMic();
    const problem = this.voice.micProblem;
    if (problem && problem !== 'declined' && !(await showMicHelp(problem))) return;
    resetMicDecline();
    const space = this.voice.space;
    this.voice.leave();
    if (space) void this.voice.join(space);
  }

  // Joins the house once we know who we are.
  private async start() {
    this.canMove = true;
    if (this.starting) return;
    this.starting = true;
    showWhere(this.zone, 'Connecting…', 'warn');
    let modules;
    try {
      modules = await Promise.all([import('../net/presence'), import('../net/voice')]);
    } catch (e) {
      // Usually an old copy of the game after an update (its files are gone): load the new one.
      console.warn('Could not load the game files', e);
      if (!reloadForUpdate()) showWhere(this.zone, 'Offline · reload the page', 'off');
      return;
    }
    const [{ Presence }, { Voice }] = modules;
    this.presence = new Presence(
      currentUser()?.id ?? crypto.randomUUID(),
      { name: this.name, character: this.character, zone: this.zone, guest: !!currentUser()?.guest },
      {
        onJoin: (p) => this.addRemote(p),
        onLeave: (id) => this.removeRemote(id),
        onInfo: (p) => this.updateRemote(p),
        onMove: (m) => this.receiveMove(m),
        onStatus: (s) => this.showPresenceStatus(s),
        onSyncRequest: () => this.sendMove(true),
        onReconnected: () => {
          this.sendMove(true); // so everyone sees us again straight away
          // Voice may have died with the socket: rejoin the room (or hallway) we're in.
          const space = this.voice?.space;
          if (space) {
            this.voice!.leave();
            void this.voice!.join(space);
          }
        },
        onRoomChange: (room) => void this.roomChanged(room),
        onDoor: (m) => void this.doorMessage(m),
        onEmote: (m) => this.receiveEmote(m),
        onDice: (m) => this.receiveDice(m),
        onDuel: (m) => this.receiveDuel(m),
        onChat: (e) => {
          this.chat?.event(e);
          // Short new messages pop up over the sender's head.
          const text = String(e.row.text ?? '');
          if (e.table === 'messages' && e.type === 'INSERT' && e.row.kind !== 'roll' && text.length < 40) {
            const id = String(e.row.author_id);
            (id === this.presence?.id ? this.me : this.remotes.get(id)?.avatar)?.say(text);
          }
        },
        onReplaced: () => this.replaced(),
      },
      { lagMs: import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('lag')) || 0 : 0 },
    );
    this.presence.connect();
    net.start();
    // New version live? Reload at once if we're not talking to anyone; otherwise offer it.
    watchForNewVersion(
      () => (this.voice?.debug().length ?? 0) > 0,
      (reload) =>
        toast({ icon: 'refresh-cw', id: 'new-version', who: 'New version of the house', what: 'Reload when you are ready.', ttl: 0, actions: [{ label: 'Reload', id: 'new-version-reload', onClick: reload }] }),
    );
    net.onChange((q) => {
      this.myNet = q;
      this.sendMove(true); // shared on the next move message, not presence (see presence.ts)
      this.me.setNet(q);
      setNetBadge(q);
    });

    const forceRelay = import.meta.env.DEV && new URLSearchParams(location.search).has('relay'); // test TURN on its own
    const hall = new Hallway({
      myId: () => this.presence!.id,
      me: () => ({ x: this.player.x, y: this.player.y, inHall: this.zone === 'hallway' }),
      peer: (id) => {
        const r = this.remotes.get(id);
        return r?.active ? { x: r.avatar.sprite.x, y: r.avatar.sprite.y, inHall: r.info.zone === 'hallway', mic: r.info.mic === 'on' || r.info.mic === 'silent' } : null;
      },
      myMic: () => !!this.voice?.micStream,
      send: (m) => this.voice?.sendWalkie(m),
      onChange: () => this.showHallway(),
    });
    hall.idsInHall = () => [...this.remotes.values()].filter((r) => r.active && r.info.zone === 'hallway').map((r) => r.info.id);
    this.hallway = hall;
    this.voice = new Voice(
      this.presence.id,
      {
        onSpeaking: (id, on) => (id === this.presence!.id ? this.me : this.remotes.get(id)?.avatar)?.setSpeaking(on),
        onStatus: (s) => {
          // The mic button is for rooms; the hallway has the walkie button instead (design/game/v2.html).
          this.voiceControls?.show(this.voice?.space === 'hallway' ? { state: 'off' } : s);
          this.showMyMic();
          // Tried to use the mic and it failed: say so once, so nobody talks without being heard.
          const problem = this.voice?.micProblem;
          if (s.state === 'in-room' && s.mic === 'blocked' && problem && problem !== 'declined' && !this.micWarned) {
            this.micWarned = true;
            toast({ icon: 'mic-off', id: 'mic-toast', who: "Others can't hear you", what: 'Tap the mic button to fix it.', ttl: 8000 });
          }
        },
        onAudioLocked: showSoundBanner,
        // The hallway only uses the mic if it was allowed before (no question just for walking in).
        askMic: (cancelled, space) => (space === 'hallway' ? micAlreadyAllowed() : askForMic(cancelled)),
        hall,
        onWalkie: (m) => hall.onMessage(m),
        volumeFor: (id) => savedVolume(id),
        onMicState: (s) => {
          this.myMic = s;
          this.sendMove(true);
          this.showMyMic();
          if (s === 'silent') this.warnSilentMic();
        },
      },
      { forceRelay },
    );
    this.voiceControls = new VoiceControls({
      onMute: (m) => this.voice!.setMuted(m),
      onPushToTalk: (on) => this.voice!.setPushToTalk(on),
      onTalking: (t) => this.voice!.setTalking(t),
      onBlockedTap: () => void this.fixMic(),
    });
    this.walkie = new WalkieButton({
      press: () => void this.pressWalkie(),
      release: () => this.hallway?.release(),
      key: () => this.hallway?.walkieKey ?? 't',
    });
    addHallwaySettings(hall);
    new EmoteButton((e) => this.sendEmote(e));
    // Keys 1-6: quick emotes. Q: the menu for whoever is right next to us.
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, textarea, select, [contenteditable]')) return;
      const n = Number(e.key);
      if (e.key.toLowerCase() === 'e' && this.games?.promptFor) this.games.open(this.games.promptFor);
      else if (n >= 1 && n <= 6) this.sendEmote(EMOTES[n - 1].id);
      else if (e.key.toLowerCase() === 'q') {
        const id = this.nearestRemote(48);
        if (id) this.tapAvatar(id);
      }
    });
    this.chat = new ChatPanel(
      () => ({ id: this.presence!.id, name: this.name, character: this.character }),
      (text) => {
        const r = parseRoll(text);
        if (r) this.rollDice(roll(r.n, r.sides));
        return !!r;
      },
    );
    this.games = new Games({
      me: () => ({ id: this.presence!.id, name: this.name, character: this.character, guest: !!currentUser()?.guest }),
      names: (id) => (id === this.presence?.id ? { name: this.name, character: this.character } : (this.remotes.get(id)?.info ?? { name: '', character: 0 })),
      nearby: () =>
        [...this.remotes.values()].filter((r) => r.active && r.info.zone === this.zone).map((r) => ({ id: r.info.id, name: r.info.name, character: r.info.character })),
      allowed: (spot) => (spot === 'hall' ? null : ((this.rooms.get(spot)?.games as GameId[] | null | undefined) ?? null)),
      prompts: (spot) => (spot === 'hall' ? [] : (this.rooms.get(spot)?.prompts ?? [])),
      kind: (spot) => this.spots.kind(spot),
      roll: (r) => this.rollDice(r),
      challenge: (id) => this.startDuel(id),
      record: (game, spot, players, winners, score, seed) => void recordGame(game, spot, players, winners, score, seed),
    });
    this.chat.setRoom(this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null);
    addVoiceSettings(this.voice, this.voiceControls, () => {
      document.getElementById('settings-close')?.click();
      void this.fixMic();
    });
    addRoomSettings(
      () => [...this.rooms.values()].find((r) => r.owner_id && r.owner_id === currentUser()?.id) ?? null,
      async (change) => {
        const mine = [...this.rooms.values()].find((r) => r.owner_id === currentUser()?.id);
        if (!mine) return 'not your room';
        const err = await updateRoom(mine.id, change);
        if (!err) await this.roomChanged({ ...mine, ...change });
        return err;
      },
      (room) => gamesFor(this.spots.kind(room.id)),
    );
    addGuestSettings(() => {
      const u = currentUser();
      return u && !u.guest ? u.id : null;
    });
    void this.loadRooms();
    const me = currentUser();
    if (me) void myPasses(me.id).then((p) => (this.passes = p));
    this.updateVoice();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice?.leave());
    window.addEventListener('pagehide', () => {
      this.voice?.leave();
      this.presence?.leave();
    });
  }

  // Leaving a room cuts voice at once; joining waits until you've actually stepped in.
  private updateVoice() {
    if (!this.voice || this.presence?.isReplaced) return;
    this.voiceTimer?.remove();
    this.voiceTimer = null;
    // A room, the hallway (whisper + walkie), or nowhere. Rooms and the hallway never hear each other.
    const space: Space | null = this.zone === 'hallway' ? 'hallway' : this.zone ? (this.zone as RoomId) : null;
    if (space !== 'hallway') this.hallway?.leftHallway();
    if (space === 'hallway' && this.voice.room)
      toast({ icon: 'volume-x', id: 'back-in-hallway', who: 'Back in the hallway', what: 'Room voice off. Get close to someone to whisper.', small: true, ttl: 2200 });
    this.walkie?.setVisible(space === 'hallway');
    if (!space) {
      this.voice.leave();
      return;
    }
    if (this.voice.space === space) return;
    this.voice.leave();
    this.voiceTimer = this.time.delayedCall(JOIN_VOICE_AFTER, () => void this.voice!.join(space));
  }

  private showPresenceStatus(s: 'connecting' | 'reconnecting' | 'online' | 'offline') {
    this.presenceState = s;
    this.refreshRooms();
    if (s === 'connecting') showWhere(this.zone, 'Connecting…', 'warn');
    else if (s === 'reconnecting') showWhere(this.zone, 'Reconnecting…', 'warn');
    else if (s === 'offline') showWhere(this.zone, 'Offline', 'off');
    else if (this.zone && this.zone !== 'hallway') showWhere(this.zone, `${this.countIn(this.zone)} here`, 'ok');
    else showWhere(this.zone, `${this.activeCount()} in the house`, 'ok');
  }

  // Rooms from the database: names, moods, door states, owners. Kept live via the house channel.
  private async loadRooms() {
    const rooms = await loadRooms();
    this.ownerNames = await loadNames([...new Set(rooms.map((r) => r.owner_id).filter((x): x is string => !!x))]);
    for (const r of rooms) this.rooms.set(r.id, r);
    this.showRooms();
  }

  private async roomChanged(room: Room) {
    if (room.owner_id && !this.ownerNames.has(room.owner_id)) {
      const names = await loadNames([room.owner_id]);
      names.forEach((v, k) => this.ownerNames.set(k, v));
    }
    this.rooms.set(room.id, room);
    this.showRooms();
  }

  private showRooms() {
    const info = (zone: Zone) => {
      if (zone === 'hallway') return { name: 'Hallway', mood: null };
      const r = this.rooms.get(zone);
      return { name: roomLabel(r, r?.owner_id ? this.ownerNames.get(r.owner_id) : undefined, `Room ${Number(zone.slice(-2))}`), mood: r?.mood ?? null };
    };
    setRoomInfo(info);
    for (const id of ROOM_IDS) {
      const r = this.rooms.get(id);
      this.look.setRoom(id, { ...info(id), door: r?.door_state ?? 'open' });
    }
    this.showPresenceStatus(this.presenceState);
  }

  // ---- doors ----

  private ownerName(room: RoomId) {
    const owner = this.rooms.get(room)?.owner_id;
    return owner ? (this.ownerNames.get(owner) ?? 'the owner') : null;
  }

  // Is this door shut to you right now? (Never stops you leaving a room you're already in.)
  private doorShut(room: RoomId) {
    const r = this.rooms.get(room);
    if (!r || r.door_state === 'open' || this.zone === room) return false;
    const me = currentUser()?.id;
    return !(me && r.owner_id === me) && !this.passes.has(room);
  }

  // Walked into a shut door: knock (knock-first) or say it's locked.
  private bumpDoor(room: RoomId) {
    const now = Date.now();
    if (now - this.lastDoorNote < 3500) return;
    this.lastDoorNote = now;
    const r = this.rooms.get(room)!;
    const label = zoneLabel(room);
    const owner = this.ownerName(room);
    if (r.door_state === 'locked') {
      toast({ icon: 'lock', who: `${label} is locked`, what: owner ? `Ask ${owner} to open the door.` : 'Nobody can go in right now.', ttl: 2600 });
      return;
    }
    if (!r.owner_id || !this.remotes.get(r.owner_id)?.active) {
      toast({ icon: 'hand', who: "Nobody's home", what: `${owner ?? 'The owner'} isn't in the house right now.`, ttl: 2600 });
      return;
    }
    if (now - (this.lastKnock.get(room) ?? 0) < 10_000) {
      toast({ icon: 'hand', who: 'Still waiting…', what: `${owner} hasn't answered yet.`, small: true, ttl: 2000 });
      return;
    }
    this.lastKnock.set(room, now);
    this.presence?.sendDoor({ kind: 'knock', room, to: r.owner_id, name: this.name, character: this.character });
    play('knock');
    toast({ icon: 'hand', who: `You knocked on ${owner}'s door`, what: 'Waiting for them to answer…', ttl: 3000 });
  }

  private async doorMessage(m: DoorMsg) {
    const me = currentUser()?.id;
    const room = this.rooms.get(m.room);
    const label = zoneLabel(m.room);
    if (m.kind === 'knock') {
      if (!room || room.owner_id !== me) return; // only the owner answers
      play('knock');
      play('doorbell', 0.6);
      toast({
        face: m.character,
        id: 'knock-toast',
        who: `${m.name} is knocking`,
        what: `at ${label}`,
        ttl: 30_000,
        actions: [
          {
            label: 'Let in',
            id: 'let-in',
            onClick: async () => {
              const err = await letIn(m.room, m.from);
              if (err) toast({ icon: 'lock', who: "Couldn't let them in", what: err, ttl: 3000 });
              else this.presence?.sendDoor({ kind: 'let-in', room: m.room, to: m.from, name: this.name, character: this.character });
            },
          },
          { label: 'Not now', quiet: true, id: 'not-now', onClick: () => this.presence?.sendDoor({ kind: 'not-now', room: m.room, to: m.from, name: this.name, character: this.character }) },
        ],
      });
    } else if (m.kind === 'let-in') {
      if (!me) return;
      this.passes = await myPasses(me); // trust the database, not the message
      if (!this.passes.has(m.room)) return;
      play('door_open');
      toast({ face: m.character, who: `${m.name} let you in`, what: 'Come in!', small: true, ttl: 2600 });
    } else if (m.kind === 'not-now') {
      toast({ face: m.character, who: `${m.name} can't let you in right now`, small: true, ttl: 2600 });
    } else if (m.kind === 'kick') {
      if (!room || room.owner_id !== m.from) return; // only the room's owner can ask you to leave
      this.passes.delete(m.room);
      if (this.zone === m.room) {
        const spot = this.doorSpots.get(m.room);
        this.voice?.leave();
        if (spot) this.body.reset(spot.x, spot.y);
        this.sendMove(true);
      }
      toast({ face: m.character, who: `${m.name} asked you to leave`, what: label, ttl: 3500 });
    }
  }

  // Owner: take someone out of your room (their pass goes; they're moved to the hallway).
  private async removeFromMyRoom(room: RoomId, id: string) {
    const err = await removeFromRoom(room, id);
    if (err && err !== 'offline') toast({ icon: 'lock', who: "Couldn't remove them", what: err, ttl: 3000 });
    this.presence?.sendDoor({ kind: 'kick', room, to: id, name: this.name, character: this.character });
  }

  // Same person opened Diesel House somewhere else: this tab goes quiet until they take it back.
  private replaced() {
    this.voice?.leave();
    this.canMove = false;
    this.body.setVelocity(0, 0);
    this.replacedToast?.();
    this.replacedToast = toast({
      icon: 'user-round',
      id: 'replaced-toast',
      who: 'You opened Diesel House somewhere else',
      what: 'This tab has gone quiet.',
      ttl: 0,
      actions: [
        {
          label: 'Use it here',
          id: 'use-here',
          onClick: () => {
            this.replacedToast = null;
            this.presence?.reclaim();
            this.canMove = true;
            this.sendMove(true);
            this.updateVoice();
          },
        },
      ],
    });
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
    if (p.guest) p = { ...p, character: guestCharacter(p.character) };
    const avatar = new Avatar(this, 0, 0, p.character, p.name);
    avatar.setVisible(false); // shown once we know where they are
    avatar.setGuest(!!p.guest);
    this.showHost(p);
    queueMicrotask(() => this.showMicNote(p.id));
    avatar.sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tapAvatar(p.id));
    this.remotes.set(p.id, { avatar, info: p, motion: null, glide: { dx: 0, dy: 0, at: 0 }, clockOffset: Infinity, lastHeard: 0, active: false });
    this.sendMove(true); // so the newcomer sees us straight away
    const early = this.earlyMoves.get(p.id);
    this.earlyMoves.delete(p.id);
    if (early) this.receiveMove(early);
    this.showPresenceStatus('online');
  }

  // Tapping someone (or Q next to them) opens their menu: volume when we're in a call with them, emotes,
  // and for room owners "Remove from my room".
  private tapAvatar(id: string) {
    this.tappedAvatar = true;
    const r = this.remotes.get(id);
    if (!r || !r.active) return;
    const name = r.info.name;
    const room = r.info.zone && r.info.zone !== 'hallway' ? (r.info.zone as RoomId) : null;
    const mine = room && this.rooms.get(room)?.owner_id === currentUser()?.id ? room : null;
    const inCall = !!this.voice?.hasPeer(id) && this.voice.space === room;
    const near = Math.hypot(r.avatar.sprite.x - this.body.center.x, r.avatar.sprite.y - this.body.bottom) <= WHISPER;
    const where = room
      ? room === this.zone
        ? 'In this room with you.'
        : `In ${zoneLabel(room)}. Walk in to hear them.`
      : this.zone === 'hallway' && near
        ? 'You’re close enough to whisper.'
        : 'In the hallway. Get close to whisper.';
    showFriendMenu({
      name,
      character: r.info.character,
      volume: inCall
        ? {
            value: savedVolume(id),
            onChange: (v) => {
              saveVolume(id, v);
              this.voice?.setVolume(id, v);
            },
          }
        : undefined,
      where,
      onEmote: (e) => this.sendEmote(e, id),
      duel: this.duel || this.duelInvite ? undefined : () => this.startDuel(id),
      duelOff: 'You’re already in a duel',
      remove: mine ? { label: 'Remove from my room', id: 'remove-guest', onClick: () => void this.removeFromMyRoom(mine, id) } : undefined,
    });
  }

  // The nearest visible person within `range` px, if any.
  private nearestRemote(range: number) {
    let best: string | null = null;
    let bestD = range;
    for (const [id, r] of this.remotes) {
      if (!r.active || !r.avatar.sprite.visible) continue;
      const d = Math.hypot(r.avatar.sprite.x - this.body.center.x, r.avatar.sprite.y - this.body.bottom);
      if (d <= bestD) [best, bestD] = [id, d];
    }
    return best;
  }

  // Emotes (UPDATE.md Phase 11): over our head for everyone who can see us, at most one per 2 s.
  private sendEmote(e: EmoteId, to?: string) {
    const now = Date.now();
    if (now - this.lastEmote < EMOTE_EVERY || !this.presence) return;
    this.lastEmote = now;
    this.me.showEmote(e);
    play('emote', 0.6);
    this.presence.sendEmote(to ? { e, to } : { e });
  }

  // Dice (UPDATE.md Phase 12): over our head for everyone, and in a room a line in the chat.
  private rollDice(r: Roll) {
    const now = Date.now();
    if (now - this.lastRoll < 1500 || !this.presence) return;
    this.lastRoll = now;
    this.me.showDice(r.values, r.sides);
    play('dice_throw', 0.7);
    this.presence.sendDice({ v: r.values, s: r.sides });
    const room = this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null;
    if (room) void postMessage(room, rollText(r), { name: this.name, character: this.character }, 'roll');
  }

  private receiveDice(m: DiceMsg) {
    const r = this.remotes.get(m.from);
    if (!r || !Array.isArray(m.v) || m.v.length < 1 || m.v.length > 6) return;
    const sides = Math.max(2, Math.min(100, Number(m.s) || 6));
    const v = m.v.map((x) => Math.max(1, Math.min(sides, Math.round(Number(x) || 1))));
    r.avatar.showDice(v, sides);
    if (r.avatar.sprite.visible) play('dice_throw', 0.4);
  }

  // Rock-paper-scissors duel: invite, wait for yes, then both open the duel card.
  private startDuel(id: string) {
    const r = this.remotes.get(id);
    if (!r || !this.presence || this.duel || this.duelInvite) return;
    const duelId = randomSeed().slice(0, 12);
    this.presence.sendDuel({ k: 'invite', id: duelId, from: this.presence.id, to: id });
    this.duelInvite = { id: duelId, to: id, timer: setTimeout(() => this.cancelInvite('no answer'), 20_000) };
    toast({
      icon: 'swords',
      id: 'duel-wait',
      who: `Challenged ${r.info.name}`,
      what: 'Rock paper scissors. Waiting for them…',
      ttl: 0,
      actions: [{ label: 'Cancel', id: 'duel-cancel', onClick: () => this.cancelInvite('cancelled') }],
    });
  }

  private cancelInvite(why: 'no answer' | 'cancelled' | 'declined' | 'left') {
    const inv = this.duelInvite;
    if (!inv) return;
    clearTimeout(inv.timer);
    this.duelInvite = null;
    document.getElementById('duel-wait')?.remove();
    if (why === 'cancelled') this.presence?.sendDuel({ k: 'quit', id: inv.id, from: this.presence.id, to: inv.to });
    const name = this.remotes.get(inv.to)?.info.name ?? 'They';
    const who = why === 'declined' ? `${name} said not now` : why === 'left' ? `${name} left` : `${name} didn’t answer`;
    if (why !== 'cancelled') toast({ icon: 'swords', who, what: 'Maybe later.', small: true, ttl: 3000 });
  }

  private openDuel(id: string, them: string, host: boolean) {
    const r = this.remotes.get(them);
    if (!r || !this.presence) return;
    const me = { id: this.presence.id, name: this.name, character: this.character };
    this.duel = new Duel(
      id,
      me,
      { id: them, name: r.info.name, character: r.info.character },
      host,
      {
        send: (m) => this.presence?.sendDuel(m),
        record: (players, winners, score) => void recordGame('rps', 'duel', players, winners, score),
        onEnd: (winner, loser) => this.duelEnded(winner, loser),
      },
      () => (this.duel = null),
    );
    this.duel.open();
  }

  // Everyone sees it: a crown for the winner (30 s), a dizzy swirl for the loser.
  private duelEnded(winner: string, loser: string) {
    const av = (id: string) => (id === this.presence?.id ? this.me : this.remotes.get(id)?.avatar);
    av(winner)?.setCrown(30_000);
    av(loser)?.showEmote('swirl');
  }

  private receiveDuel(m: DuelMsg) {
    if (m.k === 'end') return this.duelEnded(m.winner, m.loser);
    const r = this.remotes.get(m.from);
    if (!r || !this.presence) return;
    const me = this.presence.id;
    if (m.k === 'invite') {
      if (this.duel || this.duelInvite) return this.presence.sendDuel({ k: 'decline', id: m.id, from: me, to: m.from });
      play('powerup', 0.5);
      const answer = (yes: boolean) => {
        document.getElementById('duel-invite')?.remove();
        this.presence?.sendDuel({ k: yes ? 'accept' : 'decline', id: m.id, from: me, to: m.from });
        if (yes) this.openDuel(m.id, m.from, false);
      };
      toast({
        icon: 'swords',
        id: 'duel-invite',
        who: `${r.info.name} challenges you`,
        what: 'Rock paper scissors, best of three.',
        ttl: 20_000,
        actions: [
          { label: 'Play', id: 'duel-accept', onClick: () => answer(true) },
          { label: 'Not now', id: 'duel-decline', onClick: () => answer(false) },
        ],
      });
      return;
    }
    const inv = this.duelInvite;
    if (inv && m.id === inv.id && m.from === inv.to && (m.k === 'accept' || m.k === 'decline')) {
      if (m.k === 'decline') return this.cancelInvite('declined');
      clearTimeout(inv.timer);
      this.duelInvite = null;
      document.getElementById('duel-wait')?.remove();
      return this.openDuel(m.id, m.from, true);
    }
    if (m.k === 'quit' && !this.duel) document.getElementById('duel-invite')?.remove();
    this.duel?.onMessage(m);
  }

  private receiveEmote(m: EmoteMsg) {
    const r = this.remotes.get(m.from);
    if (!r || !isEmote(m.e)) return;
    // Same cap on the way in, so a modified client can't flood everyone's screen.
    const now = Date.now();
    if (now - (this.lastEmoteFrom.get(m.from) ?? 0) < EMOTE_EVERY - 300) return;
    this.lastEmoteFrom.set(m.from, now);
    r.avatar.showEmote(m.e);
    if (r.avatar.sprite.visible) play('emote', m.to === this.presence?.id ? 0.6 : 0.3);
  }

  private removeRemote(id: string) {
    if (this.duel?.them.id === id) this.duel.gone();
    if (this.duelInvite?.to === id) this.cancelInvite('left');
    this.earlyMoves.delete(id);
    this.remotes.get(id)?.avatar.destroy();
    this.remotes.delete(id);
    this.showPresenceStatus('online');
  }

  private updateRemote(p: PlayerInfo) {
    const r = this.remotes.get(p.id);
    if (!r) return;
    if (p.guest) p = { ...p, character: guestCharacter(p.character) };
    if (r.info.character !== p.character) r.avatar.setCharacter(p.character);
    if (r.info.name !== p.name) r.avatar.setName(p.name);
    // A room owner renamed themselves: their door sign follows.
    if (r.info.name !== p.name && this.ownerNames.has(p.id)) {
      this.ownerNames.set(p.id, p.name);
      this.showRooms();
    }
    r.avatar.setGuest(!!p.guest);
    this.showHost(p);
    r.info = { ...p, zone: r.info.zone, mic: r.info.mic, net: r.info.net };
    this.showMicNote(p.id); // zone from position updates is fresher than presence
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
    // Quiet sounds for people coming into or leaving the room you're in.
    if (moved && r.active && this.zone && this.zone !== 'hallway') {
      if (m.zone === this.zone) play('join', 0.5);
      else if (r.info.zone === this.zone) play('leave', 0.5);
    }
    r.info.zone = m.zone;
    const stateChanged = (m.mic !== undefined && m.mic !== r.info.mic) || (m.net !== undefined && m.net !== r.info.net);
    if (m.mic !== undefined) r.info.mic = m.mic;
    if (m.net !== undefined) r.info.net = m.net;
    if (moved || stateChanged) this.showMicNote(m.id);
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
    this.presence.sendMove({ x: tenth(this.body.center.x), y: tenth(this.body.bottom), vx, vy, dir, zone: this.zone, mic: this.myMic, net: this.myNet });
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
      const walking = (m.vx !== 0 || m.vy !== 0) && now - m.t < EXTRAPOLATE_MAX;
      // While walking, never step back against the direction of travel: a correction that lands a little
      // behind just holds them for a moment until the prediction catches up (no judder).
      if (walking) {
        const { x: px, y: py } = r.avatar.sprite;
        if (m.vx && (x - px) * Math.sign(m.vx) < 0) x = px;
        if (m.vy && (y - py) * Math.sign(m.vy) < 0) y = py;
      }
      r.avatar.setPosition(x, y);
      r.avatar.animate(walking, m.dir);
    }
  }

  // About 19x12 tiles in view (design/game/mvp.html `fit`).
  // Whole-number zoom only (2, 3 or 4: keeps pixels sharp). Phones fire resize when the address bar slides
  // in or out and when the keyboard opens, so only re-fit when the size really changes (over 20%), never
  // while typing, or when forced (first time, phone turned). Then re-centre on the player.
  private fitSize = { w: 0, h: 0 };
  private fitCamera(force = false) {
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

  // Used by automated checks.
  get cameraZoom() {
    return this.cameras.main.zoom;
  }


  update() {
    const v = this.canMove && !modalOpen() ? this.inputVelocity() : new Phaser.Math.Vector2(0, 0);
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
    // Very quiet footsteps while you walk (Sound effects switch and Game sounds slider apply).
    if (moving && this.time.now - this.lastStep > 320) {
      this.lastStep = this.time.now;
      this.stepFoot = !this.stepFoot;
      play(this.stepFoot ? 'footstep' : 'footstep2', 0.18);
    }

    // Standing on a doorway line flips between hallway and room; only count a change that lasts
    // ZONE_SETTLE_MS (and ignore gaps between zones), so voice, chat and presence don't flicker.
    const here = this.zones.find((z) => z.rect.contains(this.player.x, this.player.y - 3))?.name ?? null;
    if (here !== this.zoneCandidate) {
      this.zoneCandidate = here;
      this.zoneSince = this.time.now;
    }
    const settled = this.zone === null || this.time.now - this.zoneSince >= ZONE_SETTLE_MS;
    const zone = here !== null && settled ? here : this.zone;
    if (zone !== this.zone) {
      const was = this.zone;
      this.zone = zone;
      this.showPresenceStatus(this.presenceState);
      if (zone && zone !== 'hallway' && zone !== was && this.presence)
        toast({ icon: 'door-open', who: zoneLabel(zone), what: this.countIn(zone) > 1 ? 'Joining voice…' : 'Nobody else here yet', small: true, ttl: 2200 });
      // (Zone rides on the move message just below; presence is kept for rare changes.)
      this.sendMove(true);
      this.updateVoice();
      this.chat?.setRoom(zone && zone !== 'hallway' ? (zone as RoomId) : null);
    } else {
      this.sendMove();
    }

    this.moveRemotes();
    // Hallway icons and the walkie button: 10 times a second is plenty (not every frame).
    // Standing at a game spot: "Play games · E". Walk off and an open games panel closes.
    const spot = this.games && this.canMove && !this.presence?.isReplaced ? this.spots.near(this.player.x, this.player.y) : null;
    this.games?.showPrompt(modalOpen() ? null : spot);
    if (this.games?.openSpot && !spot) this.games.close();
    // The walkie button follows where you are every frame, so it can never be left hidden in the hallway
    // (a missed zone update or a setup hiccup used to leave it off until you walked into a room and back).
    this.walkie?.setVisible(this.zone === 'hallway' && !!this.voice && !this.presence?.isReplaced);
    if (this.hallway && this.zone === 'hallway' && this.time.now - this.hallShown > 100) {
      this.hallShown = this.time.now;
      this.showHallway();
    }
  }

  private inputVelocity() {
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
