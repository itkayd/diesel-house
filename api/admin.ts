// Vercel function: POST /api/admin, used by admin.html (Diesel only).
// Lists knock requests, makes sign-in links for Diesel to email himself, and manages the guest list.
// Protected by ADMIN_PASSCODE; talks to Supabase with the secret key (SUPABASE_SERVICE_ROLE_KEY),
// which stays on the server and is never sent to a browser.
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;
type Body = { passcode?: string; action?: string; email?: string; id?: number; redirectTo?: string };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function passcodeOk(given: string | undefined, expected: string) {
  const a = Buffer.from(given ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const expected = env.ADMIN_PASSCODE ?? '';
  if (expected.length < 8) return json({ error: 'Set ADMIN_PASSCODE (8+ characters) in the server settings first.' }, 503);
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json({ error: 'Set SUPABASE_SERVICE_ROLE_KEY in the server settings first.' }, 503);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!passcodeOk(body.passcode, expected)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return json({ error: 'Wrong passcode.' }, 401);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = body.email?.trim().toLowerCase();

  switch (body.action) {
    case 'list': {
      const [requests, guests] = await Promise.all([
        db.from('access_requests').select('id, email, created_at, status, handled_at').order('created_at', { ascending: false }).limit(100),
        db.from('allowed_emails').select('email, added_at').order('added_at'),
      ]);
      if (requests.error || guests.error) return json({ error: (requests.error ?? guests.error)!.message }, 500);
      return json({ requests: requests.data, guests: guests.data });
    }

    // Puts them on the guest list (if needed) and makes a one-time sign-in link for Diesel to send.
    case 'link': {
      if (!email || !EMAIL.test(email)) return json({ error: 'That is not an email address.' }, 400);
      const guest = await db.from('allowed_emails').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
      if (guest.error) return json({ error: guest.error.message }, 500);
      const redirectTo = body.redirectTo && /^https?:\/\//.test(body.redirectTo) ? body.redirectTo : new URL(request.url).origin;
      let link = await db.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
      if (link.error) {
        // First time: make their account, then the link.
        const made = await db.auth.admin.createUser({ email, email_confirm: true });
        if (made.error && !/already/i.test(made.error.message)) return json({ error: made.error.message }, 500);
        link = await db.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
      }
      if (link.error) return json({ error: link.error.message }, 500);
      await db.from('access_requests').update({ status: 'sent', handled_at: new Date().toISOString() }).eq('email', email).eq('status', 'pending');
      return json({ link: link.data.properties.action_link, email });
    }

    case 'dismiss': {
      if (typeof body.id !== 'number') return json({ error: 'which request?' }, 400);
      const r = await db.from('access_requests').update({ status: 'dismissed', handled_at: new Date().toISOString() }).eq('id', body.id);
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    case 'guest-add': {
      if (!email || !EMAIL.test(email)) return json({ error: 'That is not an email address.' }, 400);
      const r = await db.from('allowed_emails').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    case 'guest-remove': {
      if (!email) return json({ error: 'which email?' }, 400);
      const r = await db.from('allowed_emails').delete().eq('email', email);
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}
