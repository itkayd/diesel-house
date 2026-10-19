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
