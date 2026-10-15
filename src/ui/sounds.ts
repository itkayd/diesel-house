import { addSettingsSection, sectionLabel, switchRow } from './settings';

// Sound effects from public/assets/sfx/ (made with ElevenLabs): knock, doorbell, door_open, join, leave.
// Any file that isn't there yet is skipped silently. Master volume and on/off live in settings.

export type Sfx = 'knock' | 'doorbell' | 'door_open' | 'join' | 'leave';
const NAMES: Sfx[] = ['knock', 'doorbell', 'door_open', 'join', 'leave'];
const ON_KEY = 'diesel-house.sfx-on';
const VOL_KEY = 'diesel-house.sfx-volume';

const available = new Map<Sfx, string>();
let enabled = read(ON_KEY) !== '0';
let volume = Number(read(VOL_KEY) ?? '0.8');

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // not remembered in private browsing
  }
}

// Finds which sounds exist (the dev server answers missing files with the page itself, so check the type).
export async function loadSounds() {
  await Promise.all(
    NAMES.map(async (n) => {
      const url = `assets/sfx/${n}.mp3`;
      const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (res?.ok && (res.headers.get('content-type') ?? '').startsWith('audio')) available.set(n, url);
    }),
  );
}

export function play(name: Sfx, loudness = 1) {
  const url = available.get(name);
  if (!enabled || !url || volume <= 0) return;
  const a = new Audio(url);
  a.volume = Math.max(0, Math.min(1, volume * loudness));
  void a.play().catch(() => {}); // sound still locked (iPhone before a tap): skip
}

export const soundsFound = () => [...available.keys()];

export function addSoundSettings() {
  addSettingsSection(60, (box) => {
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'dh-range';
    range.id = 'sfx-volume';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(volume * 100));
    range.addEventListener('input', () => {
      volume = Number(range.value) / 100;
      write(VOL_KEY, String(volume));
    });
    range.addEventListener('change', () => play('door_open'));
    box.append(
      switchRow('sfx-on', 'Sound effects', 'Knocks, doors, people coming and going', enabled, (on) => {
        enabled = on;
        write(ON_KEY, on ? '1' : '0');
      }),
      sectionLabel('Effects volume', 'sfx-volume'),
      range,
    );
  });
}
