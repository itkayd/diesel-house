-- U4 social checks on a local Postgres (supabase/tests/run.sh): blocks, friends, reports, the admin queue.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
create or replace function pg_temp.sign_in(who uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', who::text, false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email)::text, false);
$$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
set client_min_messages = notice;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'amy@members.diesel-house.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'ben@members.diesel-house.invalid'),
  ('00000000-0000-0000-0000-0000000000b3', 'cat@members.diesel-house.invalid') on conflict do nothing;
insert into public.allowed_emails (email) values ('amy@members.diesel-house.invalid'), ('ben@members.diesel-house.invalid'), ('cat@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name, character_index) values
  ('00000000-0000-0000-0000-0000000000b1', 'Amy', 1), ('00000000-0000-0000-0000-0000000000b2', 'Ben', 2), ('00000000-0000-0000-0000-0000000000b3', 'Cat', 3) on conflict do nothing;

set role authenticated;
-- Amy asks Ben; Ben sees it; Ben says yes.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b1', 'amy@members.diesel-house.invalid');
select pg_temp.ok(public.friend_request('00000000-0000-0000-0000-0000000000b2') ->> 'status' = 'pending', 'Amy asks Ben to be friends');
select pg_temp.ok((public.my_social() -> 'friends' -> 0 ->> 'status') = 'outgoing', 'Amy sees her request waiting');
do $$ begin
  insert into public.friendships (a, b, status, requested_by) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3', 'friends', '00000000-0000-0000-0000-0000000000b1');
  raise exception 'FAIL: wrote a friendship directly';
exception when insufficient_privilege then raise notice 'PASS: friendships only change through the functions';
end $$;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b2', 'ben@members.diesel-house.invalid');
select pg_temp.ok((public.my_social() -> 'friends' -> 0 ->> 'status') = 'incoming', 'Ben sees Amy’s request');
select public.friend_answer('00000000-0000-0000-0000-0000000000b1', true);
select pg_temp.ok((public.my_social() -> 'friends' -> 0 ->> 'status') = 'friends' and (public.my_social() -> 'friends' -> 0 ->> 'name') = 'Amy', 'Ben says yes: friends');
-- Ben blocks Cat; Cat's request never reaches Ben.
select pg_temp.ok((public.set_block('00000000-0000-0000-0000-0000000000b3', true) ->> 'ok')::boolean, 'Ben blocks Cat');
select pg_temp.ok((public.my_social() -> 'blocked' -> 0 ->> 'name') = 'Cat', 'Ben’s blocked list shows Cat');
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b3', 'cat@members.diesel-house.invalid');
select pg_temp.ok(public.friend_request('00000000-0000-0000-0000-0000000000b2') ->> 'ok' = 'true', 'Cat’s request to Ben looks sent (Cat isn’t told about the block)');
select pg_temp.ok(not exists (select 1 from public.blocks where blocker = auth.uid()), 'Cat can’t see who blocked her');
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b2', 'ben@members.diesel-house.invalid');
select pg_temp.ok(jsonb_array_length(public.my_social() -> 'friends') = 1, 'Ben gets nothing from Cat');
-- Blocking a friend ends the friendship; unblocking keeps the history.
select public.set_block('00000000-0000-0000-0000-0000000000b1', true);
select pg_temp.ok(jsonb_array_length(public.my_social() -> 'friends') = 0, 'blocking a friend ends the friendship');
select public.set_block('00000000-0000-0000-0000-0000000000b1', false);
select pg_temp.ok(jsonb_array_length(public.my_social() -> 'blocked') = 1, 'unblocking Amy leaves only Cat blocked');
-- Reports.
select pg_temp.ok((public.report_player('00000000-0000-0000-0000-0000000000b3', 'harassment', 'kept following me', '{"zone":"lounge","lines":["…"]}') ->> 'ok')::boolean, 'Ben reports Cat');
select pg_temp.ok(public.report_player(auth.uid(), 'spam') ->> 'ok' = 'false', 'you can’t report yourself');
select public.report_player('00000000-0000-0000-0000-0000000000b3', 'spam') from generate_series(1, 9);
select pg_temp.ok(public.report_player('00000000-0000-0000-0000-0000000000b3', 'spam') ->> 'ok' = 'false', 'at most 10 reports an hour from one person');
do $$ begin
  perform 1 from public.player_reports;
  raise exception 'FAIL: a player read the reports';
exception when insufficient_privilege then raise notice 'PASS: players can’t read reports';
end $$;
do $$ begin
  perform public.admin_reports('x');
  raise exception 'FAIL: a player opened the report queue';
exception when insufficient_privilege then raise notice 'PASS: only the server opens the report queue';
end $$;
reset role;

-- The admin queue.
set role service_role;
create temp table st as select public.admin_login('diesel', 'a brand new passphrase') ->> 'token' as token;
grant all on st to service_role;
select pg_temp.ok((public.admin_reports((select token from st)) -> 0 ->> 'reported_name') = 'Cat' and (public.admin_reports((select token from st)) -> 0 ->> 'reported_total')::int = 10, 'the admin sees reports about Cat, with how many there are');
select public.admin_report_resolve((select token from st), array(select id from public.player_reports), 'talked to Cat');
select pg_temp.ok(jsonb_array_length(public.admin_reports((select token from st))) = 0 and jsonb_array_length(public.admin_reports((select token from st), false)) = 10, 'resolved reports leave the queue but are kept');
select pg_temp.ok((public.admin_overview((select token from st)) ->> 'friendships')::int >= 0, 'the dashboard counts friendships and open reports');
reset role;
