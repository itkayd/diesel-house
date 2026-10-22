import Phaser from 'phaser';
import { type RoomId, WATCH_TOGETHER } from '../config';
import { currentUser } from '../net/profile';
import { setDnd, setRoomRules } from '../net/rooms';
import { gamesFor, type GameId } from '../games/catalog';
import { parseRoll, roll } from '../games/dice';
import { recordGame } from '../net/games';
import { savedVolume } from '../prefs';
import { setNetBadge, showWhere, zoneLabel } from '../ui/overlay';
import { addRoomSettings } from '../ui/roomSettings';
import { addGuestSettings } from '../ui/guestSettings';
import { toast } from '../ui/toasts';
import { askForMic, micAlreadyAllowed } from '../ui/micPrompt';
import { keysBlocked, notGameKey } from '../ui/modal';
import { MicPausedChip } from '../ui/micPaused';
import { Jukebox } from './jukebox';
import { JukeboxButton } from '../ui/jukeboxUi';
import { setRoomMedia, setRoomMusic } from '../net/rooms';
import { devTest } from '../net/mode';
import { WatchTogether } from '../ui/watchTogether';
import { mediaOf, SCREEN_ROOMS } from './media';
import { addVoiceSettings } from '../ui/voiceSettings';
import { EMOTES, EmoteButton } from '../ui/emotes';
import { showSoundBanner } from '../ui/soundBanner';
import { VoiceControls } from '../ui/voiceControls';
import { Hallway } from '../scenes/hallway';
import { WalkieButton } from '../ui/walkie';
import { addHallwaySettings } from '../ui/hallwaySettings';
import { net } from '../net/netQuality';
import { reloadForUpdate, watchForNewVersion } from '../ui/update';
import { addWhosWhereButton } from '../ui/whosWhere';
import type { HouseScene } from '../scenes/HouseScene';
import { ROOMS } from './rooms';
import { setupGuide } from '../ui/guide';
import { addReportProblem } from '../ui/reportProblem';
import { startHouseSettings } from '../net/houseSettings';
import { friendList, isBlocked, loadSocial } from '../net/social';
import { addBlockedSettings } from '../ui/blockedSettings';
import { startAnnouncements } from '../ui/announcement';
import { setLogFacts } from '../net/errors';
import { modalOpen } from '../ui/modal';
import { firstRun } from '../ui/hints';

