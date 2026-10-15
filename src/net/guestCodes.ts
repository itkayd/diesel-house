import { CODE_ALPHABET } from '../shared/members';
import { supabase } from './supabase';

// A member's own guest invite code (public.guest_codes): share it so friends can visit as guests, switch
// it off, replace it, or open the house to anyone. Row-level security limits each member to their own row.

export type GuestCode = { owner_id: string; code: string; enabled: boolean; open_house: boolean };

function randomCode() {
  const pick = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
  return `${pick()}-${pick()}`;
}

export async function myGuestCode(ownerId: string): Promise<GuestCode | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('guest_codes').select('owner_id, code, enabled, open_house').eq('owner_id', ownerId).maybeSingle();
  return data;
}

// Makes (or replaces) the code. Tries again on the rare clash with someone else's code.
export async function newGuestCode(ownerId: string, existing: boolean): Promise<GuestCode | string> {
  if (!supabase) return 'offline';
  for (let i = 0; i < 3; i++) {
    const code = randomCode();
    const q = existing
      ? supabase.from('guest_codes').update({ code, updated_at: new Date().toISOString() }).eq('owner_id', ownerId)
      : supabase.from('guest_codes').insert({ owner_id: ownerId, code });
    const { data, error } = await q.select('owner_id, code, enabled, open_house').single();
    if (!error) return data;
    if (error.code !== '23505') return error.message;
  }
  return 'Could not make a new code. Try again.';
}

export async function setGuestCode(ownerId: string, change: Partial<Pick<GuestCode, 'enabled' | 'open_house'>>) {
  if (!supabase) return 'offline';
  const { error } = await supabase.from('guest_codes').update({ ...change, updated_at: new Date().toISOString() }).eq('owner_id', ownerId);
  return error?.message ?? null;
}
