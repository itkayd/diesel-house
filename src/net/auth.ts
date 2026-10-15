import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Sign-in with an emailed magic link; only people on the guest list (public.allowed_emails, checked by
// public.is_member()) get into the house.

export const NOT_ON_LIST = "That email isn't on the guest list. Ask Diesel to add you.";

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  return (await supabase.auth.getSession()).data.session;
}

export async function sendMagicLink(email: string) {
  if (!supabase) throw new Error('The house is offline right now. Try again later.');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });
  if (error)
    throw new Error(
      error.status === 422 || /not allowed|signups/i.test(error.message)
        ? NOT_ON_LIST
        : error.status === 429
          ? 'Too many links sent just now. Wait a few minutes and try again.'
          : "The link didn't send. Check your connection and try again.",
    );
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
