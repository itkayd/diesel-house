-- The admin page (22 Oct 2026): its own accounts (username + password), sessions, an audit log, and full
-- control of the house: members (names, XP, levels, coins, gems, bans), guests, rooms, animals and
-- critters, games and scores, challenges, house-wide settings, device logs.
--
-- Security model (two locks):
--  1. Every admin_* function below is callable ONLY by the server (service_role). Browsers (anon,
--     authenticated) can't call them at all, even with a stolen session token.
--  2. The server (api/admin.ts) passes the session token from an HttpOnly, Secure, SameSite=Strict
--     cookie; each function checks it (admin_auth) before doing anything, and logs what it changed.
-- Passwords: bcrypt (pgcrypto, cost 12), never stored or logged in plain text. Sessions: a random
-- 256-bit token; only its SHA-256 is stored; 8 hours; revocable. Logins: 5 wrong passwords lock that
-- username for 15 minutes, 10 from one network do the same for the network.

create extension if not exists pgcrypto with schema extensions;

-- ---- Accounts, sessions, attempts, audit ----
create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,32}$'),
  pw_hash text not null,
  created_at timestamptz not null default now(),
  created_by text,
  last_login_at timestamptz,
  disabled boolean not null default false
);
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.admin_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  agent text,
  revoked_at timestamptz
);
create index if not exists admin_sessions_account_idx on public.admin_sessions (account_id);
create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ip text,
  username text,
  ok boolean not null
);
create index if not exists admin_login_attempts_at_idx on public.admin_login_attempts (at desc);
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  account_id uuid references public.admin_accounts(id) on delete set null,
  username text,
  action text not null,
  target text,
  detail jsonb
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);

-- ---- House-wide settings (read by the game, written only here) ----
create table if not exists public.house_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.house_settings (key, value) values
  ('games_off', '[]'),                                   -- game ids switched off everywhere
  ('arcade', '{"enabled": true}'),                         -- Night Raid
  ('animals', '{"enabled": true, "rooms_off": []}'),       -- the animals wandering in rooms
  ('pets', '{"enabled": true}'),                           -- pets following their owners
  ('critters', '{"enabled": true}'),                       -- critters to catch for XP
  ('announcement', '{"text": "", "until": null}')          -- a banner for everyone in the house
on conflict (key) do nothing;

-- ---- Coins and gems (STORE.md §5.1; the store phase builds on these) ----
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  gems_free bigint not null default 0 check (gems_free >= 0),
  gems_paid bigint not null default 0,
  locked boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('coins', 'gems_free', 'gems_paid')),
  delta bigint not null check (delta <> 0),
  balance_after bigint not null,
  reason text not null,
  ref_type text,
  ref_id text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists ledger_user_idx on public.ledger (user_id, created_at desc);

-- ---- Bans ----
create table if not exists public.banned_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  at timestamptz not null default now(),
  by_admin text,
  lifted_at timestamptz          -- unbanned (the row stays as history)
);

