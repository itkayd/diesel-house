import Phaser from 'phaser';
import { type RoomId } from '../config';
import { type Dir } from '../characters';
import { play } from '../ui/sounds';
import { zoneLabel } from '../ui/overlay';
import { roomBanner } from '../ui/roomBanner';
import { trackName } from './jukebox';
import { modalOpen } from '../ui/modal';
import type { HouseScene } from '../scenes/HouseScene';
import { ZONE_SETTLE_MS } from './consts';
import { toScreen } from './projection';

// Every frame: your movement and facing, which zone you are in, others' movement, and the prompts underfoot.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

export function update(this: HouseScene) {
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
  const feet = toScreen(this.player.x, this.player.y);
  this.me.setGhost(this.look.hides(feet.x, feet.y, this.player.depth));
  // Very quiet footsteps while you walk (Sound effects switch and Game sounds slider apply).
  if (moving && this.time.now - this.lastStep > 320) {
    this.lastStep = this.time.now;
    this.stepFoot = !this.stepFoot;
    play(this.stepFoot ? 'footstep' : 'footstep2', 0.18);
  }

  // Standing on a doorway line flips between hallway and room; only count a change that lasts
  // ZONE_SETTLE_MS (and ignore gaps between zones), so voice, chat and presence don't flicker.
  const here = this.zones.at(this.player.x, this.player.y - 3);
  if (here !== this.zoneCandidate) {
    this.zoneCandidate = here;
    this.zoneSince = this.time.now;
  }
  const settled = this.zone === null || this.time.now - this.zoneSince >= ZONE_SETTLE_MS;
  const zone = here !== null && settled ? here : this.zone;
  if (zone !== this.zone) {
    const was = this.zone;
    this.zone = zone;
    this.tidyQuiet(was, zone);
    this.showPresenceStatus(this.presenceState);
    if (zone && zone !== 'hallway') this.tracker.emit('room_enter', { u: zone });
    this.askTimer(zone);
    if (zone && zone !== 'hallway' && zone !== was && this.presence) {
      const others = this.countIn(zone) - 1;
      const quiet = this.quietRooms.has(zone);
      const music = zone === 'disco' ? this.rooms.get('disco' as RoomId)?.music : null;
      const who = quiet ? 'Quiet room · people near you hear you softly' : others > 0 ? `${others} here · joining voice…` : 'Nobody else here yet';
      roomBanner(zoneLabel(zone), music ? `${who} · ♪ ${trackName(music)}` : who);
    }
    // (Zone rides on the move message just below; presence is kept for rare changes.)
    this.sendMove(true);
    this.updateVoice();
    this.chat?.setRoom(zone && zone !== 'hallway' ? (zone as RoomId) : null);
    this.syncMusic();
  } else {
    this.sendMove();
  }

  this.moveRemotes();
  this.animals?.update(this.time.now, this.game.loop.delta);
  // Hallway icons and the walkie button: 10 times a second is plenty (not every frame).
  // Standing at a game spot: "Play games · E". Walk off and an open games panel closes.
  const spot = this.games && this.canMove && !this.presence?.isReplaced ? this.spots.near(this.player.x, this.player.y) : null;
  this.games?.showPrompt(spot, modalOpen());
  this.showBoardPrompt(!modalOpen() && this.canMove && this.spots.nearBoard(this.player.x, this.player.y));
  if (this.canMove && !this.presence?.isReplaced) this.critters?.update(this.player);
  this.updateDancing(this.game.loop.delta);
  this.updateRoomExtras();
  if (this.games?.openSpot && !spot) this.games.close();
  // The walkie button follows where you are every frame, so it can never be left hidden in the hallway
  // (a missed zone update or a setup hiccup used to leave it off until you walked into a room and back).
  this.walkie?.setVisible(this.zone === 'hallway' && !!this.voice && !this.presence?.isReplaced);
  const whisperZone = this.zone === 'hallway' || (!!this.zone && this.quietRooms.has(this.zone));
  if (this.hallway && whisperZone && this.time.now - this.hallShown > 100) {
    this.hallShown = this.time.now;
    this.showHallway();
    if (this.zone === 'hallway') this.noticeHallway();
  }
}
