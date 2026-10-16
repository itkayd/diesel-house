import { audioContext } from '../net/audio';

// One place for every volume in the game, saved per device. Game sounds and music play through one Web
// Audio bus (a GainNode per category, then master), so the sliders apply everywhere. Voices play on
// <audio> elements (the reliable path for calls on phones); their level is master × voices × that
// friend's own volume. iPhones ignore volume on <audio>, so there voices follow the phone's buttons.

export type Category = 'game' | 'music' | 'radio';
export type Levels = { master: number; voices: number; game: number; music: number; radio: number };
export type Switches = { sfx: boolean; doors: boolean; chimes: boolean; muteHidden: boolean };

const KEY = 'diesel-house.sound';
const DEFAULT: Levels & Switches = { master: 0.9, voices: 1, game: 0.8, music: 0.6, radio: 0.9, sfx: true, doors: true, chimes: true, muteHidden: false };

function load(): Levels & Switches {
  try {
    const old = Number(localStorage.getItem('diesel-house.sfx-volume') ?? NaN); // before the mixer existed
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT, ...(Number.isFinite(old) ? { game: old } : {}), ...(localStorage.getItem('diesel-house.sfx-on') === '0' ? { sfx: false } : {}), ...saved };
  } catch {
    return { ...DEFAULT };
  }
}

const state = load();
const listeners = new Set<() => void>();
let master: GainNode | null = null;
const buses = new Map<Category, GainNode>();
const hidden = () => state.muteHidden && document.hidden;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // not remembered in private browsing
  }
}

function apply() {
  if (master) master.gain.value = hidden() ? 0 : state.master;
  for (const [c, g] of buses) g.gain.value = state[c];
  for (const f of listeners) f();
}

document.addEventListener('visibilitychange', apply);

export const mixer = {
  get levels(): Readonly<Levels & Switches> {
    return state;
  },
  set<K extends keyof (Levels & Switches)>(key: K, value: (Levels & Switches)[K]) {
    state[key] = value;
    save();
    apply();
  },
  // The GainNode a category's sounds connect to (created on first use).
  bus(c: Category): GainNode {
    const ctx = audioContext();
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    let g = buses.get(c);
    if (!g) {
      g = ctx.createGain();
      g.connect(master);
      buses.set(c, g);
    }
    apply();
    return g;
  },
  // Volume for a friend's voice: master × voices × their own volume (0..1).
  voiceVolume(person: number) {
    return hidden() ? 0 : Math.max(0, Math.min(1, state.master * state.voices * person));
  },
  // Called when any level changes (voice.ts re-applies voice volumes).
  onChange(f: () => void) {
    listeners.add(f);
  },
};