-- Row rules: the game reads the house settings and your own wallet and ledger; nothing else here is
-- visible to players at all.
alter table public.admin_accounts enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.admin_audit enable row level security;
alter table public.house_settings enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger enable row level security;
alter table public.banned_users enable row level security;
revoke all on public.admin_accounts, public.admin_sessions, public.admin_login_attempts, public.admin_audit, public.banned_users from anon, authenticated;
revoke all on public.house_settings, public.wallets, public.ledger from anon, authenticated;
grant select on public.house_settings, public.wallets, public.ledger to authenticated;
drop policy if exists "the house reads its settings" on public.house_settings;
create policy "the house reads its settings" on public.house_settings for select to authenticated using ((select public.is_member()) or (select public.is_guest()));
drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet" on public.wallets for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "read own ledger" on public.ledger;
create policy "read own ledger" on public.ledger for select to authenticated using (user_id = (select auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.house_settings;
exception when duplicate_object then null;
end $$;

-- A banned person is neither a member nor a guest any more (so every check in the house refuses them).
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email', '')))
    and not exists (select 1 from public.banned_users where user_id = auth.uid() and lifted_at is null);
$$;
create or replace function public.is_guest()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.guest_admissions where user_id = auth.uid() and expires_at > now())
    and not exists (select 1 from public.banned_users where user_id = auth.uid() and lifted_at is null);
$$;

-- Your wallet (players): coins and gems.
create or replace function public.wallet()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('coins', coalesce(w.coins, 0), 'gems', coalesce(w.gems_free + w.gems_paid, 0), 'locked', coalesce(w.locked, false))
  from (select 1) one left join public.wallets w on w.user_id = auth.uid();
$$;
revoke all on function public.wallet() from public, anon;
grant execute on function public.wallet() to authenticated;

-- Moving coins or gems: internal (other functions and the server only), one ledger row per change,
-- never below zero, the same idempotency key never pays twice.
create or replace function public.grant_currency(who uuid, currency text, amount bigint, reason text, ref_type text default null, ref_id text default null, idempotency_key text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  now_bal bigint;
begin
  if amount = 0 then
    return null;
  end if;
  if idempotency_key is not null and exists (select 1 from public.ledger l where l.idempotency_key = idempotency_key) then
    return (select l.balance_after from public.ledger l where l.idempotency_key = idempotency_key);
  end if;
  insert into public.wallets (user_id) values (who) on conflict (user_id) do nothing;
  perform 1 from public.wallets w where w.user_id = who for update;
  if currency = 'coins' then
    update public.wallets w set coins = w.coins + amount, updated_at = now() where w.user_id = who returning w.coins into now_bal;
  elsif currency = 'gems_free' then
    update public.wallets w set gems_free = w.gems_free + amount, updated_at = now() where w.user_id = who returning w.gems_free into now_bal;
  elsif currency = 'gems_paid' then
    update public.wallets w set gems_paid = w.gems_paid + amount, updated_at = now() where w.user_id = who returning w.gems_paid into now_bal;
  else
    raise exception 'no such currency';
  end if;
  insert into public.ledger (user_id, currency, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
    values (who, currency, amount, now_bal, reason, ref_type, ref_id, idempotency_key);
  return now_bal;
end;
$$;
revoke all on function public.grant_currency(uuid, text, bigint, text, text, text, text) from public, anon, authenticated;

-- ---- Signing in ----
create or replace function public.admin_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select count(*)::int from public.admin_accounts where not disabled $$;

-- First admin only: the server checks the setup passcode (ADMIN_PASSCODE) before calling this.
create or replace function public.admin_setup(username text, password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if exists (select 1 from public.admin_accounts) then
    return jsonb_build_object('ok', false, 'why', 'already set up');
  end if;
  if length(coalesce(password, '')) < 12 then
    return jsonb_build_object('ok', false, 'why', 'The password needs at least 12 characters.');
  end if;
  insert into public.admin_accounts (username, pw_hash, created_by)
    values (lower(trim(username)), extensions.crypt(password, extensions.gen_salt('bf', 12)), 'setup');
  insert into public.admin_audit (username, action, target) values (lower(trim(username)), 'setup', 'first admin account');
  return jsonb_build_object('ok', true);
exception when check_violation then
  return jsonb_build_object('ok', false, 'why', 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.');
end;
$$;

create or replace function public.admin_login(username text, password text, ip text default null, agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  who text := lower(trim(coalesce(username, '')));
  acct public.admin_accounts;
  token text;
begin
  -- Too many wrong passwords lately: for this username, or from this network.
  if (select count(*) from public.admin_login_attempts a where a.username = who and not a.ok and a.at > now() - interval '15 minutes') >= 5
     or (ip is not null and (select count(*) from public.admin_login_attempts a where a.ip = ip and not a.ok and a.at > now() - interval '15 minutes') >= 10) then
    insert into public.admin_login_attempts (ip, username, ok) values (ip, who, false);
    return jsonb_build_object('ok', false, 'why', 'Too many tries. Wait 15 minutes and try again.');
  end if;
  select * into acct from public.admin_accounts a where a.username = who and not a.disabled;
  if acct.id is null or acct.pw_hash <> extensions.crypt(coalesce(password, ''), acct.pw_hash) then
    insert into public.admin_login_attempts (ip, username, ok) values (ip, who, false);
    return jsonb_build_object('ok', false, 'why', 'Wrong username or password.');
  end if;
  insert into public.admin_login_attempts (ip, username, ok) values (ip, who, true);
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions (account_id, token_hash, expires_at, ip, agent)
    values (acct.id, encode(extensions.digest(token, 'sha256'), 'hex'), now() + interval '8 hours', ip, left(agent, 300));
  update public.admin_accounts a set last_login_at = now() where a.id = acct.id;
  insert into public.admin_audit (account_id, username, action, detail) values (acct.id, acct.username, 'login', jsonb_build_object('ip', ip));
  return jsonb_build_object('ok', true, 'token', token, 'username', acct.username, 'expires_at', now() + interval '8 hours');
end;
$$;

-- Old login attempts and sessions go after 30 days (run daily by /api/ping).
create or replace function public.admin_tidy()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.admin_login_attempts a where a.at < now() - interval '30 days';
  delete from public.admin_sessions s where s.expires_at < now() - interval '30 days';
$$;

-- The signed-in admin for a session token, or an error. Every admin function starts with this.
create or replace function public.admin_auth(token text)
returns public.admin_accounts
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts;
  sid uuid;
begin
  select s.id into sid from public.admin_sessions s
    where s.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex') and s.revoked_at is null and s.expires_at > now();
  if sid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select a.* into acct from public.admin_accounts a join public.admin_sessions s on s.account_id = a.id where s.id = sid and not a.disabled;
  if acct.id is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.admin_sessions s set last_seen_at = now() where s.id = sid and s.last_seen_at < now() - interval '1 minute';
  return acct;
end;
$$;

create or replace function public.admin_audit_log(acct public.admin_accounts, action text, target text default null, detail jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit (account_id, username, action, target, detail) values (acct.id, acct.username, action, target, detail);
$$;

create or replace function public.admin_me(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object('username', acct.username, 'since', acct.created_at);
end;
$$;

create or replace function public.admin_logout(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.admin_sessions set revoked_at = now() where token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
$$;

create or replace function public.admin_change_password(token text, old_password text, new_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if acct.pw_hash <> extensions.crypt(coalesce(old_password, ''), acct.pw_hash) then
    return jsonb_build_object('ok', false, 'why', 'Your current password isn’t right.');
  end if;
  if length(coalesce(new_password, '')) < 12 then
    return jsonb_build_object('ok', false, 'why', 'The new password needs at least 12 characters.');
  end if;
  update public.admin_accounts a set pw_hash = extensions.crypt(new_password, extensions.gen_salt('bf', 12)) where a.id = acct.id;
  -- Every other session of this account ends.
  update public.admin_sessions s set revoked_at = now() where s.account_id = acct.id and s.token_hash <> encode(extensions.digest(token, 'sha256'), 'hex') and s.revoked_at is null;
  perform public.admin_audit_log(acct, 'change password', acct.username);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_accounts_list(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'username', a.username, 'created_at', a.created_at, 'last_login_at', a.last_login_at, 'disabled', a.disabled, 'me', a.id = acct.id) order by a.created_at)
    from public.admin_accounts a), '[]');
end;
$$;

create or replace function public.admin_account_add(token text, username text, password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if length(coalesce(password, '')) < 12 then
    return jsonb_build_object('ok', false, 'why', 'The password needs at least 12 characters.');
  end if;
  insert into public.admin_accounts (username, pw_hash, created_by) values (lower(trim(username)), extensions.crypt(password, extensions.gen_salt('bf', 12)), acct.username);
  perform public.admin_audit_log(acct, 'add admin', lower(trim(username)));
  return jsonb_build_object('ok', true);
exception
  when unique_violation then return jsonb_build_object('ok', false, 'why', 'That username is taken.');
  when check_violation then return jsonb_build_object('ok', false, 'why', 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.');
end;
$$;

create or replace function public.admin_account_disable(token text, account uuid, off boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if account = acct.id then
    return jsonb_build_object('ok', false, 'why', 'You can’t switch off your own account.');
  end if;
  if off and (select count(*) from public.admin_accounts a where not a.disabled and a.id <> account) < 1 then
    return jsonb_build_object('ok', false, 'why', 'There must always be one admin.');
  end if;
  update public.admin_accounts a set disabled = off where a.id = account;
  if off then update public.admin_sessions s set revoked_at = now() where s.account_id = account and s.revoked_at is null; end if;
  perform public.admin_audit_log(acct, case when off then 'disable admin' else 'enable admin' end, account::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- Overview ----
create or replace function public.admin_overview(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'members', (select count(*) from public.allowed_emails),
    'guests_now', (select count(*) from public.guest_admissions g where g.expires_at > now()),
    'banned', (select count(*) from public.banned_users b where b.lifted_at is null),
    'active_today', (select count(*) from public.profiles p where p.last_visit_date >= current_date - 1),
    'logs_open', (select count(*) from public.client_errors e where e.resolved_at is null),
    'logs_24h', (select count(*) from public.client_errors e where e.at > now() - interval '24 hours'),
    'reports_open', (select count(*) from public.client_errors e where e.kind = 'report' and e.resolved_at is null),
    'games_week', (select count(*) from public.game_results r where r.created_at > now() - interval '7 days'),
    'arcade_week', (select count(*) from public.arcade_scores s where s.created_at > now() - interval '7 days'),
    'arcade_record', (select max(s.score) from public.arcade_scores s),
    'xp_today', (select coalesce(sum(l.amount), 0) from public.xp_ledger l where l.created_at > now() - interval '24 hours'),
    'catches_today', (select count(*) from public.critter_catches c where c.caught_at > now() - interval '24 hours'),
    'chat_today', (select count(*) from public.messages m where m.created_at > now() - interval '24 hours'),
    'logs_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select date_trunc('day', e.at)::date d, count(*) n from public.client_errors e where e.at > now() - interval '14 days' group by 1) x), '[]')
  );
end;
$$;

-- ---- Members ----
create or replace function public.admin_members(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'login', u.email, 'name', p.display_name, 'character', p.character_key, 'pet', p.pet,
      'xp', coalesce(p.xp, 0), 'level', coalesce(p.level, 1), 'streak', coalesce(p.streak_days, 0),
      'coins', coalesce(w.coins, 0), 'gems', coalesce(w.gems_free + w.gems_paid, 0),
      'joined', u.created_at, 'last_seen', u.last_sign_in_at, 'last_visit', p.last_visit_date,
      'banned', b.user_id is not null, 'ban_reason', b.reason,
      'arcade_best', (select max(s.score) from public.arcade_scores s where s.user_id = u.id)
    ) order by p.display_name nulls last)
    from auth.users u
    join public.allowed_emails ae on ae.email = lower(u.email)
    left join public.profiles p on p.id = u.id
    left join public.wallets w on w.user_id = u.id
    left join public.banned_users b on b.user_id = u.id and b.lifted_at is null), '[]');
end;
$$;

create or replace function public.admin_member_update(token text, member uuid, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  xp_now bigint;
  want bigint;
begin
  if not exists (select 1 from public.profiles p where p.id = member) then
    return jsonb_build_object('ok', false, 'why', 'No such player.');
  end if;
  if patch ? 'name' then
    if length(trim(patch ->> 'name')) not between 1 and 24 then
      return jsonb_build_object('ok', false, 'why', 'Names are 1–24 characters.');
    end if;
    update public.profiles p set display_name = trim(patch ->> 'name') where p.id = member;
  end if;
  -- XP: set exactly, add/remove, or set a level (the XP that level starts at).
  select p.xp into xp_now from public.profiles p where p.id = member;
  want := case
    when patch ? 'xp' then (patch ->> 'xp')::bigint
    when patch ? 'add_xp' then xp_now + (patch ->> 'add_xp')::bigint
    when patch ? 'level' then public.xp_for_level(greatest(1, least(10000, (patch ->> 'level')::int)))
    else null end;
  if want is not null then
    want := greatest(0, want);
    update public.profiles p set xp = want, level = public.level_for_xp(want) where p.id = member;
    if want <> xp_now then
      insert into public.xp_ledger (user_id, amount, reason) values (member, (want - xp_now)::int, 'admin:' || acct.username);
    end if;
  end if;
  if patch ? 'streak' then
    update public.profiles p set streak_days = greatest(0, (patch ->> 'streak')::int), best_streak = greatest(p.best_streak, (patch ->> 'streak')::int) where p.id = member;
  end if;
  if patch ? 'pet' then
    update public.profiles p set pet = nullif(patch ->> 'pet', '') where p.id = member;
  end if;
  perform public.admin_audit_log(acct, 'edit player', member::text, patch);
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'why', sqlerrm);
end;
$$;

-- Coins and gems: add (positive) or take away (negative), never below zero.
create or replace function public.admin_wallet(token text, member uuid, currency text, amount bigint, reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  bal bigint;
begin
  if currency = 'gems' then currency := 'gems_free'; end if;
  bal := public.grant_currency(member, currency, amount, 'admin: ' || coalesce(nullif(trim(reason), ''), 'adjustment'), 'admin', acct.username);
  perform public.admin_audit_log(acct, 'wallet', member::text, jsonb_build_object('currency', currency, 'amount', amount, 'reason', reason));
  return jsonb_build_object('ok', true, 'balance', bal);
exception when check_violation then
  return jsonb_build_object('ok', false, 'why', 'That would go below zero.');
end;
$$;

create or replace function public.admin_ban(token text, member uuid, reason text default null, banned boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if banned then
    insert into public.banned_users (user_id, reason, by_admin) values (member, nullif(trim(reason), ''), acct.username)
      on conflict (user_id) do update set reason = excluded.reason, at = now(), by_admin = excluded.by_admin, lifted_at = null;
    -- A banned guest's visit ends too.
    update public.guest_admissions g set expires_at = now() where g.user_id = member and g.expires_at > now();
  else
    update public.banned_users b set lifted_at = now() where b.user_id = member and b.lifted_at is null;
  end if;
  perform public.admin_audit_log(acct, case when banned then 'ban' else 'unban' end, member::text, jsonb_build_object('reason', reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- What a player has been up to: XP, coins and gems history, scores, logs.
create or replace function public.admin_member_history(token text, member uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'xp', coalesce((select jsonb_agg(x order by x.created_at desc) from (select l.amount, l.reason, l.created_at from public.xp_ledger l where l.user_id = member order by l.created_at desc limit 40) x), '[]'),
    'money', coalesce((select jsonb_agg(x order by x.created_at desc) from (select l.currency, l.delta, l.balance_after, l.reason, l.created_at from public.ledger l where l.user_id = member order by l.created_at desc limit 40) x), '[]'),
    'scores', coalesce((select jsonb_agg(x order by x.created_at desc) from (select s.id, s.score, s.waves, s.duration_ms, s.created_at from public.arcade_scores s where s.user_id = member order by s.created_at desc limit 20) x), '[]'),
    'logs', coalesce((select jsonb_agg(x order by x.at desc) from (select e.id, e.kind, e.message, e.at from public.client_errors e where e.user_id = member order by e.at desc limit 20) x), '[]')
  );
end;
$$;

-- ---- Guests ----
create or replace function public.admin_guests(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', g.user_id, 'name', p.display_name, 'host', h.display_name, 'admitted_at', g.admitted_at, 'expires_at', g.expires_at, 'banned', b.user_id is not null) order by g.admitted_at desc)
    from public.guest_admissions g
    left join public.profiles p on p.id = g.user_id
    left join public.profiles h on h.id = g.invited_by
    left join public.banned_users b on b.user_id = g.user_id and b.lifted_at is null
    where g.expires_at > now() - interval '1 day'), '[]');
end;
$$;

create or replace function public.admin_guest_end(token text, guest uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  update public.guest_admissions g set expires_at = now() where g.user_id = guest and g.expires_at > now();
  perform public.admin_audit_log(acct, 'end guest visit', guest::text);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- Rooms ----
create or replace function public.admin_rooms(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'active', r.active, 'dnd', r.dnd, 'games', r.games, 'prompts', r.prompts,
      'music', r.music, 'media', r.media_kind) order by r.id)
    from public.rooms r where r.active), '[]');
end;
$$;

create or replace function public.admin_room_update(token text, room text, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if not exists (select 1 from public.rooms r where r.id = room) then
    return jsonb_build_object('ok', false, 'why', 'No such room.');
  end if;
  if patch ? 'name' then
    if length(trim(patch ->> 'name')) not between 1 and 24 then return jsonb_build_object('ok', false, 'why', 'Room names are 1–24 characters.'); end if;
    update public.rooms r set name = trim(patch ->> 'name'), updated_at = now() where r.id = room;
  end if;
  if patch ? 'dnd' then
    update public.rooms r set dnd = (patch ->> 'dnd')::boolean, dnd_set_by = null, dnd_at = case when (patch ->> 'dnd')::boolean then now() end, updated_at = now() where r.id = room;
  end if;
  if patch ? 'games' then
    update public.rooms r set games = case when jsonb_typeof(patch -> 'games') = 'null' then null else array(select jsonb_array_elements_text(patch -> 'games')) end, updated_at = now() where r.id = room;
  end if;
  if patch ? 'prompts' then
    update public.rooms r set prompts = case when jsonb_typeof(patch -> 'prompts') = 'null' then null else array(select left(jsonb_array_elements_text(patch -> 'prompts'), 200)) end, updated_at = now() where r.id = room;
  end if;
  if (patch ->> 'stop_music')::boolean then
    update public.rooms r set music = null, music_at = null, music_by = null, updated_at = now() where r.id = room;
  end if;
  if (patch ->> 'stop_media')::boolean then
    update public.rooms r set media_kind = null, media_id = null, media_pos = null, media_at = null, media_paused = false, media_by = null, updated_at = now() where r.id = room;
  end if;
  perform public.admin_audit_log(acct, 'edit room', room, patch);
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'why', sqlerrm);
end;
$$;

-- ---- House settings (games off, arcade, animals, pets, critters, announcement) ----
create or replace function public.admin_settings(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_object_agg(s.key, s.value) from public.house_settings s), '{}');
end;
$$;

create or replace function public.admin_setting_set(token text, setting text, value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if setting not in ('games_off', 'arcade', 'animals', 'pets', 'critters', 'announcement') then
    return jsonb_build_object('ok', false, 'why', 'No such setting.');
  end if;
  if pg_column_size(value) > 4000 then
    return jsonb_build_object('ok', false, 'why', 'Too big.');
  end if;
  insert into public.house_settings (key, value, updated_at, updated_by) values (setting, value, now(), acct.username)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public.admin_audit_log(acct, 'house setting', setting, value);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- Critters and challenges ----
create or replace function public.admin_critters(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'critters', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'xp', c.xp, 'weight', c.weight,
        'caught_week', (select count(*) from public.critter_catches k where k.critter = c.id and k.caught_at > now() - interval '7 days')) order by c.ord) from public.critter_defs c), '[]'),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'period', d.period, 'title', d.title, 'kind', d.kind, 'goal', d.goal, 'xp', d.xp) order by d.period, d.id) from public.challenge_defs d), '[]')
  );
end;
$$;

-- A critter's XP and how often it turns up (weight 0 = never).
create or replace function public.admin_critter_update(token text, critter text, xp integer, weight integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if xp not between 0 and 1000000 or weight not between 0 and 1000000 then
    return jsonb_build_object('ok', false, 'why', 'XP and weight can’t be negative.');
  end if;
  update public.critter_defs c set xp = admin_critter_update.xp, weight = admin_critter_update.weight where c.id = critter;
  perform public.admin_audit_log(acct, 'edit critter', critter, jsonb_build_object('xp', xp, 'weight', weight));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_challenge_update(token text, challenge text, goal integer, xp integer, title text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  if goal not between 1 and 1000000 or xp not between 0 and 1000000 then
    return jsonb_build_object('ok', false, 'why', 'The goal is at least 1 and XP can’t be negative.');
  end if;
  update public.challenge_defs d set goal = admin_challenge_update.goal, xp = admin_challenge_update.xp,
    title = coalesce(nullif(trim(admin_challenge_update.title), ''), d.title) where d.id = challenge;
  perform public.admin_audit_log(acct, 'edit challenge', challenge, jsonb_build_object('goal', goal, 'xp', xp, 'title', title));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- Scores ----
create or replace function public.admin_scores(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'arcade', coalesce((select jsonb_agg(x) from (
        select s.id, s.user_id, p.display_name as name, s.score, s.waves, s.duration_ms, s.xp, s.created_at
        from public.arcade_scores s left join public.profiles p on p.id = s.user_id order by s.created_at desc limit 200) x), '[]'),
    'games', coalesce((select jsonb_agg(x) from (
        select r.id, r.game, r.spot, r.created_at, cardinality(r.players) as players,
          (select string_agg(p.display_name, ', ') from public.profiles p where p.id = any (r.winner_ids)) as winners
        from public.game_results r order by r.created_at desc limit 100) x), '[]')
  );
end;
$$;

-- Remove an arcade score (and the XP it paid).
create or replace function public.admin_score_delete(token text, score_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  s public.arcade_scores;
begin
  select * into s from public.arcade_scores a where a.id = score_id;
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'No such score.'); end if;
  delete from public.arcade_scores a where a.id = score_id;
  if s.xp > 0 then
    update public.profiles p set xp = greatest(0, p.xp - s.xp), level = public.level_for_xp(greatest(0, p.xp - s.xp)) where p.id = s.user_id;
    insert into public.xp_ledger (user_id, amount, reason) values (s.user_id, -s.xp, 'admin: score removed');
  end if;
  perform public.admin_audit_log(acct, 'delete score', score_id::text, to_jsonb(s));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- Device logs ----
create or replace function public.admin_logs(token text, kinds text[] default null, open_only boolean default true, max_rows integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(x) from (
      select e.id, e.at, e.kind, e.message, e.stack, e.page, e.agent, e.build, e.context, e.resolved_at, e.note, e.user_id, p.display_name as name
      from public.client_errors e left join public.profiles p on p.id = e.user_id
      where (kinds is null or e.kind = any (kinds)) and (not open_only or e.resolved_at is null)
      order by e.at desc limit least(greatest(max_rows, 1), 1000)) x), '[]');
end;
$$;

create or replace function public.admin_log_resolve(token text, ids bigint[], note text default null, reopen boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  update public.client_errors e set resolved_at = case when reopen then null else now() end, note = coalesce(nullif(trim(note), ''), e.note) where e.id = any (ids);
  perform public.admin_audit_log(acct, case when reopen then 'reopen logs' else 'resolve logs' end, array_to_string(ids, ','), jsonb_build_object('note', note));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_logs_clear(token text, older_than_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  n integer;
begin
  delete from public.client_errors e where e.resolved_at is not null and e.at < now() - make_interval(days => greatest(older_than_days, 1));
  get diagnostics n = row_count;
  perform public.admin_audit_log(acct, 'clear logs', older_than_days::text, jsonb_build_object('deleted', n));
  return jsonb_build_object('ok', true, 'deleted', n);
end;
$$;

-- ---- Audit ----
create or replace function public.admin_audit_list(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(x) from (select a.at, a.username, a.action, a.target, a.detail from public.admin_audit a order by a.at desc limit 300) x), '[]');
end;
$$;

-- Only the server may call any of these (two locks: this, and the session token inside).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname = 'grant_currency') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
