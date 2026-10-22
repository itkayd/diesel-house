-- R4 checks on a local Postgres (supabase/tests/run.sh): the old owner schema is gone; skins by key.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
set client_min_messages = notice;

select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rooms' and column_name in ('owner_id', 'door_state', 'mood')), 'rooms has no owner, door or mood columns');
select pg_temp.ok(to_regclass('public.room_passes') is null, 'room_passes is gone');
select pg_temp.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'guest_codes' and column_name = 'owner_id'), 'invite codes keep their owner');

-- ---- Characters by key (20261103) ----
create or replace function pg_temp.sign_in(who uuid, email text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email, 'is_anonymous', anon)::text, false);
$$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid') on conflict do nothing;
insert into public.allowed_emails (email) values ('r4@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name, character_index) values ('00000000-0000-0000-0000-0000000000f1', 'Kai', 18) on conflict do nothing;
select pg_temp.ok((select character_key from public.profiles where id = '00000000-0000-0000-0000-0000000000f1') = 'ninja.woman', 'an old character number becomes its starter (18 → ninja.woman)');
select pg_temp.ok(public.character_from_index(i) = any (public.starter_characters()), format('old character %s maps to a starter', i)) from generate_series(0, 19) i;

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
update public.profiles set character_key = 'ninja.princess' where id = auth.uid();
select pg_temp.ok((select character_key from public.profiles where id = auth.uid()) = 'ninja.princess', 'a member can wear a starter');
do $$ begin
  update public.profiles set character_key = 'ninja.knightgold' where id = auth.uid();
  raise exception 'FAIL: wore a shop character';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a shop character can''t be worn yet (%)', sqlerrm;
end $$;
update public.profiles set character_index = 9 where id = auth.uid();
select pg_temp.ok((select character_key from public.profiles where id = auth.uid()) = 'ninja.oldman', 'an older copy of the game writing a number still gets a starter');
insert into public.messages (room_id, text) values ('lounge', 'hello');
select pg_temp.ok((select author_skin from public.messages where author_id = auth.uid() order by id desc limit 1) = 'ninja.oldman', 'chat messages carry the author''s character');
select pg_temp.ok((select public.character_from_index(character_index) from public.weekly_board() where user_id = auth.uid()) = 'ninja.oldman', 'the weekly board''s character number maps back to the key');
reset role;

-- ---- Pets (20261104) ----
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
do $$ begin
  update public.profiles set pet = 'cat' where id = auth.uid();
  raise exception 'FAIL: a level 1 member got a pet';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: pets wait for level 3 (%)', sqlerrm;
end $$;
do $$ begin
  update public.profiles set pet = 'cat', level = 9 where id = auth.uid();
  raise exception 'FAIL: raised own level to get a pet';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: can''t raise your own level to get a pet (%)', sqlerrm;
end $$;
reset role;
update public.profiles set level = 3 where id = '00000000-0000-0000-0000-0000000000f1';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
update public.profiles set pet = 'hamster' where id = auth.uid();
select pg_temp.ok((select pet from public.profiles where id = auth.uid()) = 'hamster', 'at level 3 a member can have a free pet');
do $$ begin
  update public.profiles set pet = 'horse' where id = auth.uid();
  raise exception 'FAIL: got a shop pet';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: shop pets wait for the shop (%)', sqlerrm;
end $$;
update public.profiles set pet = null where id = auth.uid();
select pg_temp.ok((select pet from public.profiles where id = auth.uid()) is null, 'a pet can be sent home (none)');
reset role;

-- ---- Disco jukebox (20261105) ----
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
select public.set_room_music('disco', 'sun_tribe');
select pg_temp.ok((select music from public.rooms where id = 'disco') = 'sun_tribe' and (select music_at from public.rooms where id = 'disco') is not null, 'anyone in the house can start a track in the Disco');
do $$ begin
  perform public.set_room_music('disco', 'ghost_town');
  raise exception 'FAIL: changed track twice in a row';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: no flipping tracks faster than every 2 s (%)', sqlerrm;
end $$;
do $$ begin
  perform public.set_room_music('lounge', 'sun_tribe');
  raise exception 'FAIL: jukebox outside the Disco';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only the Disco has a jukebox (%)', sqlerrm;
end $$;
reset role;
update public.rooms set music_at = now() - interval '1 minute' where id = 'disco';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
do $$ begin
  perform public.set_room_music('disco', 'not_a_track');
  raise exception 'FAIL: played an unknown track';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only known tracks (%)', sqlerrm;
end $$;
select public.set_room_music('disco', null);
select pg_temp.ok((select music from public.rooms where id = 'disco') is null, 'the music can be stopped');
reset role;

-- ---- Watch together (20261106) ----
reset role;
update public.rooms set music_at = null, music = null where id = 'disco';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
select public.set_room_media('lounge', 'youtube', 'dQw4w9WgXcQ', 12, false);
select pg_temp.ok((select media_kind = 'youtube' and media_id = 'dQw4w9WgXcQ' and media_pos = 12 and not media_paused and media_at is not null from public.rooms where id = 'lounge'), 'a YouTube video goes on in the Lounge, at 12 s');
do $$ begin
  perform public.set_room_media('lounge', 'youtube', 'dQw4w9WgXcQ', 13, true);
  raise exception 'FAIL: two changes at the same moment';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: two taps at the same moment: the first wins (%)', sqlerrm;
end $$;
reset role;
update public.rooms set media_at = now() - interval '1 minute' where id = 'lounge';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
select public.set_room_media('lounge', 'youtube', 'dQw4w9WgXcQ', 70, true);
select pg_temp.ok((select media_paused and media_pos = 70 from public.rooms where id = 'lounge'), 'pausing keeps where it was');
do $$ begin
  perform public.set_room_media('cafe', 'youtube', 'dQw4w9WgXcQ', 0, false);
  raise exception 'FAIL: a screen in the Café';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only the Lounge and the Disco have a screen (%)', sqlerrm;
end $$;
do $$ begin
  perform public.set_room_media('disco', 'youtube', 'not a video id', 0, false);
  raise exception 'FAIL: a junk video id';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only real-looking YouTube / Spotify ids (%)', sqlerrm;
end $$;
select public.set_room_music('disco', 'sun_tribe');
select public.set_room_media('disco', 'spotify', 'track:4cOdK2wGLETKBW3PvgPWqT', 0, false);
select pg_temp.ok((select music is null and media_kind = 'spotify' from public.rooms where id = 'disco'), 'a Spotify track in the Disco stops the jukebox');
reset role;
update public.rooms set media_at = now() - interval '1 minute' where id = 'lounge';
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
select public.set_room_media('lounge', null, null, null, false);
select pg_temp.ok((select media_kind is null and media_id is null and media_at is null from public.rooms where id = 'lounge'), 'stop clears the screen');
reset role;

-- ---- Arcade (20261107, replay-checked since 20261113) ----
-- A run: the player starts it (gets a seed), the server records its verdict after replaying it.
create or replace function pg_temp.arcade_run(who uuid, email text, score int, ok boolean default true) returns jsonb language plpgsql as $$
declare run uuid; r jsonb;
begin
  execute 'set role authenticated';
  perform pg_temp.sign_in(who, email);
  run := (public.arcade_start('nightraid') ->> 'run')::uuid;
  execute 'reset role';
  execute 'set role service_role';
  r := public.arcade_record(run, score, score, 2, 3600, 61000, ok, case when ok then null else 'replay mismatch' end);
  execute 'reset role';
  return r;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid');
do $$ begin
  perform public.submit_arcade('nightraid', 1000, 3, 60000);
  raise exception 'FAIL: a phone sent its own score';
exception when insufficient_privilege then raise notice 'PASS: phones can''t send a score themselves any more';
end $$;
do $$ begin
  perform public.arcade_record(gen_random_uuid(), 1, 1, 1, 1, 1, true);
  raise exception 'FAIL: a phone recorded a verdict';
exception when insufficient_privilege then raise notice 'PASS: only the server records a verdict';
end $$;
select pg_temp.ok((public.arcade_start('nightraid') ->> 'seed')::bigint between 0 and 2147483647, 'a run starts with a random seed');
reset role;
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid', 999999, false) ->> 'why') = 'rejected', 'a run whose replay doesn''t match is rejected');
select pg_temp.ok((select count(*) from public.arcade_scores where user_id = '00000000-0000-0000-0000-0000000000f1') = 0, 'a rejected run saves nothing');
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid', 1200) ->> 'xp')::int = 150, 'the first real score is a house record: 150 XP');
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid', 5000000) ->> 'ok')::boolean, 'no cap on scores: a pro''s 5,000,000 is kept when the replay proves it');
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f1', 'r4@members.diesel-house.invalid', 900) ->> 'xp')::int = 0, 'a score below your best pays nothing');
set role service_role;
select pg_temp.ok((public.arcade_record((select id from public.arcade_runs where status = 'verified' limit 1), 1, 1, 1, 1, 1, true) ->> 'why') = 'used', 'a run id works once');
reset role;
delete from public.arcade_scores where score = 5000000;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid') on conflict do nothing;
insert into public.allowed_emails (email) values ('r4b@members.diesel-house.invalid') on conflict do nothing;
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000f2', 'Ana') on conflict do nothing;
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid', 800) ->> 'xp')::int = 50, 'someone else''s first best (not a record) pays 50 XP: more than any critter');
set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid');
select pg_temp.ok((select count(*) from public.arcade_board('nightraid')) = 2 and (select record from public.arcade_board('nightraid') where best = 1200), 'the board lists this week''s bests and marks the house record');
reset role;
select pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid', 850);
select pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid', 870);
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid', 880) ->> 'xp')::int = 0, 'at most 3 paid bests a day');
select pg_temp.ok((select sum(amount) from public.xp_ledger where user_id = '00000000-0000-0000-0000-0000000000f2' and reason like 'arcade:%') = 150, 'arcade XP adds up: 3 × 50 (challenge XP from playing is separate)');
select pg_temp.ok((pg_temp.arcade_run('00000000-0000-0000-0000-0000000000f2', 'r4b@members.diesel-house.invalid', 100) -> 'progress' ->> 'level') is not null, 'a recorded run counts for challenges as that player');
