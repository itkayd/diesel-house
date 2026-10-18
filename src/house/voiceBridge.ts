import { type RoomId } from '../config';
import { roomDef } from './rooms';
import type { Space } from '../net/voice';
import { toast } from '../ui/toasts';
import { askForMic, resetMicDecline, showMicHelp } from '../ui/micPrompt';
import { WHISPER, type Hallway } from '../scenes/hallway';
import type { HouseScene } from '../scenes/HouseScene';
import { JOIN_VOICE_AFTER } from './consts';

// Voice in the game: joining the room or hallway voice as you move, the mic button and its notes, the walkie.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Why you might not hear someone in your room: shown on their name tag.
// In a room, everyone's tag shows their mic: green = on, red crossed = muted or no mic, amber crossed =
// mic not working (plus the words, since that one needs explaining). Connection bars show everywhere.
export function showMicNote(this: HouseScene, id: string) {
  const r = this.remotes.get(id);
  if (!r) return;
  const inRoom = !!r.info.zone && r.info.zone !== 'hallway';
  const mic = r.info.mic;
  r.avatar.setMic(!inRoom || !mic ? null : mic === 'on' ? 'on' : mic === 'silent' ? 'warn' : 'off');
  r.avatar.setNote(inRoom && mic === 'silent' ? 'mic not working' : null);
  r.avatar.setNet(r.info.net ?? null);
}

// Our own tag: the same mic icon (in a room) and our connection bars.
export function showMyMic(this: HouseScene) {
  const inRoom = !!this.zone && this.zone !== 'hallway' && !!this.voice?.room;
  const s = this.voice?.micState;
  this.me.setMic(!inRoom || !s ? null : s === 'on' ? 'on' : s === 'silent' ? 'warn' : 'off');
}

// Our mic is on but gives only silence (another app has it, usually): tell them, offer to try again.
export function warnSilentMic(this: HouseScene) {
  toast({
    icon: 'mic-off',
    id: 'mic-silent-toast',
    who: "Your mic isn't picking up any sound",
    what: 'Another app may be using it (a call, WhatsApp). Close it, then tap Try again.',
    ttl: 0,
    actions: [{ label: 'Try again', id: 'mic-silent-retry', onClick: () => void this.voice?.restartMic() }],
  });
}

// Walkie pressed: needs the mic (asked here, from the tap, if the hallway joined listening only).
export async function pressWalkie(this: HouseScene) {
  const voice = this.voice;
  const hall = this.hallway;
  if (!voice || !hall || voice.space !== 'hallway') return;
  if (!voice.micStream) {
    // Pressing the walkie is asking to talk, even after "Just listen" earlier: ask again.
    resetMicDecline();
    const ok = await askForMic(new Promise<void>(() => {}));
    if (!ok) toast({ icon: 'mic-off', id: 'walkie-nomic', who: 'The walkie needs your mic', what: 'Allow the mic to talk on it.', small: true, ttl: 3000 });
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
export function showHallway(this: HouseScene) {
  const quiet = this.zone ? this.quietRooms.get(this.zone) : undefined;
  if (quiet) return showQuietRoom.call(this, quiet);
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

// A quiet room (the Library): our whisper ring when someone's near enough to hear us, and "…" over people
// we can hear whispering. No walkie.
function showQuietRoom(this: HouseScene, quiet: Hallway) {
  const here = this.voice?.space === this.zone;
  this.me.setRadio(false);
  this.me.setWhisperRing(here && quiet.whisperOn && quiet.someoneNear && !!this.voice?.micStream ? WHISPER : null);
  for (const r of this.remotes.values()) {
    r.avatar.setRadio(false);
    r.avatar.setWhispering(here && r.active && r.info.zone === this.zone && r.avatar.speaking && quiet.route(r.info.id).mode === 'whisper');
  }
}

// The mic isn't reaching anyone: if the browser or phone refused it, explain how to fix that first;
// then ask again (rejoining the room re-runs the mic card and the browser prompt). A silent mic is
// simply reopened.
export async function fixMic(this: HouseScene) {
  if (!this.voice) return;
  if (this.voice.isSilent) return void this.voice.restartMic();
  const problem = this.voice.micProblem;
  if (problem && problem !== 'declined' && !(await showMicHelp(problem))) return;
  resetMicDecline();
  const space = this.voice.space;
  this.voice.leave();
  if (space) void this.voice.join(space);
}

// Leaving a room cuts voice at once; joining waits until you've actually stepped in.
export function updateVoice(this: HouseScene) {
  if (!this.voice || this.presence?.isReplaced) return;
  this.voiceTimer?.remove();
  this.voiceTimer = null;
  // A room, the hallway (whisper + walkie), or nowhere. Rooms and the hallway never hear each other.
  const space: Space | null = this.zone === 'hallway' ? 'hallway' : this.zone ? (this.zone as RoomId) : null;
  if (space !== 'hallway') this.hallway?.leftHallway();
  if (space && this.quietRooms.has(space) && this.voice.space !== space)
    toast({ icon: 'book-open', id: 'quiet-room', who: `${roomDef(space)?.name ?? 'This room'} is a quiet room`, what: 'People hear you only up close, like whispering.', small: true, ttl: 3200 });
  if (space === 'hallway' && this.voice.room)
    toast({ icon: 'volume-x', id: 'back-in-hallway', who: 'Back in the Great Hall', what: 'Room voice off. Get close to someone to whisper.', small: true, ttl: 2200 });
  this.walkie?.setVisible(space === 'hallway');
  if (!space) {
    this.voice.leave();
    return;
  }
  if (this.voice.space === space) return;
  this.voice.leave();
  this.voiceTimer = this.time.delayedCall(JOIN_VOICE_AFTER, () => void this.voice!.join(space));
}
