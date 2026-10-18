-- REDESIGN.md R3 checks (20261031_octagon_house.sql) on a local Postgres (supabase/tests/run.sh).
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

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'r3@members.diesel-house.invalid'), ('00000000-0000-0000-0000-0000000000d2', 'r3b@members.diesel-house.invalid') on conflict do nothing;
insert into public.allowed_emails (email) values ('r3@members.diesel-house.invalid'), ('r3b@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000d1', 'Ria'), ('00000000-0000-0000-0000-0000000000d2', 'Rob') on conflict do nothing;
-- Something said in an old room before it was retired.
insert into public.messages (room_id, author_id, text) values ('room_04', '00000000-0000-0000-0000-0000000000d1', 'see you in the new house');

select pg_temp.ok((select count(*) = 8 and bool_and(not active) from public.rooms where id ~ '^room_0[1-8]$'), 'the 8 old rooms are retired');
select pg_temp.ok((select count(*) = 7 and bool_and(active) from public.rooms where id in ('garden', 'rooftop', 'library', 'disco', 'gaming', 'cafe', 'lounge')), 'the 7 rooms are open');
select pg_temp.ok((select title = 'Dance in the Disco for 2 minutes' and kind = 'dance_min' and goal = 2 and not uniq from public.challenge_defs where id = 'd_knock'), 'd_knock is now the dance challenge');
select pg_temp.ok((select title = 'Visit all 7 rooms' and goal = 7 and uniq from public.challenge_defs where id = 'w_rooms'), 'w_rooms is now "Visit all 7 rooms"');

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000d1', 'r3@members.diesel-house.invalid');
select pg_temp.ok(not public.can_enter_room('room_04'), 'an old room can''t be entered');
select pg_temp.ok((select count(*) = 1 from public.messages where room_id = 'room_04'), 'members can still read an old room''s chat');
do $$ begin
  insert into public.messages (room_id, author_id, text) values ('room_04', auth.uid(), 'hello?');
  raise exception 'FAIL: posted in a retired room';
exception when insufficient_privilege then raise notice 'PASS: nobody can post in an old room';
end $$;

-- Dance machine: 2 dance minutes.
select public.record_events('[{"k":"dance_min"}]'::jsonb, 'Europe/London');
select pg_temp.ok(not exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'first_knock'), 'one dance minute is not enough');
select public.record_events('[{"k":"dance_min"}]'::jsonb, 'Europe/London');
select pg_temp.ok(exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'first_knock'), 'two dance minutes: Dance machine');

-- House tour: all 7 rooms (old rooms don't count, and aren't needed).
select public.record_events('[{"k":"room_enter","u":"garden"},{"k":"room_enter","u":"library"},{"k":"room_enter","u":"disco"},{"k":"room_enter","u":"gaming"},{"k":"room_enter","u":"cafe"},{"k":"room_enter","u":"lounge"},{"k":"room_enter","u":"room_01"}]'::jsonb, 'Europe/London');
select pg_temp.ok(not exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'decor'), '6 of the 7 rooms: not yet');
select public.record_events('[{"k":"room_enter","u":"rooftop"}]'::jsonb, 'Europe/London');
select pg_temp.ok(exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'decor'), 'all 7 rooms: House tour');

-- Someone with no room visits at all doesn't get House tour.
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000d2', 'r3b@members.diesel-house.invalid');
select public.record_events('[]'::jsonb, 'Europe/London');
select pg_temp.ok(not exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'decor'), 'no rooms visited: no House tour');
reset role;
