// Helpers for the server functions (files starting with _ are not endpoints on Vercel).
import { createClient } from '@supabase/supabase-js';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { CODE_ALPHABET, normaliseCode } from '../src/shared/members';

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
  const pick = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
}

export function same(given: string | undefined, expected: string) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const slowDown = () => new Promise((r) => setTimeout(r, 600));
