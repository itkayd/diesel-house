// Vercel function: POST /api/admin, used by admin.html (Diesel's door list) only.
// Makes single-use invite codes, lists members, resets forgotten passwords, removes members.
// Protected by ADMIN_PASSCODE; uses the server-side secret key (never sent to a browser).
import { isMemberLogin, PASSWORD_MIN } from '../src/shared/members';
import { adminDb, hashCode, json, newCode, same, slowDown, type Env } from './_server';

type Body = { passcode?: string; action?: string; label?: string; id?: number; userId?: string; password?: string };

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const expected = env.ADMIN_PASSCODE ?? '';
  if (expected.length < 8) return json({ error: 'Set ADMIN_PASSCODE (8+ characters) in the server settings first.' }, 503);
  const db = adminDb(env);
  if (!db) return json({ error: 'Set SUPABASE_SERVICE_ROLE_KEY in the server settings first.' }, 503);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!same(body.passcode, expected)) {
    await slowDown();
    return json({ error: 'Wrong passcode.' }, 401);
  }

  switch (body.action) {
    case 'list': {
      const [codes, profiles, users] = await Promise.all([
        db.from('invite_codes').select('id, label, created_at, used_at, used_by, revoked_at').order('created_at', { ascending: false }).limit(50),
        db.from('profiles').select('id, display_name'),
        db.auth.admin.listUsers({ perPage: 200 }),
      ]);
      const err = codes.error ?? profiles.error ?? users.error;
      if (err) return json({ error: err.message }, 500);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name]));
      const members = users.data.users
        .filter((u) => isMemberLogin(u.email))
        .map((u) => ({ id: u.id, name: names.get(u.id) ?? String(u.user_metadata?.display_name ?? '?'), joined: u.created_at, lastSeen: u.last_sign_in_at ?? null }));
      const guests = users.data.users.filter((u) => u.is_anonymous).length;
      return json({ codes: (codes.data ?? []).map((c) => ({ ...c, usedByName: c.used_by ? (names.get(c.used_by) ?? null) : null })), members, guests });
    }

    case 'make-code': {
      const code = newCode();
      const r = await db.from('invite_codes').insert({ code_hash: hashCode(code), label: body.label?.trim().slice(0, 40) || null });
      return r.error ? json({ error: r.error.message }, 500) : json({ code });
    }

    case 'revoke-code': {
      if (typeof body.id !== 'number') return json({ error: 'which code?' }, 400);
      const r = await db.from('invite_codes').update({ revoked_at: new Date().toISOString() }).eq('id', body.id).is('used_at', null);
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    case 'reset-password': {
      if (!body.userId || (body.password ?? '').length < PASSWORD_MIN)
        return json({ error: `New password needs at least ${PASSWORD_MIN} characters.` }, 400);
      const r = await db.auth.admin.updateUserById(body.userId, { password: body.password });
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    case 'remove-member': {
      if (!body.userId) return json({ error: 'which member?' }, 400);
      const u = await db.auth.admin.getUserById(body.userId);
      if (u.error || !isMemberLogin(u.data.user?.email)) return json({ error: 'Not a member.' }, 400);
      await db.from('allowed_emails').delete().eq('email', u.data.user!.email!);
      const r = await db.auth.admin.deleteUser(body.userId); // their profile goes too; rooms they owned become unowned
      return r.error ? json({ error: r.error.message }, 500) : json({ ok: true });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}