// Going online: presence, voice, chat, games, settings and the HUD buttons, once you have picked a character.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Joins the house once we know who we are.
export async function start(this: HouseScene) {
  this.canMove = true;
  setupGuide(true); // the ? button, and the guide itself on a first visit
  addReportProblem(); // Settings → More: "Report a problem"
  void startHouseSettings(); // the admin page's switches, live (src/net/houseSettings.ts)
  // Friends and blocks (src/net/social.ts): now, and every 2 minutes for new friend requests.
  const askedBefore = new Set<string>();
  const checkFriends = () =>
    void loadSocial().then(() => {
      const asking = friendList().filter((f) => f.status === 'incoming' && !askedBefore.has(f.id));
      for (const f of asking) askedBefore.add(f.id);
      if (!asking.length) return;
      toast({
        icon: 'users',
        id: 'friend-requests',
        who: asking.length === 1 ? `${asking[0].name ?? 'Someone'} wants to be friends` : `${asking.length} friend requests`,
        what: 'Say yes in Who’s where.',
        ttl: 8000,
        actions: [{ label: 'See', id: 'friend-requests-see', onClick: () => document.getElementById('map-button')?.click() }],
      });
    });
  checkFriends();
  setInterval(checkFriends, 120_000);
  addBlockedSettings((id) => this.blockChanged(id)); // Settings → More: unblock
  startAnnouncements();
  // What the game was doing, added to every device log (src/net/errors.ts).
  setLogFacts(() => ({
    zone: this.zone,
    canMove: this.canMove,
    connection: this.presenceState,
    others: [...this.remotes.values()].filter((r) => r.active).length,
    joystick: this.joystick ? { active: this.joystick.active, x: +this.joystick.vector.x.toFixed(2), y: +this.joystick.vector.y.toFixed(2) } : null,
    pos: { x: Math.round(this.player.x), y: Math.round(this.player.y) },
    guest: !!currentUser()?.guest,
    fps: Math.round(this.game.loop.actualFps),
  }));
  // One-time tips for the first minutes, and a card when nobody else is in (src/ui/hints.ts).
  firstRun.begin({
    zone: () => this.zone,
    moved: () => Math.hypot(this.player.x - this.spawnAt.x, this.player.y - this.spawnAt.y) > 24,
    others: () => [...this.remotes.values()].filter((r) => r.active).length,
    nearby: () =>
      [...this.remotes.values()].filter(
        (r) => r.active && (this.zone && this.zone !== 'hallway' ? r.info.zone === this.zone : Math.hypot(r.avatar.sprite.x - this.player.x, r.avatar.sprite.y - this.player.y) < 90),
      ).length,
    nearGames: () => !!this.games?.promptFor,
    member: !currentUser()?.guest,
    arcade: () => void this.openArcade(),
    invite: () => {
      this.openMyProfile();
      setTimeout(() => document.getElementById('profile-tab-code')?.click(), 60);
    },
    map: () => this.whosWhere(),
  });
  if (this.starting) return;
  this.starting = true;
  showWhere(this.zone, 'Connecting…', 'warn');
  let modules;
  try {
    modules = await Promise.all([import('../net/presence'), import('../net/voice'), import('../games/controller'), import('../ui/chat')]);
  } catch (e) {
    // Usually an old copy of the game after an update (its files are gone): load the new one.
    console.warn('Could not load the game files', e);
    if (!reloadForUpdate()) showWhere(this.zone, 'Offline · reload the page', 'off');
    return;
  }
  const [{ Presence }, { Voice }, { Games }, { ChatPanel }] = modules;
  this.presence = new Presence(
    currentUser()?.id ?? crypto.randomUUID(),
    { name: this.name, character: this.character, pet: this.pet, zone: this.zone, guest: !!currentUser()?.guest, ...this.rankInfo() },
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
      onCatch: (c) => this.someoneCaught(c),
      onEmote: (m) => this.receiveEmote(m),
      onDice: (m) => this.receiveDice(m),
      onTimer: (m) => this.receiveTimer(m),
      onDuel: (m) => this.receiveDuel(m),
      onInvite: (m) => this.receiveInvite(m),
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
    // Never reload under someone: not in a call, a game, the arcade or any other pop-up.
    () => (this.voice?.debug().length ?? 0) > 0 || modalOpen(),
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
  // Spaces where you're heard by distance: the hallway (whisper + walkie) and quiet rooms (whisper only,
  // REDESIGN.md §2: the Library).
  const whisperSpace = (zone: string) => {
    const space = new Hallway({
      myId: () => this.presence!.id,
      me: () => ({ x: this.player.x, y: this.player.y, inHall: this.zone === zone }),
      peer: (id) => {
        const r = this.remotes.get(id);
        return r?.active ? { x: r.avatar.sprite.x, y: r.avatar.sprite.y, inHall: r.info.zone === zone, mic: r.info.mic === 'on' || r.info.mic === 'silent' } : null;
      },
      myMic: () => !!this.voice?.micStream,
      send: (m) => zone === 'hallway' && this.voice?.sendWalkie(m),
      onChange: () => this.showHallway(),
    });
    space.idsInHall = () => [...this.remotes.values()].filter((r) => r.active && r.info.zone === zone).map((r) => r.info.id);
    return space;
  };
  const hall = whisperSpace('hallway');
  for (const r of ROOMS) if (r.voice === 'quiet') this.quietRooms.set(r.id, whisperSpace(r.id));
  this.hallway = hall;
  this.voice = new Voice(
    this.presence.id,
    {
      onSpeaking: (id, on) => (id === this.presence!.id ? this.me : this.remotes.get(id)?.avatar)?.setSpeaking(on),
      onStatus: (s) => {
        // The mic button is for rooms; the hallway has the walkie button instead (design/game/v2.html).
        this.voiceControls?.show(this.voice?.space === 'hallway' ? { state: 'off' } : s);
        this.voiceConnected = s.state === 'in-room' && s.space !== 'hallway' ? s.connected : 0;
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
      policyFor: (space) => (space === 'hallway' ? hall : (this.quietRooms.get(space) ?? null)),
      onWalkie: (m) => hall.onMessage(m),
      volumeFor: (id) => (isBlocked(id) ? 0 : savedVolume(id)), // blocked: silent (src/net/social.ts)
      onMicState: (s) => {
        this.myMic = s;
        this.sendMove(true);
        this.showMyMic();
        if (s === 'silent') this.warnSilentMic();
      },
      onMicParked: (until) => micChip.set(until),
    },
    { forceRelay },
  );
  const micChip = new MicPausedChip(() => this.voice?.releaseMic());
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
  // Keys 1-6: quick emotes. Q: the menu for whoever is right next to us. M: Who's where. Enter: room chat.
  addEventListener('keydown', (e) => {
    if (e.repeat || notGameKey(e) || keysBlocked()) return;
    const n = Number(e.key);
    if (e.key.toLowerCase() === 'e' && this.games?.promptFor) this.games.open(this.games.promptFor);
    else if (e.key.toLowerCase() === 'e' && this.boardPrompt) void this.openBoard();
    else if (e.key.toLowerCase() === 'e' && this.arcadePrompt) void this.openArcade();
    else if (e.key.toLowerCase() === 'e' && this.timerPrompt) this.timerPrompt.querySelector('button')?.click();
    else if (n >= 1 && n <= 6) this.sendEmote(EMOTES[n - 1].id);
    else if (e.key.toLowerCase() === 'q') {
      const id = this.nearestRemote(48);
      if (id) this.tapAvatar(id);
    } else if (e.key.toLowerCase() === 'm') document.getElementById('map-button')?.click();
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && this.chat && !this.chat.isOpen) {
      e.preventDefault();
      void this.chat.openToType();
    }
  });
  this.jukebox = new Jukebox();
  this.jukeboxUi = new JukeboxButton({
    now: () => {
      const d = this.rooms.get('disco' as RoomId);
      return { track: d?.music ?? null, by: d?.music && d.music_by ? this.nameOf(d.music_by) : null };
    },
    choose: async (track) => {
      const err = await setRoomMusic('disco' as RoomId, track);
      // Show it straight away; the live update follows for everyone else.
      if (!err) this.roomChanged({ ...this.rooms.get('disco' as RoomId)!, music: track, music_at: track ? new Date().toISOString() : null, music_by: track ? this.presence!.id : null });
      return err;
    },
  });
  // Watch & listen together: the Lounge's TV and the Disco's screen (off until the big update).
  const fakeMedia = devTest && new URLSearchParams(location.search).has('fakemedia');
  const screenRoom = () => (this.zone && SCREEN_ROOMS.includes(this.zone) && this.presence ? (this.zone as RoomId) : null);
  if (WATCH_TOGETHER || fakeMedia) this.watch = new WatchTogether({
    room: screenRoom,
    state: () => {
      const r = screenRoom();
      return r ? mediaOf(this.rooms.get(r)) : null;
    },
    set: async (m) => {
      const room = screenRoom();
      if (!room) return 'Walk into the Lounge or the Disco first.';
      const err = await setRoomMedia(room, m);
      if (!err)
        this.roomChanged({
          ...this.rooms.get(room)!,
          media_kind: m?.kind ?? null,
          media_id: m?.id ?? null,
          media_pos: m?.pos ?? null,
          media_at: m ? new Date().toISOString() : null,
          media_paused: m?.paused ?? false,
          media_by: m ? this.presence!.id : null,
          ...(m && room === 'disco' ? { music: null, music_at: null } : {}),
        });
      return err;
    },
    nameOf: (id) => this.nameOf(id),
    fake: fakeMedia,
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
    names: (id) => (id === this.presence?.id ? { name: this.name, character: this.character } : (this.remotes.get(id)?.info ?? { name: '' })),
    nearby: () =>
      [...this.remotes.values()].filter((r) => r.active && r.info.zone === this.zone).map((r) => ({ id: r.info.id, name: r.info.name, character: r.info.character })),
    allowed: (spot) => (spot === 'hall' ? null : ((this.rooms.get(spot)?.games as GameId[] | null | undefined) ?? null)),
    prompts: (spot) => (spot === 'hall' ? [] : (this.rooms.get(spot)?.prompts ?? [])),
    kind: (spot) => this.spots.kind(spot),
    roll: (r) => this.rollDice(r),
    challenge: (id) => this.startDuel(id),
    record: (game, spot, players, winners, score, seed) => void recordGame(game, spot, players, winners, score, seed),
    played: (game, won, info) => {
      this.tracker.emit('game_played', { u: game });
      if (won) this.tracker.emit('game_won', { u: game });
      if (won && game === 'quickdraw' && (info.fastestMs ?? Infinity) < 250) this.tracker.emit('qd_fast');
    },
    hosted: (_game, players) => players >= 4 && this.tracker.emit('host_game_4'),
    quickDrawRound: () => this.tracker.emit('qd_round_won'),
    arcade: () => void this.openArcade(),
    invite: (spot) => this.inviteToTable(spot),
  });
  this.chat.onActivity = (k, room) => this.tracker.emit(k === 'chat' ? 'chat_sent' : 'reaction_sent', k === 'chat' ? { u: room } : {});
  this.chat.setRoom(this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null);
  addVoiceSettings(this.voice, this.voiceControls, () => {
    document.getElementById('settings-close')?.click();
    void this.fixMic();
  });
  addWhosWhereButton(() => this.whosWhere());
  addRoomSettings(
    () => {
      const room = this.zone && this.zone !== 'hallway' ? this.rooms.get(this.zone) : undefined;
      return room ? { room, name: zoneLabel(room.id), member: !currentUser()?.guest } : null;
    },
    async (room, quiet) => {
      const err = await setDnd(room.id, quiet);
      if (!err) this.roomChanged({ ...room, dnd: quiet, dnd_set_by: quiet ? (currentUser()?.id ?? null) : null });
      return err;
    },
    async (room, games, prompts) => {
      const err = await setRoomRules(room.id, games, prompts);
      if (!err) this.roomChanged({ ...room, games, prompts });
      return err;
    },
    (room) => (this.spots.kind(room.id) ? gamesFor(this.spots.kind(room.id)) : []), // no games spot here: nothing to switch
  );
  addGuestSettings(() => {
    const u = currentUser();
    return u && !u.guest ? u.id : null;
  });
  void this.loadRooms();
  this.updateVoice();
  this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.voice?.leave());
  window.addEventListener('pagehide', () => {
    this.voice?.leave();
    this.voice?.releaseMic();
    this.presence?.leave();
  });
}
