// Helpers for the server functions (files starting with _ are not endpoints on Vercel).
import { createClient } from '@supabase/supabase-js';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { makeCode, normaliseCode } from '../src/shared/members';

export type Env = Record<string, string | undefined>;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Supabase with the secret key (server only; never sent to a browser). Null if not configured.
export function adminDb(env: Env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const hashCode = (code: string) => createHash('sha256').update(normaliseCode(code)).digest('hex');

export function newCode() {
  return makeCode((n) => randomInt(n));
}

export function same(given: string | undefined, expected: string) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const slowDown = () => new Promise((r) => setTimeout(r, 600));

type Db = NonNullable<ReturnType<typeof adminDb>>;

// The member accounts, from the guest list (allowed_emails), not by listing every account: each guest visit
// makes an anonymous account too, and there can be any number of those.
type MemberAccount = { id: string; email: string; created_at: string; last_sign_in_at: string | null };
export async function memberAccounts(db: Db) {
  const { data, error } = await db.rpc('member_accounts');
  return { data: (data ?? []) as MemberAccount[], error };
}

// Deletes guest accounts whose visit ended over 7 days ago, or that signed in over 7 days ago and never got
// in. Their chat messages stay (with the name they posted under). Run daily by /api/ping.
export async function removeStaleGuests(db: Db) {
  const { data, error } = await db.rpc('stale_guest_ids', { max_rows: 500 });
  if (error) return { removed: 0, error: error.message };
  let removed = 0;
  let failed: string | null = null;
  for (const id of (data ?? []) as string[]) {
    const r = await db.auth.admin.deleteUser(id);
    if (r.error) failed ??= r.error.message;
    else removed++;
  }
  return { removed, error: failed };
}
