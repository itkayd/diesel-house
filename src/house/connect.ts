import Phaser from 'phaser';
import { type RoomId } from '../config';
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
import { modalOpen } from '../ui/modal';
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

// Going online: presence, voice, chat, games, settings and the HUD buttons, once you have picked a character.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Joins the house once we know who we are.
export async function start(this: HouseScene) {
  this.canMove = true;
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
    { name: this.name, character: this.character, zone: this.zone, guest: !!currentUser()?.guest, ...this.rankInfo() },
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
    else if (e.key.toLowerCase() === 'e' && this.boardPrompt) void this.openBoard();
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
    played: (game, won, info) => {
      this.tracker.emit('game_played', { u: game });
      if (won) this.tracker.emit('game_won', { u: game });
      if (won && game === 'quickdraw' && (info.fastestMs ?? Infinity) < 250) this.tracker.emit('qd_fast');
    },
    hosted: (_game, players) => players >= 4 && this.tracker.emit('host_game_4'),
    quickDrawRound: () => this.tracker.emit('qd_round_won'),
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
    (room) => gamesFor(this.spots.kind(room.id)),
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
    this.presence?.leave();
  });
}
