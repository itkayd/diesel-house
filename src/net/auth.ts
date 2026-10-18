import type { Session } from '@supabase/supabase-js';
import { memberLogin } from '../shared/members';
import { supabase } from './supabase';

// Three ways in, no emails anywhere:
//  - members (the 8 friends) sign in with the name + password they chose when they joined;
//  - joining: a single-use invite code from Diesel makes a member account (api/join.ts);
//  - guests: no account; they need a member's guest invite code (or a member's "open house"), checked
//    in the database by public.admit_guest(). A visit lasts 12 hours.

export const NOT_A_MEMBER = "That account isn't part of this house any more. Ask Diesel.";
export const VISIT_OVER = "Your guest visit has ended. Ask a friend in the house for their invite code.";
const BAD_GUEST_CODE = "That invite code doesn't work. Ask a friend in the house for theirs.";

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  return (await supabase.auth.getSession()).data.session;
}

export async function signInMember(name: string, password: string) {
  if (!supabase) throw new Error('The house is offline right now. Try again later.');
  const { error } = await supabase.auth.signInWithPassword({ email: memberLogin(name), password });
  if (error)
    throw new Error(
      error.status === 400 || /invalid/i.test(error.message)
        ? "That name and password don't match. Check them, or ask Diesel to reset your password."
        : error.status === 429
          ? 'Too many tries just now. Wait a minute and try again.'
          : "Couldn't sign in. Check your connection and try again.",
    );
}

export async function joinWithCode(code: string, name: string, password: string) {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, password }),
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach the house. Check your connection and try again.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't join. Try again.");
  await signInMember(name, password);
}

export async function visitAsGuest(code: string) {
  if (!supabase) throw new Error('The house is offline right now. Try again later.');
  const session = await currentSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(/disabled|not allowed/i.test(error.message) ? 'Guest visits are switched off right now.' : "Couldn't come in. Try again.");
  }
  const { data, error } = await supabase.rpc('admit_guest', { invite: code });
  if (error || data !== true) {
    await signOut();
    throw new Error(code.trim() ? BAD_GUEST_CODE : 'You need an invite code from a friend in the house.');
  }
  await authoriseRealtime(); // the guest's permissions changed; refresh what Realtime knows
}

// Is any member letting guests in without a code right now?
export async function houseIsOpen() {
  if (!supabase) return false;
  const { data } = await supabase.rpc('house_is_open');
  return data === true;
}

// Still allowed in? true / false, or null when the house couldn't be reached or answered with a server
// error. A weak signal at start-up used to read as "not a member" and signed people out (BUGS.md #3).
export async function hasAccess(guest: boolean): Promise<boolean | null> {
  if (!supabase) return false;
  const { data, error, status } = await supabase.rpc(guest ? 'is_guest' : 'is_member');
  if (error) return status === 0 || status === 408 || status >= 500 ? null : false;
  return data === true;
}

export async function signOut() {
  await supabase?.auth.signOut();
}

// Realtime needs the user's token to join the private channels; supabase-js passes it on token refresh.
export async function authoriseRealtime() {
  const s = await currentSession();
  if (s) await supabase?.realtime.setAuth(s.access_token);
}
