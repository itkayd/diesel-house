import { supabase } from './supabase';

// Who's signed in (a member, or a guest without an account), plus members' profiles (display name +
// character) in public.profiles. Guests' name and character live only in this browser (src/prefs.ts).

export type User = { id: string; email: string; guest: boolean };
let user: User | null = null;
export const setUser = (u: User | null) => (user = u);
export const currentUser = () => user;

export type Profile = { id: string; display_name: string; character_index: number };

export async function loadProfile(id: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('id, display_name, character_index').eq('id', id).maybeSingle();
  return data;
}

export async function saveProfile(id: string, name: string, character: number) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').upsert({ id, display_name: name, character_index: character });
  if (error) console.warn('Could not save your profile', error.message);
}

// Display names for a set of people (room owners).
export async function loadNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supabase || !ids.length) return out;
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', ids);
  for (const p of data ?? []) out.set(p.id, p.display_name);
  return out;
}
