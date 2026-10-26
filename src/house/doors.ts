import { trackName } from './jukebox';
import type { Skin } from '../characters';
import { ROOM_IDS, type RoomId, type Zone } from '../config';
import { roomDef } from './rooms';
import { loadRooms as fetchRooms, setDnd, type Room } from '../net/rooms';
import { play } from '../ui/sounds';
import { crumb } from '../net/errors';
import { setRoomInfo, showWhere, zoneLabel } from '../ui/overlay';
import { toast } from '../ui/toasts';
import type { HouseScene } from '../scenes/HouseScene';

// Rooms and doors: the rooms' live state, "Do not disturb" signs and doorways, head counts, and the pill.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

export function showPresenceStatus(this: HouseScene, s: 'connecting' | 'reconnecting' | 'online' | 'offline') {
  if (s !== this.presenceState) crumb('connection', s);
  this.presenceState = s;
  this.refreshRooms();
  if (s === 'connecting') showWhere(this.zone, 'Connecting…', 'warn');
  else if (s === 'reconnecting') showWhere(this.zone, 'Reconnecting…', 'warn');
  else if (s === 'offline') showWhere(this.zone, 'Offline · trying again', 'off');
  // Hide and seek on: how many are in a room would give hiders away.
  else if (this.hideSeek?.active) showWhere(this.zone, 'Hide and seek', 'ok');
  else if (this.zone && this.zone !== 'hallway') showWhere(this.zone, `${this.countIn(this.zone)} here`, 'ok');
  else showWhere(this.zone, `${this.activeCount()} in the house`, 'ok');
}

// The rooms' live state from the database (do not disturb, game rules). Kept live via the house channel.
export async function loadRooms(this: HouseScene) {
  for (const r of await fetchRooms()) this.rooms.set(r.id, r);
  this.showRooms();
  this.syncMusic();
}

export function roomChanged(this: HouseScene, room: Room) {
  const before = this.rooms.get(room.id);
  this.rooms.set(room.id, { ...before, ...room });
  this.showRooms();
  this.syncMusic();
  // Someone put a track on while you're in the Disco.
  if (room.id === 'disco' && this.zone === 'disco' && room.music && room.music_at !== before?.music_at)
    toast({ icon: 'music', id: 'jukebox-toast', who: `♪ ${trackName(room.music)}`, what: `${this.nameOf(room.music_by)} put it on.`, small: true, ttl: 2500 });
}

// Do not disturb only counts while someone is in the room (it clears when the next person finds it empty).
export function quiet(this: HouseScene, room: RoomId) {
  return !!this.rooms.get(room)?.dnd && this.countIn(room) > 0;
}

export function showRooms(this: HouseScene) {
  setRoomInfo((zone: Zone) => ({ name: zone === 'hallway' ? 'Great Hall' : (roomDef(zone)?.name ?? zone), dnd: zone !== 'hallway' && this.quiet(zone) }));
  for (const id of ROOM_IDS) this.look.setRoom(id, { name: zoneLabel(id), dnd: this.quiet(id) });
  this.showPresenceStatus(this.presenceState);
}

// Does this doorway stop you? Only into a quiet room, until you say you'll go in anyway. Never on the
// way out.
export function quietDoor(this: HouseScene, room: RoomId) {
  return this.zone !== room && this.quiet(room) && (this.quietOk.get(room) ?? 0) < Date.now();
}

// Walked into a quiet room's door: ask first.
export function bumpQuietDoor(this: HouseScene, room: RoomId) {
  const now = Date.now();
  if (now - this.lastDoorNote < 3500) return;
  this.lastDoorNote = now;
  play('knock', 0.5);
  toast({
    icon: 'moon',
    id: 'quiet-toast',
    who: `${zoneLabel(room)}: do not disturb`,
    what: 'They’ve asked for some quiet. Go in anyway?',
    ttl: 8000,
    actions: [
      {
        label: 'Go in',
        id: 'quiet-go-in',
        onClick: () => {
          this.quietOk.set(room, Date.now() + 10 * 60_000);
          this.walkToRoom(room);
        },
      },
      { label: 'Not now', quiet: true, id: 'quiet-not-now', onClick: () => {} },
    ],
  });
}

// Do not disturb goes away with the last person: whoever leaves an empty room (or walks into one that
// was left quiet) clears it.
export function tidyQuiet(this: HouseScene, left: Zone | null, entered: Zone | null) {
  for (const room of [left, entered]) {
    if (!room || room === 'hallway' || !this.rooms.get(room)?.dnd) continue;
    const others = [...this.remotes.values()].filter((r) => r.active && r.info.zone === room).length;
    if (others === 0) void setDnd(room, false);
  }
}

// Nameplate faces and room warmth, from who's where.
export function refreshRooms(this: HouseScene) {
  for (const room of ROOM_IDS) {
    const chars: Skin[] = [];
    if (this.zone === room) chars.push(this.character);
    for (const r of this.remotes.values()) if (r.active && r.info.zone === room) chars.push(r.info.character);
    this.look.setOccupants(room, chars);
    this.look.setRoom(room, { name: zoneLabel(room), dnd: this.quiet(room) }); // only while someone is inside
  }
}

// People in a zone, counting you if you're there.
export function countIn(this: HouseScene, zone: Zone) {
  let n = this.zone === zone ? 1 : 0;
  for (const r of this.remotes.values()) if (r.active && r.info.zone === zone) n++;
  return n;
}

export function activeCount(this: HouseScene) {
  let n = 1;
  for (const r of this.remotes.values()) if (r.active) n++;
  return n;
}

// Same person opened Diesel House somewhere else: this tab goes quiet until they take it back.
export function replaced(this: HouseScene) {
  this.voice?.leave();
  this.canMove = false;
  this.body.setVelocity(0, 0);
  this.replacedToast?.();
  this.replacedToast = toast({
    icon: 'user-round',
    id: 'replaced-toast',
    who: 'You opened Diesel House somewhere else',
    what: 'This tab has gone quiet: you can’t move or talk here. Tap “Use it here” to carry on in this tab.',
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

// The Disco's jukebox: heard only inside the Disco, the same track at the same moment for everyone there.
export function syncMusic(this: HouseScene) {
  const disco = this.rooms.get('disco' as RoomId);
  const inside = this.zone === 'disco';
  this.jukebox?.set(inside ? disco?.music : null, disco?.music_at);
  this.jukeboxUi?.setVisible(inside && !!this.presence);
  this.jukeboxUi?.refresh();
  this.watch?.sync(); // the Lounge's and the Disco's screen
}

// Someone's display name by account id (you, a friend here, or "Someone").
export function nameOf(this: HouseScene, id: string | null | undefined) {
  if (!id) return 'Someone';
  if (id === this.presence?.id) return 'You';
  return this.remotes.get(id)?.info.name || 'Someone';
}
