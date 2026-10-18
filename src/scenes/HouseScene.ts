import Phaser from 'phaser';
import { type RoomId, type Zone } from '../config';
import { Zones } from '../house/zones';
import type { MoveMsg, PlayerInfo, Presence } from '../net/presence';
import { msgStats } from '../net/stats';
import { type Room } from '../net/rooms';
import { GameSpots } from './gameSpots';
import type { Games } from '../games/controller';
import { Duel } from '../games/rps';
import type { ChatPanel } from '../ui/chat';
import type { Voice } from '../net/voice';
import { Joystick } from '../ui/joystick';
import { VoiceControls } from '../ui/voiceControls';
import { Avatar } from './Avatar';
import { HouseLook } from './houseLook';
import { Hallway } from './hallway';
import { WalkieButton } from '../ui/walkie';
import { type NetQuality } from '../net/netQuality';
import { Tracker } from '../challenges/tracker';
import { type Progress } from '../net/progress';
import { ProgressHud } from '../ui/progressUi';
import { type Pt } from './pathfind';
import { Critters } from './critters';
import * as identity from '../house/identity';
import * as voiceBridge from '../house/voiceBridge';
import * as connect from '../house/connect';
import * as doors from '../house/doors';
import * as players from '../house/players';
import * as social from '../house/social';
import * as input from '../house/input';
import * as progress from '../house/progress';
import * as critterHunt from '../house/critterHunt';
import * as setup from '../house/setup';
import * as frame from '../house/frame';
import type { Remote, Sent } from '../house/consts';

// The house: one Phaser scene. It holds the state (you, the people around you, rooms, voice, games…);
// what it does lives in src/house/*.ts, one file per part (REDESIGN.md R1), wired on below. Each of those
// functions runs with `this` as the scene, so they read just like methods.
export class HouseScene extends Phaser.Scene {
  me!: Avatar;
  player!: Phaser.GameObjects.Sprite;
  body!: Phaser.Physics.Arcade.Body;
  keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  zones!: Zones;
  zone: Zone | null = null;
  joystick: Joystick | null = null;
  character = 0;
  name = '';
  canMove = false;

  presence: Presence | null = null;
  remotes = new Map<string, Remote>();
  hosts = new Map<string, string>(); // guest id -> the member who invited them
  hostsAsked = 0;
  zoneCandidate: Zone | null = null;
  zoneSince = 0;
  micWarned = false;
  lastStep = 0;
  hallShown = 0;
  myMic: PlayerInfo['mic'];
  myNet: NetQuality | undefined;
  stepFoot = false; // "Others can't hear you" shown this visit
  // Movement that arrived before presence told us who sent it (presence is slower); used once they join.
  earlyMoves = new Map<string, MoveMsg>();
  sent: Sent | null = null;
  readonly msgStats = msgStats; // dev checks: messages per minute
  voice: Voice | null = null;
  voiceControls: VoiceControls | null = null;
  voiceTimer: Phaser.Time.TimerEvent | null = null;
  // Hallway voice: whisper + walkie-talkie rules, and the walkie button (UPDATE.md Phase 10).
  hallway: Hallway | null = null;
  walkie: WalkieButton | null = null;
  lastEmote = 0; // when we last sent one
  lastEmoteFrom = new Map<string, number>(); // when each person's last emote was shown
  spots!: GameSpots;
  games: Games | null = null;
  duel: Duel | null = null;
  duelInvite: { id: string; to: string; timer: ReturnType<typeof setTimeout> } | null = null;
  lastRoll = 0;
  starting = false;
  presenceState: 'connecting' | 'reconnecting' | 'online' | 'offline' = 'connecting';
  look!: HouseLook;
  tappedAvatar = false; // pointer went down on a character: don't start walking towards it
  // Walking by itself (Who's where): corner points for the feet.
  autoPath: Pt[] | null = null;
  // Phase 14: challenges, XP and levels. The tracker sends what we do to record_events() every 30 s.
  tracker = new Tracker(false);
  progressHud: ProgressHud | null = null;
  progress: Progress | null = null;
  voiceConnected = 0; // people we can hear in this room right now
  wasOnAir = false;
  whispered = new Set<string>(); // friends we've whispered to (once each per visit)
  metGuests = new Set<string>();
  partied = false;
  boardPrompt: HTMLDivElement | null = null;
  critters: Critters | null = null;
  autoDoor: RoomId | null = null; // walking up to a quiet room's door: ask when we get there
  autoCheck = { t: 0, x: 0, y: 0 };
  wallLayer!: Phaser.Tilemaps.TilemapLayer;
  doorBlocks!: Phaser.Physics.Arcade.StaticGroup;
  rooms = new Map<RoomId, Room>();
  replacedToast: (() => void) | null = null;
  // Doors: where each doorway is, and quiet rooms you've said you'll go into anyway (until when).
  doorSpots = new Map<RoomId, { x: number; y: number; north: boolean }>();
  quietOk = new Map<RoomId, number>();
  lastDoorNote = 0;
  chat: ChatPanel | null = null;

