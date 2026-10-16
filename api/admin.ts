// Vercel function: POST /api/admin, used by admin.html (Diesel's door list) only.
// Makes single-use invite codes (or adds codes Diesel already has), lists members, resets forgotten passwords, removes members.
// Protected by ADMIN_PASSCODE; uses the server-side secret key (never sent to a browser).
import { isCodeShape, isMemberLogin, PASSWORD_MIN, showCode } from '../src/shared/members.js';
import { adminDb, hashCode, json, memberAccounts, newCode, same, slowDown, type Env } from './_server.js';

type Body = { passcode?: string; action?: string; label?: string; id?: number; userId?: string; password?: string; codes?: { code?: string; label?: string }[] };

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
      const [codes, profiles, accounts, visiting] = await Promise.all([
        db.from('invite_codes').select('id, label, created_at, used_at, used_by, revoked_at').order('created_at', { ascending: false }).limit(50),
        db.from('profiles').select('id, display_name'),
        memberAccounts(db),
        db.from('guest_admissions').select('user_id', { count: 'exact', head: true }).gt('expires_at', new Date().toISOString()),
      ]);
      const err = codes.error ?? profiles.error ?? accounts.error ?? visiting.error;
      if (err) return json({ error: err.message }, 500);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name]));
      const members = (accounts.data ?? []).map((u) => ({ id: u.id, name: names.get(u.id) ?? '?', joined: u.created_at, lastSeen: u.last_sign_in_at }));
      const guests = visiting.count ?? 0; // guests whose visit hasn't run out
      return json({ codes: (codes.data ?? []).map((c) => ({ ...c, usedByName: c.used_by ? (names.get(c.used_by) ?? null) : null })), members, guests });
    }

    // Codes Diesel already has (e.g. one per friend): stored like made ones (only a fingerprint is kept).
    case 'add-codes': {
      const list = (body.codes ?? []).slice(0, 20);
      const results: { code: string; label: string | null; ok: boolean; problem?: string }[] = [];
      for (const { code = '', label } of list) {
        const name = label?.trim().slice(0, 40) || null;
        if (!isCodeShape(code)) {
          results.push({ code: code.trim(), label: name, ok: false, problem: 'needs four letters then four numbers, like ABCD-1234' });
          continue;
        }
        const r = await db.from('invite_codes').insert({ code_hash: hashCode(code), label: name });
        results.push(
          r.error
            ? { code: showCode(code), label: name, ok: false, problem: r.error.code === '23505' ? 'already added (or used before)' : r.error.message }
            : { code: showCode(code), label: name, ok: true },
        );
      }
      return json({ results });
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
