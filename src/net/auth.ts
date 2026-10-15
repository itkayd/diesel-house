import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Sign-in with a magic link (sent by Diesel, see requestAccess); only people on the guest list (public.allowed_emails, checked by
// public.is_member()) get into the house.

export const NOT_ON_LIST = "That email isn't on the guest list. Ask Diesel to add you.";

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  return (await supabase.auth.getSession()).data.session;
}

// Knocking: records the email for Diesel (public.access_requests). He gets each person a sign-in link
// from /admin.html and emails it himself, so the house doesn't depend on Supabase's few-an-hour sender.
export async function requestAccess(email: string) {
  if (!supabase) throw new Error('The house is offline right now. Try again later.');
  const { error } = await supabase.from('access_requests').insert({ email });
  if (error && error.code !== '23505') // 23505: already knocking, that's fine
    throw new Error("The knock didn't go through. Check your connection and try again.");
}

export async function isMember(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_member');
  return !error && data === true;
}

export async function signOut() {
  await supabase?.auth.signOut();
}

// Resolves with the session as soon as there is one (already signed in, or back from a magic link).
export function waitForSession(): Promise<Session> {
  return new Promise((resolve) => {
    const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (session) {
        data.subscription.unsubscribe();
        resolve(session);
      }
    });
  });
}

// Realtime needs the user's token to join the private channels; supabase-js passes it on token refresh.
export async function authoriseRealtime() {
  const s = await currentSession();
  if (s) await supabase?.realtime.setAuth(s.access_token);
}
