// Vercel function: GET /api/ping, run once a day by the cron in vercel.json. Supabase's free tier pauses
// a project after a week with no activity; one tiny read a day keeps it awake. It also tidies up guest
// accounts whose visit ended over a week ago, and admin sign-ins over 30 days old (needs SUPABASE_SERVICE_ROLE_KEY
// and CRON_SECRET).
// If CRON_SECRET is set (Vercel sends it as a bearer token to its own cron calls), only those calls count.

import { adminDb, json, removeStaleGuests, type Env } from './_server.js';

export async function handle(request: Request, env: Env): Promise<Response> {
  const secret = env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'forbidden' }, 403);

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return json({ error: 'Supabase not configured' }, 503);

  // Any query counts as activity. Without a login this returns no rows (rooms are members-only).
  const res = await fetch(`${url}/rest/v1/rooms?select=id&limit=1`, { headers: { apikey: key } });
  // Tidying (deleting old guest accounts, old admin sign-ins) only for Vercel's own cron, never for a stranger.
  const db = secret ? adminDb(env) : null;
  const guests = db ? await removeStaleGuests(db) : { removed: 0, error: secret ? 'SUPABASE_SERVICE_ROLE_KEY not set' : 'CRON_SECRET not set: no tidying' };
  if (db) await db.rpc('admin_tidy').then(() => {}, () => {});
  return json({ ok: res.ok, status: res.status, staleGuestsRemoved: guests.removed, cleanupError: guests.error, at: new Date().toISOString() }, res.ok ? 200 : 502);
}

export function GET(request: Request): Promise<Response> {
  return handle(request, process.env);
}
