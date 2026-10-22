-- Admin checks on a local Postgres (supabase/tests/run.sh): accounts, sessions, lockout, the two locks,
-- and the controls (players, coins and gems, bans, settings, scores, logs).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
create or replace function pg_temp.sign_in(who uuid, email text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email, 'is_anonymous', anon)::text, false);
$$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
set client_min_messages = notice;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'adm@members.diesel-house.invalid') on conflict do nothing;
insert into public.allowed_emails (email) values ('adm@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name, character_index) values ('00000000-0000-0000-0000-0000000000a1', 'Ash', 3) on conflict do nothing;

-- ---- Lock 1: browsers can't call admin functions at all ----
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'adm@members.diesel-house.invalid');
do $$ begin
  perform public.admin_setup('sneaky', 'a-long-enough-password');
  raise exception 'FAIL: a player called admin_setup';
exception when insufficient_privilege then raise notice 'PASS: players can''t call admin functions';
end $$;
do $$ begin
  perform public.grant_currency(auth.uid(), 'coins', 1000000, 'free money');
  raise exception 'FAIL: a player gave themselves coins';
exception when insufficient_privilege then raise notice 'PASS: players can''t give themselves coins';
end $$;
do $$ begin
  insert into public.wallets (user_id, coins) values (auth.uid(), 999);
  raise exception 'FAIL: a player wrote their wallet';
exception when insufficient_privilege then raise notice 'PASS: players can''t write their wallet';
end $$;
select pg_temp.ok((public.wallet() ->> 'coins')::int = 0, 'a player reads their own (empty) wallet');
select pg_temp.ok((select count(*) from public.house_settings) >= 6, 'members read the house settings');
reset role;
set role anon;
do $$ begin
  perform public.admin_login('x', 'y');
  raise exception 'FAIL: anon called admin_login';
exception when insufficient_privilege then raise notice 'PASS: strangers can''t call admin_login';
end $$;
reset role;

-- ---- Setup, login, lockout (as the server) ----
set role service_role;
select pg_temp.ok(public.admin_count() = 0, 'no admins yet');
select pg_temp.ok((public.admin_setup('diesel', 'short') ->> 'ok')::boolean = false, 'setup refuses a short password');
select pg_temp.ok((public.admin_setup('Bad Name!', 'a-long-enough-password') ->> 'ok')::boolean = false, 'setup refuses a bad username');
select pg_temp.ok((public.admin_setup('Diesel', 'correct horse battery') ->> 'ok')::boolean, 'first admin is set up');
select pg_temp.ok((public.admin_setup('second', 'another long password') ->> 'ok')::boolean = false, 'setup only works once');
select pg_temp.ok(not exists (select 1 from public.admin_accounts where pw_hash like '%horse%'), 'the password isn''t stored as text');
select pg_temp.ok((public.admin_login('diesel', 'wrong password!', '1.1.1.1') ->> 'ok')::boolean = false, 'a wrong password is refused');
create temp table t (token text);
grant all on t to service_role;
insert into t select public.admin_login('DIESEL', 'correct horse battery', '1.1.1.1', 'test') ->> 'token';
select pg_temp.ok(length((select token from t)) = 64, 'the right password gives a session token');
select pg_temp.ok(not exists (select 1 from public.admin_sessions s, t where s.token_hash = t.token), 'only a hash of the token is stored');
select pg_temp.ok(public.admin_me((select token from t)) ->> 'username' = 'diesel', 'the token signs you in');
do $$ begin
  perform public.admin_me('not-a-token');
  raise exception 'FAIL: a made-up token worked';
exception when sqlstate '28000' then raise notice 'PASS: a made-up token is refused';
end $$;
-- Five wrong passwords lock the username, even with the right one after.
select public.admin_login('diesel', 'nope nope nope', '2.2.2.' || i) from generate_series(1, 5) i;
select pg_temp.ok(public.admin_login('diesel', 'correct horse battery', '3.3.3.3') ->> 'why' like 'Too many tries%', 'five wrong passwords lock the account for a while');
delete from public.admin_login_attempts;

