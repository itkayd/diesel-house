import { CHARACTER_COUNT } from './characters';

// Per-device choices. Phase 5 moves these into the user's Supabase profile.
const CHARACTER_KEY = 'diesel-house.character';
const NAME_KEY = 'diesel-house.name';
export const NAME_MAX = 24; // matches profiles.display_name

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: the choice just won't be remembered.
  }
}

export function savedCharacter(): number | null {
  const v = read(CHARACTER_KEY);
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT ? n : null;
}

export const saveCharacter = (index: number) => write(CHARACTER_KEY, String(index));

export const savedName = () => read(NAME_KEY)?.trim().slice(0, NAME_MAX) || null;

export const saveName = (name: string) => write(NAME_KEY, name);

// How loud each person is for you, 0..1, keyed by their account id.
const VOLUME_KEY = 'diesel-house.volumes';

function volumes(): Record<string, number> {
  try {
    return JSON.parse(read(VOLUME_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function savedVolume(person: string) {
  const v = volumes()[person];
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 1;
}

export function saveVolume(person: string, v: number) {
  write(VOLUME_KEY, JSON.stringify({ ...volumes(), [person]: v }));
}

// Whether to draw your own name tag above your character.
const OWN_TAG_KEY = 'diesel-house.show-own-tag';
export const savedShowOwnTag = () => read(OWN_TAG_KEY) !== '0';
export const saveShowOwnTag = (on: boolean) => write(OWN_TAG_KEY, on ? '1' : '0');

// Which microphone to use on this device ('' = the system default).
const MIC_KEY = 'diesel-house.mic-device';
export const savedMicDevice = () => read(MIC_KEY) ?? '';
export const saveMicDevice = (id: string) => write(MIC_KEY, id);
