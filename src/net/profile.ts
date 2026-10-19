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
export type Profile = { id: string; display_name: string; character_key: Skin; picked: boolean };

export async function loadProfile(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('profiles').select('id, display_name, character_index, character_key, picked').eq('id', id).maybeSingle();
  if (!error) return data ? { ...data, character_key: asSkin(data.character_key ?? data.character_index) } : null;
  // The database doesn't have character_key yet (migration 20261103 not applied): use the old number.
  const old = await supabase.from('profiles').select('id, display_name, character_index, picked').eq('id', id).maybeSingle();
  return old.data ? { ...old.data, character_key: asSkin(old.data.character_index) } : null;
}

export async function saveProfile(id: string, name: string, character: Skin) {
  if (!supabase) return;
  const row = { id, display_name: name, character_index: legacyIndex(character), picked: true };
  let { error } = await supabase.from('profiles').upsert({ ...row, character_key: character });
  if (error && /character_key/.test(error.message)) ({ error } = await supabase.from('profiles').upsert(row)); // before migration 20261103
  if (error) console.warn('Could not save your profile', error.message);
}
