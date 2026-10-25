// Vercel function: POST /api/admin, used by admin.html (the admin page) only.
//
// Signing in: admins have their own username + password (supabase/migrations/20261112_admin.sql). The very
// first admin is made once with the setup passcode (ADMIN_PASSCODE, a server setting) to prove it's Diesel;
// after that the passcode does nothing. A signed-in admin gets a random session token in a cookie the page's
// scripts can't read (HttpOnly), that only travels over https (Secure), only to this site (SameSite=Strict,
// __Host-). The database checks the token on every call and logs every change.
//
// Two locks: the admin_* database functions can only be called with the server's secret key (never sent to a
// browser), and each one checks the session token first.
import { isCodeShape, isMemberLogin, PASSWORD_MIN, showCode } from '../src/shared/members.js';
import { adminDb, hashCode, ipOf, json, memberAccounts, newCode, same, sameSite, slowDown, type Env } from './_server.js';

const COOKIE = '__Host-dh_admin';
const HOURS = 8;

type Body = Record<string, unknown> & { action?: string };
type Db = NonNullable<ReturnType<typeof adminDb>>;

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined);
const bool = (v: unknown) => v === true;
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

function cookieToken(request: Request) {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}
const setCookie = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HOURS * 3600}`;
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function withCookie(res: Response, cookie: string) {
  res.headers.append('Set-Cookie', cookie);
  return res;
}

// Calls a database admin function; "not signed in" from the database becomes a 401 that clears the cookie.
async function call(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === '28000') return withCookie(json({ error: 'Signed out. Sign in again.', signedOut: true }, 401), clearCookie());
    return json({ error: error.message }, 500);
  }
  return json(data ?? { ok: true });
}

// Everything the page can do once signed in, mapped to its database function. Arguments are checked here
// (type and size) and again in the database.
const ACTIONS: Record<string, [string, (b: Body) => Record<string, unknown>]> = {
  overview: ['admin_overview', () => ({})],
  members: ['admin_members', () => ({})],
  'member-update': ['admin_member_update', (b) => ({ member: uuid(b.member), patch: typeof b.patch === 'object' && b.patch ? b.patch : {} })],
  'member-history': ['admin_member_history', (b) => ({ member: uuid(b.member) })],
  wallet: ['admin_wallet', (b) => ({ member: uuid(b.member), currency: str(b.currency, 20), amount: num(b.amount), reason: str(b.reason, 120) ?? null })],
  ban: ['admin_ban', (b) => ({ member: uuid(b.member), reason: str(b.reason, 200) ?? null, banned: b.banned !== false })],
  guests: ['admin_guests', () => ({})],
  'guest-end': ['admin_guest_end', (b) => ({ guest: uuid(b.guest) })],
  rooms: ['admin_rooms', () => ({})],
  'room-update': ['admin_room_update', (b) => ({ room: str(b.room, 32), patch: typeof b.patch === 'object' && b.patch ? b.patch : {} })],
  settings: ['admin_settings', () => ({})],
  'setting-set': ['admin_setting_set', (b) => ({ setting: str(b.setting, 32), value: b.value ?? null })],
  critters: ['admin_critters', () => ({})],
  'critter-update': ['admin_critter_update', (b) => ({ critter: str(b.critter, 32), xp: num(b.xp), weight: num(b.weight) })],
  'challenge-update': ['admin_challenge_update', (b) => ({ challenge: str(b.challenge, 64), goal: num(b.goal), xp: num(b.xp), title: str(b.title, 80) ?? null })],
  scores: ['admin_scores', () => ({})],
  'score-delete': ['admin_score_delete', (b) => ({ score_id: num(b.id) })],
  'score-flags': ['admin_score_flags', () => ({})],
  logs: [
    'admin_logs',
    (b) => ({
      kinds: Array.isArray(b.kinds) ? b.kinds.filter((k) => typeof k === 'string').slice(0, 4) : null,
      open_only: b.open !== false,
      max_rows: num(b.max) ?? 200,
    }),
  ],
  'logs-resolve': [
    'admin_log_resolve',
    (b) => ({ ids: Array.isArray(b.ids) ? b.ids.filter((i) => typeof i === 'number').slice(0, 500) : [], note: str(b.note, 300) ?? null, reopen: bool(b.reopen) }),
  ],
  reports: ['admin_reports', (b) => ({ open_only: b.open !== false })],
  'reports-resolve': [
    'admin_report_resolve',
    (b) => ({ ids: Array.isArray(b.ids) ? b.ids.filter((i) => typeof i === 'number').slice(0, 500) : [], note: str(b.note, 300) ?? null, reopen: bool(b.reopen) }),
  ],
  'logs-clear': ['admin_logs_clear', (b) => ({ older_than_days: num(b.days) ?? 30 })],
  audit: ['admin_audit_list', () => ({})],
  accounts: ['admin_accounts_list', () => ({})],
  'account-add': ['admin_account_add', (b) => ({ username: str(b.username, 40), password: str(b.password, 200) })],
  'account-disable': ['admin_account_disable', (b) => ({ account: uuid(b.account), off: bool(b.off) })],
  'change-password': ['admin_change_password', (b) => ({ old_password: str(b.old, 200), new_password: str(b.password, 200) })],
};

// `opts.db` lets the tests hand in a stand-in database (tests/api/).
export async function handle(request: Request, env: Env, opts: { db?: Db } = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!sameSite(request)) return json({ error: 'Not from this site.' }, 403);
  const db = opts.db ?? adminDb(env);
  if (!db) return json({ error: 'Set SUPABASE_SERVICE_ROLE_KEY in the server settings first.' }, 503);
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const token = cookieToken(request);

  // ---- Before signing in ----
  if (body.action === 'status') {
    const { data: count, error } = await db.rpc('admin_count');
    if (error) return json({ error: error.message }, 500);
    let username: string | null = null;
    if (token) {
      const me = await db.rpc('admin_me', { token });
      username = me.error ? null : ((me.data as { username: string }).username ?? null);
    }
    const res = json({ setupNeeded: count === 0, username });
    return token && !username ? withCookie(res, clearCookie()) : res;
  }

  if (body.action === 'setup') {
    const expected = env.ADMIN_PASSCODE ?? '';
    if (expected.length < 8) return json({ error: 'Set ADMIN_PASSCODE (8+ characters) in the server settings first.' }, 503);
    if (!same(str(body.passcode), expected)) {
      await slowDown();
      return json({ error: 'Wrong setup passcode.' }, 401);
    }
    const r = await db.rpc('admin_setup', { username: str(body.username, 40) ?? '', password: str(body.password, 200) ?? '' });
    if (r.error) return json({ error: r.error.message }, 500);
    const out = r.data as { ok: boolean; why?: string };
    if (!out.ok) return json({ error: out.why }, 400);
    body.action = 'login'; // and straight in
  }

  if (body.action === 'login') {
    const r = await db.rpc('admin_login', {
      username: str(body.username, 40) ?? '',
      password: str(body.password, 200) ?? '',
      ip: ipOf(request),
      agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    });
    if (r.error) return json({ error: r.error.message }, 500);
    const out = r.data as { ok: boolean; why?: string; token?: string; username?: string };
    if (!out.ok || !out.token) {
      await slowDown();
      return json({ error: out.why ?? 'Wrong username or password.' }, 401);
    }
    return withCookie(json({ ok: true, username: out.username }), setCookie(out.token));
  }

  // ---- Signed in ----
  if (!token) return json({ error: 'Sign in first.', signedOut: true }, 401);

  if (body.action === 'logout') {
    await db.rpc('admin_logout', { token });
    return withCookie(json({ ok: true }), clearCookie());
  }

  const mapped = body.action ? ACTIONS[body.action] : undefined;
  if (mapped) return call(db, mapped[0], { token, ...mapped[1](body) });

  // Invite codes, passwords and removing members use the auth admin API, so they live here. Each checks
  // the session first and is written to the audit log.
  const me = await db.rpc('admin_me', { token });
  if (me.error) return call(db, 'admin_me', { token });
  const note = (action: string, target: string | null, detail: Record<string, unknown> | null = null) =>
    db.rpc('admin_note', { token, action, target, detail }).then(
      () => {},
      () => {},
    );

  switch (body.action) {
    case 'codes': {
      const [codes, profiles, accounts] = await Promise.all([
        db.from('invite_codes').select('id, label, created_at, used_at, used_by, revoked_at').order('created_at', { ascending: false }).limit(100),
        db.from('profiles').select('id, display_name'),
        memberAccounts(db),
      ]);
      const err = codes.error ?? profiles.error ?? accounts.error;
      if (err) return json({ error: err.message }, 500);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name]));
      return json({ codes: (codes.data ?? []).map((c) => ({ ...c, usedByName: c.used_by ? (names.get(c.used_by) ?? null) : null })), members: accounts.data.length });
    }

    // Codes Diesel already has (e.g. one per friend): stored like made ones (only a fingerprint is kept).
    case 'add-codes': {
      const list = (Array.isArray(body.codes) ? (body.codes as { code?: string; label?: string }[]) : []).slice(0, 20);
      const results: { code: string; label: string | null; ok: boolean; problem?: string }[] = [];
      for (const { code = '', label } of list) {
        const name = typeof label === 'string' ? label.trim().slice(0, 40) || null : null;
        if (typeof code !== 'string' || !isCodeShape(code)) {
          results.push({ code: String(code).trim().slice(0, 20), label: name, ok: false, problem: 'needs four letters then four numbers, like ABCD-1234' });
          continue;
        }
        const r = await db.from('invite_codes').insert({ code_hash: hashCode(code), label: name });
        results.push(
          r.error
            ? { code: showCode(code), label: name, ok: false, problem: r.error.code === '23505' ? 'already added (or used before)' : r.error.message }
            : { code: showCode(code), label: name, ok: true },
        );
      }
      await note('add invite codes', null, { added: results.filter((r) => r.ok).length });
      return json({ results });
    }

    case 'make-code': {
      const code = newCode();
      const label = str(body.label, 40)?.trim() || null;
      const r = await db.from('invite_codes').insert({ code_hash: hashCode(code), label });
      if (r.error) return json({ error: r.error.message }, 500);
      await note('make invite code', label);
      return json({ code });
    }

    case 'revoke-code': {
      const id = num(body.id);
      if (id === undefined) return json({ error: 'which code?' }, 400);
      const r = await db.from('invite_codes').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('used_at', null);
      if (r.error) return json({ error: r.error.message }, 500);
      await note('cancel invite code', String(id));
      return json({ ok: true });
    }

    case 'reset-password': {
      const userId = uuid(body.member);
      const password = str(body.password, 200) ?? '';
      if (!userId || password.length < PASSWORD_MIN) return json({ error: `New password needs at least ${PASSWORD_MIN} characters.` }, 400);
      const u = await db.auth.admin.getUserById(userId);
      if (u.error || !isMemberLogin(u.data.user?.email)) return json({ error: 'Not a member.' }, 400);
      const r = await db.auth.admin.updateUserById(userId, { password });
      if (r.error) return json({ error: r.error.message }, 500);
      await note('reset password', userId);
      return json({ ok: true });
    }

    case 'remove-member': {
      const userId = uuid(body.member);
      if (!userId) return json({ error: 'which member?' }, 400);
      const u = await db.auth.admin.getUserById(userId);
      if (u.error || !isMemberLogin(u.data.user?.email)) return json({ error: 'Not a member.' }, 400);
      await db.from('allowed_emails').delete().eq('email', u.data.user!.email!);
      const r = await db.auth.admin.deleteUser(userId); // their profile goes too
      if (r.error) return json({ error: r.error.message }, 500);
      await note('remove member', userId, { login: u.data.user!.email });
      return json({ ok: true });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}