-- ---- Players ----
select pg_temp.ok((public.admin_member_update((select token from t), '00000000-0000-0000-0000-0000000000a1', '{"name": "Ashley", "level": 40}') ->> 'ok')::boolean, 'admin renames a player and sets level 40');
select pg_temp.ok((select level from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 40 and (select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'Ashley', 'name and level are saved');
select pg_temp.ok((public.admin_member_update((select token from t), '00000000-0000-0000-0000-0000000000a1', '{"xp": 5000000}') ->> 'ok')::boolean, 'no cap on XP for pro players');
select pg_temp.ok((select xp from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 5000000, 'XP 5,000,000 is saved');
select pg_temp.ok(exists (select 1 from public.xp_ledger where user_id = '00000000-0000-0000-0000-0000000000a1' and reason = 'admin:diesel'), 'XP changes are in the XP history');
select pg_temp.ok((public.admin_wallet((select token from t), '00000000-0000-0000-0000-0000000000a1', 'coins', 2500, 'prize') ->> 'balance')::int = 2500, 'admin gives 2500 coins');
select pg_temp.ok((public.admin_wallet((select token from t), '00000000-0000-0000-0000-0000000000a1', 'gems', 40) ->> 'balance')::int = 40, 'admin gives 40 gems');
select pg_temp.ok((public.admin_wallet((select token from t), '00000000-0000-0000-0000-0000000000a1', 'coins', -9999) ->> 'ok')::boolean = false, 'coins never go below zero');
select pg_temp.ok((select count(*) from public.ledger where user_id = '00000000-0000-0000-0000-0000000000a1') = 2, 'every coin and gem change is in the ledger');
select pg_temp.ok(jsonb_array_length(public.admin_members((select token from t))) >= 1, 'admin lists the players');
select pg_temp.ok(jsonb_array_length(public.admin_member_history((select token from t), '00000000-0000-0000-0000-0000000000a1') -> 'money') = 2, 'a player''s history shows their coins and gems');
select pg_temp.ok((public.admin_ban((select token from t), '00000000-0000-0000-0000-0000000000a1', 'testing') ->> 'ok')::boolean, 'admin bans a player');
reset role;
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'adm@members.diesel-house.invalid');
select pg_temp.ok(not public.is_member(), 'a banned player is no longer a member');
reset role;
set role service_role;
select public.admin_ban((select token from t), '00000000-0000-0000-0000-0000000000a1', null, false);
reset role;
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'adm@members.diesel-house.invalid');
select pg_temp.ok(public.is_member(), 'unbanned, they''re a member again');
reset role;

-- ---- House settings, critters, logs, audit ----
set role service_role;
select pg_temp.ok((public.admin_setting_set((select token from t), 'animals', '{"enabled": false, "rooms_off": []}') ->> 'ok')::boolean, 'admin switches the animals off');
select pg_temp.ok((public.admin_setting_set((select token from t), 'something_else', '{}') ->> 'ok')::boolean = false, 'unknown settings are refused');
select pg_temp.ok((public.admin_settings((select token from t)) -> 'animals' ->> 'enabled')::boolean = false, 'the setting is saved');
select pg_temp.ok(jsonb_typeof(public.admin_critters((select token from t)) -> 'critters') = 'array', 'admin lists critters and challenges');
select pg_temp.ok(jsonb_typeof(public.admin_overview((select token from t))) = 'object', 'the dashboard loads');
select pg_temp.ok(jsonb_typeof(public.admin_logs((select token from t))) = 'array', 'device logs load');
select pg_temp.ok((select count(*) from public.admin_audit where username = 'diesel') >= 6, 'every change is in the audit log');
-- Changing the password ends other sessions.
insert into t select public.admin_login('diesel', 'correct horse battery') ->> 'token';
select pg_temp.ok((public.admin_change_password((select token from t limit 1), 'correct horse battery', 'a brand new passphrase') ->> 'ok')::boolean, 'admin changes their password');
do $$ begin
  perform public.admin_me((select token from t offset 1 limit 1));
  raise exception 'FAIL: the other session still works';
exception when sqlstate '28000' then raise notice 'PASS: changing the password signs out other sessions';
end $$;
select public.admin_logout((select token from t limit 1));
do $$ begin
  perform public.admin_me((select token from t limit 1));
  raise exception 'FAIL: signed-out token still works';
exception when sqlstate '28000' then raise notice 'PASS: signing out ends the session';
end $$;
reset role;
