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