  constructor() {
    super('House');
  }

  fitSize = { w: 0, h: 0 }; // the screen size the camera was last fitted to (src/house/input.ts fitCamera)

  // Used by automated checks.
  get cameraZoom() {
    return this.cameras.main.zoom;
  }

  // ---- behaviour, split out into src/house/*.ts (REDESIGN.md R1) ----
  identify = identity.identify;
  hostOf = identity.hostOf;
  showHost = identity.showHost;
  applyIdentity = identity.applyIdentity;
  choose = identity.choose;
  openMyProfile = identity.openMyProfile;
  showMicNote = voiceBridge.showMicNote;
  showMyMic = voiceBridge.showMyMic;
  warnSilentMic = voiceBridge.warnSilentMic;
  pressWalkie = voiceBridge.pressWalkie;
  showHallway = voiceBridge.showHallway;
  fixMic = voiceBridge.fixMic;
  updateVoice = voiceBridge.updateVoice;
  start = connect.start;
  showPresenceStatus = doors.showPresenceStatus;
  loadRooms = doors.loadRooms;
  roomChanged = doors.roomChanged;
  quiet = doors.quiet;
  showRooms = doors.showRooms;
  quietDoor = doors.quietDoor;
  bumpQuietDoor = doors.bumpQuietDoor;
  tidyQuiet = doors.tidyQuiet;
  refreshRooms = doors.refreshRooms;
  countIn = doors.countIn;
  activeCount = doors.activeCount;
  replaced = doors.replaced;
  addRemote = players.addRemote;
  nearestRemote = players.nearestRemote;
  removeRemote = players.removeRemote;
  updateRemote = players.updateRemote;
  receiveMove = players.receiveMove;
  predict = players.predict;
  sendMove = players.sendMove;
  moveRemotes = players.moveRemotes;
  tapAvatar = social.tapAvatar;
  sendEmote = social.sendEmote;
  receiveEmote = social.receiveEmote;
  rollDice = social.rollDice;
  receiveDice = social.receiveDice;
  startDuel = social.startDuel;
  cancelInvite = social.cancelInvite;
  openDuel = social.openDuel;
  duelEnded = social.duelEnded;
  receiveDuel = social.receiveDuel;
  fitCamera = input.fitCamera;
  inputVelocity = input.inputVelocity;
  manualVelocity = input.manualVelocity;
  whosWhere = input.whosWhere;
  walkToRoom = input.walkToRoom;
  walkTo = input.walkTo;
  autoVelocity = input.autoVelocity;
  setupProgress = progress.setupProgress;
  rankInfo = progress.rankInfo;
  gotProgress = progress.gotProgress;
  cheer = progress.cheer;
  confettiOver = progress.confettiOver;
  openMyChallenges = progress.openMyChallenges;
  openBoard = progress.openBoard;
  showBoardPrompt = progress.showBoardPrompt;
  minuteTick = progress.minuteTick;
  noticeHallway = progress.noticeHallway;
  setupCritters = critterHunt.setupCritters;
  zoneOf = critterHunt.zoneOf;
  critterAppeared = critterHunt.critterAppeared;
  catchCritter = critterHunt.catchCritter;
  floatWorld = critterHunt.floatWorld;
  someoneCaught = critterHunt.someoneCaught;

  create() {
    setup.create.call(this);
  }

  update() {
    frame.update.call(this);
  }
}
