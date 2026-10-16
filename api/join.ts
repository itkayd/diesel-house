// Vercel function: POST /api/join { code, name, password } -> makes a member account.
// The invite code (made by Diesel on the door list) works once. No email is involved: the browser then
// signs in with name + password (src/shared/members.ts maps the name to the account's login).
import { cleanName, DOMAIN, MAX_MEMBERS, memberLogin, NAME_MAX, NAME_MIN, PASSWORD_MIN } from '../src/shared/members';
import { adminDb, hashCode, json, slowDown, type Env } from './_server';

type Body = { code?: string; name?: string; password?: string };

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const db = adminDb(env);
  if (!db) return json({ error: 'Joining is switched off right now. Ask Diesel.' }, 503);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const name = cleanName(body.name ?? '');
  const password = body.password ?? '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) return json({ error: `Pick a name up to ${NAME_MAX} letters.` }, 400);
  if (password.length < PASSWORD_MIN) return json({ error: `Your password needs at least ${PASSWORD_MIN} characters.` }, 400);

  // Only 8 accounts, ever at once: one per room.
  // Counted from the guest list, not by listing accounts (guests have accounts too, any number of them).
  const members = await db.from('allowed_emails').select('email', { count: 'exact', head: true }).like('email', `%@${DOMAIN}`);
  if (members.error || members.count === null) return json({ error: "Couldn't make your account. Try again." }, 500);
  if (members.count >= MAX_MEMBERS)
    return json({ error: 'The house is full: all 8 places are taken. Ask Diesel.' }, 409);

  // Claim the code in one step, so two people can't use it at once.
  const claimed = await db
    .from('invite_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code_hash', hashCode(body.code ?? ''))
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id');
  const codeId = claimed.data?.[0]?.id;
  if (!codeId) {
    await slowDown();
    return json({ error: "That invite code doesn't work. It may have been used already. Ask Diesel for a new one." }, 400);
  }
  const release = () => db.from('invite_codes').update({ used_at: null }).eq('id', codeId);

  const email = memberLogin(name);
  const made = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (made.error || !made.data.user) {
    await release();
    const taken = /already|registered|exists/i.test(made.error?.message ?? '');
    return json({ error: taken ? 'Someone already has that name. Pick another.' : "Couldn't make your account. Try again." }, taken ? 409 : 500);
  }
  const id = made.data.user.id;
  const results = await Promise.all([
    db.from('invite_codes').update({ used_by: id }).eq('id', codeId),
    db.from('allowed_emails').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true }),
    db.from('profiles').upsert({ id, display_name: name, character_index: 0 }),
  ]);
  const failed = results.find((r) => r.error);
  if (failed) {
    await db.auth.admin.deleteUser(id);
    await release();
    return json({ error: "Couldn't finish making your account. Try again." }, 500);
  }
  return json({ ok: true });
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}
