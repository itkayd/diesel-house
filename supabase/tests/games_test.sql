-- 20261101_more_games.sql checks on a local Postgres (supabase/tests/run.sh).
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
set client_min_messages = notice;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'g1@members.diesel-house.invalid') on conflict do nothing;
insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000e2', true) on conflict do nothing;
insert into public.allowed_emails (email) values ('g1@members.diesel-house.invalid') on conflict do nothing;
insert into public.guest_admissions (user_id, expires_at) values ('00000000-0000-0000-0000-0000000000e2', now() + interval '12 hours') on conflict do nothing;

set role authenticated;
-- A guest hosts a quiz with a member: the member's game and win are kept.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000e2', null, true);
select public.record_game('quiz', 'gaming', array['00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1']::uuid[], array['00000000-0000-0000-0000-0000000000e1']::uuid[], '{}');
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(players = array['00000000-0000-0000-0000-0000000000e1']::uuid[] and winner_ids = players) from public.game_results where game = 'quiz'), 'a guest host saves the members'' result (guest left out)');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000e2', null, true);
select pg_temp.ok(public.record_game('sketch', 'gaming', array['00000000-0000-0000-0000-0000000000e2']::uuid[], '{}', '{}') is null, 'a guest alone saves nothing (no member played)');

-- New games are allowed; the limit is per game.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000e1', 'g1@members.diesel-house.invalid');
select public.record_game('liars', 'lounge', array['00000000-0000-0000-0000-0000000000e1']::uuid[], '{}', '{}');
select public.record_game('letters', 'lounge', array['00000000-0000-0000-0000-0000000000e1']::uuid[], '{}', '{}');
do $$ begin
  perform public.record_game('letters', 'lounge', array['00000000-0000-0000-0000-0000000000e1']::uuid[], '{}', '{}');
  raise exception 'FAIL: two results for the same game at once';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: one result per host and game every 2 s (another game right after is fine)';
end $$;
select public.set_room_rules('gaming', array['quiz', 'sketch', 'liars', 'letters'], null);
select pg_temp.ok((select games = array['quiz', 'sketch', 'liars', 'letters'] from public.rooms where id = 'gaming'), 'a room can switch on the new games');
reset role;
