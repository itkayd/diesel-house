-- Critter checks (supabase/tests/run.sh), after phase14_test.sql has made Ann and Ben.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
create or replace function pg_temp.sign_in(who uuid, email text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email, 'is_anonymous', anon)::text, false);
$$;

-- The schedule: about 75% of slots have a critter, in roughly the right mix.
create temp table sched as select s, public.critter_for_slot(s) c from generate_series(14000000::bigint, 14020000) s;
select pg_temp.ok((select count(c)::float / count(*) between 0.72 and 0.78 from sched), 'about 3 in 4 slots have a critter');
select pg_temp.ok((select count(*) filter (where c = 'cat')::float / count(c) between 0.21 and 0.27 from sched)
  and (select count(*) filter (where c = 'medal')::float / count(c) between 0.01 and 0.035 from sched), 'cats common (24%), lost medals rare (2%)');
-- For the browser to compare against (tests/e2e/critters.mjs prints the same list).
select string_agg(coalesce(public.critter_for_slot(s), '-'), ',' order by s) as first_slots from generate_series(14600000::bigint, 14600039) s \gset
\echo SCHEDULE :first_slots
select string_agg(coalesce(public.critter_at(14600000 + (i / 4), i % 4), '-'), ',' order by i) as multi from generate_series(0, 39) i \gset
\echo MULTI :multi

-- Find slots with and without a critter near a pretend "now".
select min(s) as with_critter from sched where c is not null and s > 14010000 \gset
select min(s) as no_critter from sched where c is null and s > 14010000 \gset
select min(s) as another from sched where c is not null and s > :with_critter + 5 \gset

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-00000000000b', 'b@members.diesel-house.invalid');
select set_config('dh.test_slot', :'with_critter', false);
select set_config('t.xp0', (select xp::text from public.profiles where id = auth.uid()), false);
select set_config('t.r', public.catch_critter(:with_critter)::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'ok')::boolean
  and (select xp - current_setting('t.xp0')::bigint = (current_setting('t.r')::jsonb ->> 'xp')::int from public.profiles where id = auth.uid()), 'Ben catches it and gets its XP');
select pg_temp.ok((current_setting('t.r')::jsonb -> 'progress' ->> 'gained')::int >= (current_setting('t.r')::jsonb ->> 'xp')::int
  and (current_setting('t.r')::jsonb -> 'progress' -> 'challenges') is not null, 'the answer includes the progress picture (as record_events)');
select pg_temp.ok((select progress = 1 from public.challenge_progress where user_id = auth.uid() and challenge_id in ('d_catch', 'w_catch') limit 1) is not false, 'catching moves the catch challenges on (when picked)');

select pg_temp.sign_in('00000000-0000-0000-0000-00000000000a', 'a@members.diesel-house.invalid');
select set_config('t.r', public.catch_critter(:with_critter)::text, false);
select pg_temp.ok(current_setting('t.r')::jsonb ->> 'why' = 'taken' and current_setting('t.r')::jsonb ->> 'by' = '00000000-0000-0000-0000-00000000000b', 'Ann is too late: Ben got it first');
-- Several critters in one slot (20261029): number 1 is a different catch from number 0.
select set_config('t.r', public.catch_critter_at(:with_critter, 1)::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'ok')::boolean, 'Ann catches the second critter of the same slot');
select pg_temp.ok(public.catch_critter_at(:with_critter, 1) ->> 'why' = 'taken', '... and only once');
select pg_temp.ok(public.catch_critter_at(:with_critter, 9) ->> 'why' = 'nothing', 'there''s no critter number 9');
select pg_temp.ok(public.catch_critter(:no_critter) ->> 'why' in ('nothing', 'gone'), 'nothing to catch in an empty slot');
select pg_temp.ok(public.catch_critter(:with_critter - 10) ->> 'why' = 'gone', 'an old critter can''t be caught');
select pg_temp.ok(public.catch_critter(:with_critter + 1) ->> 'why' = 'gone', 'a future one can''t either');

-- A browser can't record 'caught' itself.
select set_config('t.n', (select coalesce(sum(n), 0)::text from public.user_tallies where user_id = auth.uid() and kind = 'caught'), false);
select public.record_events('[{"k":"caught","u":"cat"},{"k":"caught","u":"cat"}]');
select pg_temp.ok((select coalesce(sum(n), 0) from public.user_tallies where user_id = auth.uid() and kind = 'caught') = current_setting('t.n')::bigint, 'a browser can''t report catches itself');

-- 25 a day at most.
reset role;
insert into public.critter_catches (slot, critter, user_id, xp) select 13000000 + g, 'cat', '00000000-0000-0000-0000-00000000000a', 5 from generate_series(1, 25) g;
set role authenticated;
select set_config('dh.test_slot', :'another', false);
select pg_temp.ok(public.catch_critter(:another) ->> 'why' = 'enough', 'no more than 25 catches a day');

-- Today's catches board.
select pg_temp.ok((select count(*) = 2 from public.catch_board()) and (select caught = 26 from public.catch_board() where display_name = 'Ann'), 'Today''s catches lists who caught how many and the XP');

-- Guests watch but don't catch.
select pg_temp.sign_in('00000000-0000-0000-0000-00000000000c', null, true);
do $$ begin
  perform public.catch_critter(1);
  raise exception 'FAIL: a guest caught a critter';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: guests can''t catch (%)', sqlerrm;
end $$;
reset role;
