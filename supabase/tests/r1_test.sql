-- REDESIGN.md R1 checks (20261030_shared_rooms.sql) on a local Postgres (supabase/tests/run.sh). Runs after
-- every migration, so the old room_0N rooms are already retired (R3): the checks use the new rooms.
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
-- Can this person send on this Realtime topic? (The policy's check, as Realtime runs it.)
create or replace function pg_temp.can_send(topic text) returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', topic, false);
  insert into realtime.messages (topic, extension, payload, event, private) values (topic, 'broadcast', '{}', 'x', true);
  return true;
exception when insufficient_privilege then return false;
end $$;
set client_min_messages = notice;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'r1a@members.diesel-house.invalid'), ('00000000-0000-0000-0000-0000000000a2', 'stranger@example.invalid')
  on conflict do nothing;
insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-0000000000a3', true) on conflict do nothing;
insert into public.allowed_emails (email) values ('r1a@members.diesel-house.invalid') on conflict do nothing;
insert into public.guest_admissions (user_id, expires_at) values ('00000000-0000-0000-0000-0000000000a3', now() + interval '12 hours') on conflict do nothing;
insert into public.rooms (id, name) values ('test_room', 'Test room');
grant insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;

select pg_temp.ok((select count(*) = 7 from public.rooms where id in ('garden', 'rooftop', 'library', 'disco', 'gaming', 'cafe', 'lounge')), 'the 7 themed rooms are seeded');
do $$ begin
  insert into public.rooms (id, name) values ('Bad Room!', 'x');
  raise exception 'FAIL: odd room id accepted';
exception when check_violation then raise notice 'PASS: room ids must be short and lowercase';
end $$;

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'r1a@members.diesel-house.invalid');
select pg_temp.ok(public.can_enter_room('library') and public.can_enter_room('garden') and public.can_enter_room('test_room'), 'a member can enter the rooms and a room added later');
select pg_temp.ok(not public.can_enter_room('nowhere'), 'a room that isn''t in the table can''t be entered');
select pg_temp.ok(pg_temp.can_send('voice:test_room') and pg_temp.can_send('game:garden') and pg_temp.can_send('house') and pg_temp.can_send('voice:hallway'), 'Realtime: voice / game channels for any room in the table, plus house and hallway');
select pg_temp.ok(not pg_temp.can_send('voice:nowhere') and not pg_temp.can_send('chat:garden'), 'Realtime: unknown rooms and other topics are refused');

-- Do not disturb
select public.set_dnd('lounge', true);
select pg_temp.ok((select dnd and dnd_set_by = auth.uid() and dnd_at is not null from public.rooms where id = 'lounge'), 'a member can turn on do not disturb');
select public.set_dnd('lounge', false);
select pg_temp.ok((select not dnd and dnd_set_by is null from public.rooms where id = 'lounge'), 'and off again');
do $$ begin
  update public.rooms set name = 'Mine now' where id = 'gaming';
  if found then raise exception 'FAIL: renamed a room directly'; end if;
  raise notice 'PASS: rooms can''t be renamed directly (no owners)';
end $$;

-- Room rules
select public.set_room_rules('gaming', array['dice', 'wyr'], array['Tea|Coffee']);
select pg_temp.ok((select games = array['dice', 'wyr'] and prompts = array['Tea|Coffee'] from public.rooms where id = 'gaming'), 'any member can set a room''s games and prompts');
select pg_temp.ok((select count(*) = 1 and bool_and(user_id = auth.uid()) from public.room_changes where room_id = 'gaming'), 'the change is logged with who made it');
do $$ begin
  perform public.set_room_rules('gaming', array['chess'], null);
  raise exception 'FAIL: unknown game accepted';
exception when check_violation then raise notice 'PASS: unknown games are refused';
end $$;

-- Error reports
select public.report_error('TypeError: x is undefined', 'at f (main.js:1:2)', '/', 'Safari', 'main-abc');
do $$ begin
  perform count(*) from public.client_errors;
  raise exception 'FAIL: a member read the error reports';
exception when insufficient_privilege then raise notice 'PASS: members can''t read error reports';
end $$;
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(message = 'TypeError: x is undefined') from public.client_errors where user_id = '00000000-0000-0000-0000-0000000000a1'), 'an error report is stored');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'r1a@members.diesel-house.invalid');
select public.report_error('again ' || i) from generate_series(1, 30) i;
reset role;
select pg_temp.ok((select count(*) = 20 from public.client_errors where user_id = '00000000-0000-0000-0000-0000000000a1'), 'at most 20 error reports an hour per person');

-- Guests and strangers
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a3', null, true);
select pg_temp.ok(public.can_enter_room('disco'), 'a guest can enter rooms');
do $$ begin
  perform public.set_room_rules('gaming', null, null);
  raise exception 'FAIL: a guest changed the rules';
exception when raise_exception then raise notice 'PASS: guests can''t change room rules';
end $$;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a2', 'stranger@example.invalid');
select pg_temp.ok(not public.can_enter_room('disco') and not pg_temp.can_send('voice:disco') and not pg_temp.can_send('house'), 'someone not in the house can''t enter a room or use any channel');
do $$ begin
  perform public.set_dnd('disco', true);
  raise exception 'FAIL: a stranger set do not disturb';
exception when raise_exception then raise notice 'PASS: strangers can''t set do not disturb';
end $$;
select public.report_error('spam');
reset role;
select pg_temp.ok((select count(*) = 0 from public.client_errors where user_id = '00000000-0000-0000-0000-0000000000a2'), 'strangers can''t send error reports');

-- Retiring a room closes it.
update public.rooms set active = false where id = 'test_room';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000a1', 'r1a@members.diesel-house.invalid');
select pg_temp.ok(not public.can_enter_room('test_room') and not pg_temp.can_send('voice:test_room'), 'a retired room can''t be entered');
reset role;
