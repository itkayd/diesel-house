import { supabase } from './supabase';
import { devTest } from './mode';

// House-wide switches set on the admin page (house_settings, supabase/migrations/20261112_admin.sql): read
// once when the house opens and then live, so a change shows for everyone within a second or two. The
// database enforces them too (20261114_house_switches.sql); this only keeps the game in step.
export type HouseSettings = {
  games_off: string[];
  arcade: { enabled: boolean };
  animals: { enabled: boolean; rooms_off: string[] };
  pets: { enabled: boolean };
  critters: { enabled: boolean };
  announcement: { text: string; until: string | null };
};

const DEFAULTS: HouseSettings = {
  games_off: [],
  arcade: { enabled: true },
  animals: { enabled: true, rooms_off: [] },
  pets: { enabled: true },
  critters: { enabled: true },
  announcement: { text: '', until: null },
};

let current: HouseSettings = structuredClone(DEFAULTS);
const listeners = new Set<(s: HouseSettings) => void>();
let started = false;

export const house = () => current;
export const gameOn = (id: string) => !current.games_off.includes(id);
export const arcadeOn = () => current.arcade.enabled !== false;
export const animalsOn = (room?: string) => current.animals.enabled !== false && !(room && current.animals.rooms_off?.includes(room));
export const petsOn = () => current.pets.enabled !== false;
export const crittersOn = () => current.critters.enabled !== false;

export function onHouseSettings(f: (s: HouseSettings) => void) {
  listeners.add(f);
  f(current);
  return () => listeners.delete(f);
}

function set(key: string, value: unknown) {
  if (!(key in DEFAULTS) || value === null || typeof value !== typeof DEFAULTS[key as keyof HouseSettings]) return;
  current = { ...current, [key]: value };
  for (const f of listeners) f(current);
}

// Tests (?test) can flip switches without a database.
export function setHouseSetting<K extends keyof HouseSettings>(key: K, value: HouseSettings[K]) {
  set(key, value);
}

export async function startHouseSettings() {
  if (started) return;
  started = true;
  if (devTest) (window as unknown as { __houseSettings?: typeof setHouseSetting }).__houseSettings = setHouseSetting;
  if (!supabase || devTest) return;
  const { data, error } = await supabase.from('house_settings').select('key, value');
  if (!error) for (const r of data ?? []) set(r.key as string, r.value);
  supabase
    .channel('house-settings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'house_settings' }, (p) => {
      const row = p.new as { key?: string; value?: unknown } | undefined;
      if (row?.key) set(row.key, row.value);
    })
    .subscribe();
}
