// The admin API (api/admin.ts) with the real SQL behind it (the local test database from
// supabase/tests/run.sh): first-time setup with the passcode, username + password sign-in, the session
// cookie's safety settings, the lockout, other sites refused, and a few controls end to end.
// Run: supabase/tests/run.sh first, then  node tests/api/admin-api.mjs
import { createServer } from 'vite';
import { fakeDb, sql } from './fakeDb.mjs';

const res = [];
const check = (n, p, ok) => res.push(`${ok ? 'PASS' : 'FAIL'}  ${n}  -> ${JSON.stringify(p)}`);

// Start clean: no admins, no attempts.
for (const t of ['admin_sessions', 'admin_login_attempts', 'admin_audit', 'admin_accounts']) sql(`delete from public.${t}`, 'postgres');
sql(`delete from public.ledger where user_id = '00000000-0000-0000-0000-0000000000c1'`, 'postgres');
sql(`delete from public.wallets where user_id = '00000000-0000-0000-0000-0000000000c1'`, 'postgres');
sql(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'api@members.diesel-house.invalid') on conflict do nothing`, 'postgres');
sql(`insert into public.allowed_emails (email) values ('api@members.diesel-house.invalid') on conflict do nothing`, 'postgres');
sql(`insert into public.profiles (id, display_name, character_index) values ('00000000-0000-0000-0000-0000000000c1', 'Api', 2) on conflict do nothing`, 'postgres');

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
const { handle } = await vite.ssrLoadModule('/api/admin.ts');
const db = fakeDb();
const env = { ADMIN_PASSCODE: 'setup-passcode-123' };
let cookie = '';
async function call(body, { origin = 'https://house.example', jar = true } = {}) {
  const headers = { 'content-type': 'application/json', host: 'house.example', origin, 'x-forwarded-for': '9.9.9.9' };
  if (jar && cookie) headers.cookie = cookie;
  const r = await handle(new Request('https://house.example/api/admin', { method: 'POST', headers, body: JSON.stringify(body) }), env, { db });
  const set = r.headers.get('set-cookie');
  if (set && jar) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
  return { status: r.status, body: await r.json(), set };
}

const st = await call({ action: 'status' });
check('a fresh house asks for first-time setup', st.body, st.status === 200 && st.body.setupNeeded === true && st.body.username === null);

const wrong = await call({ action: 'setup', passcode: 'nope', username: 'diesel', password: 'a long password here' });
check('setup needs the setup passcode', wrong.body, wrong.status === 401);

const set = await call({ action: 'setup', passcode: env.ADMIN_PASSCODE, username: 'Diesel', password: 'a long password here' });
check('setup with the passcode makes the admin and signs in', { status: set.status, user: set.body.username }, set.status === 200 && set.body.username === 'diesel');
check(
  'the session cookie can’t be read by scripts, only goes over https, only to this site',
  set.set,
  /^__Host-dh_admin=[0-9a-f]{64};/.test(set.set ?? '') && /HttpOnly/.test(set.set) && /Secure/.test(set.set) && /SameSite=Strict/.test(set.set) && /Path=\//.test(set.set),
);
const again = await call({ action: 'setup', passcode: env.ADMIN_PASSCODE, username: 'other', password: 'a long password here' }, { jar: false });
check('setup only works once', again.body, again.status === 400);

const ov = await call({ action: 'overview' });
check('signed in: the dashboard loads', Object.keys(ov.body).slice(0, 4), ov.status === 200 && typeof ov.body.members === 'number');

const cross = await call({ action: 'overview' }, { origin: 'https://evil.example' });
check('a request from another site is refused, even with the cookie', cross.body, cross.status === 403);

const nocookie = await call({ action: 'members' }, { jar: false });
check('no cookie, no data', nocookie.body, nocookie.status === 401);

const fake = await handle(
  new Request('https://house.example/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', host: 'house.example', origin: 'https://house.example', cookie: `__Host-dh_admin=${'a'.repeat(64)}` }, body: JSON.stringify({ action: 'members' }) }),
  env,
  { db },
);
check('a made-up session token is refused and the cookie cleared', { status: fake.status, set: fake.headers.get('set-cookie') }, fake.status === 401 && /Max-Age=0/.test(fake.headers.get('set-cookie') ?? ''));

const member = '00000000-0000-0000-0000-0000000000c1';
const lvl = await call({ action: 'member-update', member, patch: { level: 250, name: 'Api Pro' } });
const coins = await call({ action: 'wallet', member, currency: 'coins', amount: 1_000_000, reason: 'tournament prize' });
const gems = await call({ action: 'wallet', member, currency: 'gems', amount: 5000 });
const list = await call({ action: 'members' });
const me = list.body.find((m) => m.id === member);
check('admin sets level 250, 1,000,000 coins and 5,000 gems (no limits)', me && { level: me.level, coins: me.coins, gems: me.gems, name: me.name }, lvl.body.ok && coins.body.ok && gems.body.ok && me?.level === 250 && me.coins === 1_000_000 && me.gems === 5000 && me.name === 'Api Pro');

const off = await call({ action: 'setting-set', setting: 'games_off', value: ['quiz', 'sketch'] });
const settings = await call({ action: 'settings' });
check('admin switches games off for the whole house', settings.body.games_off, off.body.ok && JSON.stringify(settings.body.games_off) === '["quiz","sketch"]');
await call({ action: 'setting-set', setting: 'games_off', value: [] });

const audit = await call({ action: 'audit' });
check('every change is in the audit log, with who did it', audit.body.slice(0, 3).map((a) => `${a.username}: ${a.action}`), audit.body.some((a) => a.action === 'wallet' && a.username === 'diesel'));

const pw = await call({ action: 'change-password', old: 'a long password here', password: 'an even longer new password' });
check('admin changes their password', pw.body, pw.body.ok === true);

const out = await call({ action: 'logout' });
const after = await call({ action: 'overview' });
check('signing out ends the session', { out: out.status, after: after.status }, out.status === 200 && after.status === 401);

for (let i = 0; i < 5; i++) await call({ action: 'login', username: 'diesel', password: 'not it' });
const locked = await call({ action: 'login', username: 'diesel', password: 'an even longer new password' });
check('five wrong passwords lock sign-in for 15 minutes (even the right one)', locked.body, locked.status === 401 && /Too many/.test(locked.body.error));
sql(`delete from public.admin_login_attempts`, 'postgres');
const ok = await call({ action: 'login', username: 'DIESEL', password: 'an even longer new password' });
check('after the wait, the new password works', ok.body, ok.status === 200 && ok.body.ok);

await vite.close();
console.log(res.join('\n'));
process.exitCode = res.some((r) => r.startsWith('FAIL')) ? 1 : 0;
