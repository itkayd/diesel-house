import { asSkin, legacyIndex, type Skin } from '../characters';
import { supabase } from './supabase';

// Who's signed in (a member, or a guest without an account), plus members' profiles (display name +
// character) in public.profiles. Guests' name and character live only in this browser (src/prefs.ts).

// joinedAt / signedInAt: ISO times from the account (for the profile).
export type User = { id: string; email: string; guest: boolean; joinedAt?: string; signedInAt?: string };
let user: User | null = null;
export const setUser = (u: User | null) => (user = u);
export const currentUser = () => user;

// `picked` is false until a new member has chosen their character (joining makes the profile with their name).
export type Profile = { id: string; display_name: string; character_key: Skin; picked: boolean; pet: string | null };

export async function loadProfile(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  // All columns: works before and after the R4 migrations (character_key, pet).
  const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  return { id: data.id, display_name: data.display_name, picked: data.picked, character_key: asSkin(data.character_key ?? data.character_index), pet: data.pet ?? null };
}

export async function saveProfile(id: string, name: string, character: Skin) {
  if (!supabase) return;
  const row = { id, display_name: name, character_index: legacyIndex(character), picked: true };
  let { error } = await supabase.from('profiles').upsert({ ...row, character_key: character });
  if (error && /character_key/.test(error.message)) ({ error } = await supabase.from('profiles').upsert(row)); // before migration 20261103
  if (error) console.warn('Could not save your profile', error.message);
}

// Your pet (an animal key, or null for none). The database checks it's yours (free pets from level 3).
export async function savePet(id: string, pet: string | null) {
  if (!supabase) return 'offline';
  const { error } = await supabase.from('profiles').update({ pet }).eq('id', id);
  return error?.message ?? null;
}
