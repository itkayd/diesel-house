-- Profiles and private messages (20261116) on a local Postgres (supabase/tests/run.sh). Uses Amy, Ben and
-- Cat from social_test.sql (Ben has blocked Cat there).
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

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b1', 'amy@members.diesel-house.invalid');
select pg_temp.ok(public.player_profile('00000000-0000-0000-0000-0000000000b2') ->> 'name' = 'Ben' and (public.player_profile('00000000-0000-0000-0000-0000000000b2') ->> 'member')::boolean, 'Amy opens Ben’s profile');
select pg_temp.ok(public.player_profile('00000000-0000-0000-0000-0000000000b2') ? 'medals' and public.player_profile('00000000-0000-0000-0000-0000000000b2') ? 'arcade_best', 'a profile has medals and stats');
-- Amy messages Ben.
select pg_temp.ok((public.send_dm('00000000-0000-0000-0000-0000000000b2', 'hey Ben') ->> 'ok')::boolean, 'Amy sends Ben a message');
select pg_temp.ok(public.send_dm('00000000-0000-0000-0000-0000000000b2', '   ') ->> 'ok' = 'false', 'an empty message isn’t sent');
select pg_temp.ok(length((select text from public.direct_messages where sender = auth.uid() order by id desc limit 1)) <= 500, 'messages are at most 500 characters');
do $$ begin
  insert into public.direct_messages (sender, recipient, text) values (auth.uid(), '00000000-0000-0000-0000-0000000000b2', 'sneaky');
  raise exception 'FAIL: wrote a message directly';
exception when insufficient_privilege then raise notice 'PASS: messages only go through send_dm (limits apply)';
end $$;
select public.send_dm('00000000-0000-0000-0000-0000000000b2', 'msg ' || i) from generate_series(1, 19) i;
select pg_temp.ok(public.send_dm('00000000-0000-0000-0000-0000000000b2', 'one too many') ->> 'ok' = 'false', 'at most 20 a minute');
-- Ben reads them.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b2', 'ben@members.diesel-house.invalid');
select pg_temp.ok(public.dm_unread() = 20, 'Ben has 20 unread');
select pg_temp.ok((public.dm_threads() -> 0 ->> 'name') = 'Amy' and (public.dm_threads() -> 0 ->> 'unread')::int = 20, 'Ben’s inbox: Amy, 20 unread');
select pg_temp.ok(jsonb_array_length(public.dm_history('00000000-0000-0000-0000-0000000000b1')) = 20 and public.dm_history('00000000-0000-0000-0000-0000000000b1') -> 0 ->> 'text' = 'hey Ben', 'the conversation, oldest first');
select public.dm_read('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok(public.dm_unread() = 0, 'opening it marks it read');
-- Cat (blocked by Ben) can't reach Ben, and isn't told.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b3', 'cat@members.diesel-house.invalid');
select pg_temp.ok((public.send_dm('00000000-0000-0000-0000-0000000000b2', 'hi?') ->> 'ok')::boolean, 'Cat’s message looks sent');
select pg_temp.ok(not exists (select 1 from public.direct_messages where sender = auth.uid()), 'but Ben never gets it');
select pg_temp.ok(not exists (select 1 from public.direct_messages where sender <> auth.uid() and recipient <> auth.uid()) and (select count(*) from public.direct_messages) = 0, 'Cat can’t read anyone else’s messages');
-- Ben can't message Cat while she's blocked.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000b2', 'ben@members.diesel-house.invalid');
select pg_temp.ok(public.send_dm('00000000-0000-0000-0000-0000000000b3', 'hi') ->> 'why' like 'You blocked them%', 'you can’t message someone you blocked');
select pg_temp.ok((public.player_profile('00000000-0000-0000-0000-0000000000b3') ->> 'blocked')::boolean, 'their profile says you blocked them');
reset role;
