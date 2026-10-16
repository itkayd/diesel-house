import { audioContext } from '../net/audio';
import { mixer, type Category } from './mixer';

// Sound effects and jingles from public/assets/sfx/ (name.ogg and/or name.mp3, made by
// scripts/build-sfx.mjs from the Kenney, Juhani Junkala and SoundPack01 packs; see ASSETS.md). The
// walkie-talkie sounds are made in code instead (src/ui/radioSfx.ts). Each is decoded once and
// played through its category on the mixer (src/ui/mixer.ts), so the Sound settings apply everywhere.
// Missing files are skipped silently. Settings: Sound effects on/off, Door and knock sounds, Join/leave
// chimes.

export type Sfx =
  | 'knock' | 'doorbell' | 'door_open' | 'join' | 'leave' | 'footstep' | 'footstep2'
  | 'click' | 'confirm' | 'error' | 'coin' | 'powerup' | 'emote'
  | 'levelup' | 'challenge' | 'win' | 'lose'
  | 'dice_shake' | 'dice_throw' | 'card_place' | 'card_flip' | 'card_shuffle' | 'chips';
type Kind = { category: Category; group: 'doors' | 'chimes' | 'ui' | 'music' };
const SOUNDS: Record<Sfx, Kind> = {
  knock: { category: 'game', group: 'doors' },
  doorbell: { category: 'game', group: 'doors' },
  door_open: { category: 'game', group: 'doors' },
  join: { category: 'game', group: 'chimes' },
  leave: { category: 'game', group: 'chimes' },
  footstep: { category: 'game', group: 'ui' },
  footstep2: { category: 'game', group: 'ui' },
  click: { category: 'game', group: 'ui' },
  confirm: { category: 'game', group: 'ui' },
  error: { category: 'game', group: 'ui' },
  coin: { category: 'game', group: 'ui' },
  powerup: { category: 'game', group: 'ui' },
  emote: { category: 'game', group: 'ui' },
  dice_shake: { category: 'game', group: 'ui' },
  dice_throw: { category: 'game', group: 'ui' },
  card_place: { category: 'game', group: 'ui' },
  card_flip: { category: 'game', group: 'ui' },
  card_shuffle: { category: 'game', group: 'ui' },
  chips: { category: 'game', group: 'ui' },
  levelup: { category: 'music', group: 'music' },
  challenge: { category: 'music', group: 'music' },
  win: { category: 'music', group: 'music' },
  lose: { category: 'music', group: 'music' },
};

// The sound files in public/assets/sfx/ when the site was built (see vite.config.ts), so missing ones
// aren't even asked for.
declare const __SFX_FILES__: string[];

const urls = new Map<Sfx, string>();
const buffers = new Map<Sfx, Promise<AudioBuffer | null>>();

// Works out which file to use for each sound (Ogg where the browser plays it, else MP3).
export async function loadSounds() {
  const ogg = !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"');
  for (const n of Object.keys(SOUNDS) as Sfx[]) {
    const file = [ogg ? `${n}.ogg` : null, `${n}.mp3`].find((f) => f && __SFX_FILES__.includes(f));
    if (file) urls.set(n, `assets/sfx/${file}`);
  }
}

function buffer(name: Sfx) {
  let b = buffers.get(name);
  if (!b) {
    const url = urls.get(name);
    b = url
      ? fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((data) => audioContext().decodeAudioData(data))
          .catch(() => null)
      : Promise.resolve(null);
    buffers.set(name, b);
  }
  return b;
}

export function play(name: Sfx, loudness = 1) {
  const s = mixer.levels;
  const { category, group } = SOUNDS[name];
  if (!urls.has(name)) return;
  if (group !== 'music' && !s.sfx) return;
  if ((group === 'doors' && !s.doors) || (group === 'chimes' && !s.chimes)) return;
  void buffer(name).then((buf) => {
    const ctx = audioContext();
    if (!buf || ctx.state !== 'running') return; // sound still locked (iPhone before a tap): skip
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, loudness));
    src.connect(g).connect(mixer.bus(category));
    src.start();
  });
}

export const soundsFound = () => [...urls.keys()];
