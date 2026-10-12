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
