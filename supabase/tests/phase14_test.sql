-- Phase 14 checks on a local Postgres (supabase/tests/run.sh). Each check raises if it fails.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
-- Sign in as someone (or nobody): what PostgREST does with the JWT.
create or replace function pg_temp.sign_in(who uuid, email text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'email', email, 'is_anonymous', anon)::text, false);
$$;
set client_min_messages = notice;

-- Levels (LEVELS.md §1 table and edge cases).
select pg_temp.ok(public.level_for_xp(x) = l, format('level_for_xp(%s) = %s', x, l))
from (values (0,1),(99,1),(100,2),(299,2),(300,3),(1000,5),(4500,10),(10500,15),(19000,20),(20999,20),(21000,21),(22999,21),(23000,22),(39000,30),(79000,50),(179000,100),(10000000,5010)) v(x,l);
select pg_temp.ok(public.xp_for_level(l) = x, format('xp_for_level(%s) = %s', l, x))
from (values (1,0),(2,100),(5,1000),(10,4500),(20,19000),(21,21000),(30,39000),(100,179000)) v(l,x);
select pg_temp.ok(bool_and(public.level_for_xp(public.xp_for_level(l)) = l and public.level_for_xp(public.xp_for_level(l) - 1) = l - 1), 'every level boundary 2..6000 lands exactly')
from generate_series(2, 6000) l;

-- People: two members and a guest.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@members.diesel-house.invalid'), ('00000000-0000-0000-0000-00000000000b', 'b@members.diesel-house.invalid');
insert into auth.users (id, is_anonymous) values ('00000000-0000-0000-0000-00000000000c', true);
insert into public.allowed_emails (email) values ('a@members.diesel-house.invalid'), ('b@members.diesel-house.invalid');
insert into public.profiles (id, display_name) values ('00000000-0000-0000-0000-00000000000a', 'Ann'), ('00000000-0000-0000-0000-00000000000b', 'Ben');

set role authenticated;
select pg_temp.sign_in('00000000-0000-0000-0000-00000000000a', 'a@members.diesel-house.invalid');

-- Nobody can write their own XP.
update public.profiles set xp = 999999, level = 99, streak_days = 50 where id = auth.uid();
select pg_temp.ok((select xp = 0 and level = 1 and streak_days = 0 from public.profiles where id = auth.uid()), 'a member can''t set their own xp / level / streak');
do $$ begin
  insert into public.xp_ledger (user_id, amount, reason) values (auth.uid(), 1000, 'cheat');
  raise exception 'FAIL: wrote xp_ledger directly';
exception when insufficient_privilege then raise notice 'PASS: xp_ledger can''t be written directly';
end $$;
do $$ begin
  insert into public.user_medals (user_id, medal_id) values (auth.uid(), 'host');
  raise exception 'FAIL: wrote user_medals directly';
exception when insufficient_privilege then raise notice 'PASS: user_medals can''t be written directly';
end $$;

-- First visit: streak 1, the Visitor rank medal, 3 + 3 challenges, Dubai time.
select set_config('t.r', public.record_events('[]', 'Asia/Dubai')::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'streak')::int = 1, 'first visit: a 1-day streak');
select pg_temp.ok(jsonb_array_length(current_setting('t.r')::jsonb -> 'challenges') = 6
  and (select count(*) from jsonb_array_elements(current_setting('t.r')::jsonb -> 'challenges') c where c ->> 'period' = 'day') = 3, 'a fresh account gets 3 daily + 3 weekly challenges');
select pg_temp.ok(current_setting('t.r')::jsonb ->> 'day' = 'd:' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM-DD'), 'the day is the person''s own (Asia/Dubai)');
select pg_temp.ok(exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'rank_visitor'), 'everyone gets the Visitor rank medal');
select pg_temp.ok((select array_agg(c ->> 'id' order by c ->> 'id') from jsonb_array_elements(public.record_events('[]') -> 'challenges') c)
  = (select array_agg(c ->> 'id' order by c ->> 'id') from jsonb_array_elements(current_setting('t.r')::jsonb -> 'challenges') c), 'the same 6 challenges on a second call');

-- Caps: 80 emotes count as 50.
select public.record_events((select jsonb_agg(jsonb_build_object('k', 'emote_sent', 'u', 'friend' || (i % 4))) from generate_series(1, 80) i));
select pg_temp.ok((select n = 50 from public.user_tallies where user_id = auth.uid() and kind = 'emote_sent' and scope like 'd:%'), 'emotes are capped at 50 a day');
select pg_temp.ok(exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'social'), 'emotes to 3 different friends: Social butterfly');

-- A challenge completes once and pays once, however often its event comes again.
reset role;
create temp table want as
  select c.* from public.active_challenges('00000000-0000-0000-0000-00000000000a',
    'd:' || to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM-DD'),
    'w:' || to_char((now() at time zone 'Asia/Dubai')::date, 'IYYY-"W"IW')) c
  where c.kind not in ('first_in', 'streak', 'emote_sent') limit 1;
grant select on want to authenticated;
set role authenticated;
select set_config('t.xp0', (select xp::text from public.profiles where id = auth.uid()), false);
select set_config('t.r', public.record_events((select jsonb_agg(jsonb_build_object('k', w.kind, 'u', 'thing' || i, 'n', 1)) from want w, generate_series(1, 10) i)) ::text, false);
select pg_temp.ok(exists (select 1 from jsonb_array_elements(current_setting('t.r')::jsonb -> 'completed') c where c ->> 'id' = (select id from want)), 'sending its events completes a challenge: ' || (select id from want));
select pg_temp.ok((select count(*) = 1 from public.xp_ledger where user_id = auth.uid() and reason = 'challenge:' || (select id from want)), 'its XP is in the ledger once');
select public.record_events((select jsonb_agg(jsonb_build_object('k', w.kind, 'u', 'more' || i)) from want w, generate_series(1, 10) i));
select public.record_events('[]');
select pg_temp.ok((select count(*) = 1 from public.xp_ledger where user_id = auth.uid() and reason = 'challenge:' || (select id from want)), 'more events and a refresh don''t pay it again');
select pg_temp.ok((select p.xp = (select sum(amount) from public.xp_ledger l where l.user_id = p.id) from public.profiles p where p.id = auth.uid()), 'profile xp = the sum of the ledger');

-- Party host: exactly 150 XP, once.
select set_config('t.xp0', (select xp::text from public.profiles where id = auth.uid()), false);
select public.record_events('[{"k":"party"}]');
select public.record_events('[{"k":"party"}]');
select pg_temp.ok((select xp - current_setting('t.xp0')::bigint = 150 from public.profiles where id = auth.uid())
  and (select count(*) = 1 from public.xp_ledger where user_id = auth.uid() and reason = 'medal:host'), 'Party host adds exactly 150 XP once');

-- Unknown kinds and silly amounts are ignored / clamped.
select public.record_events('[{"k":"give_me_xp","n":100000},{"k":"voice_min","n":100000}]');
select pg_temp.ok((select n = 60 from public.user_tallies where user_id = auth.uid() and kind = 'voice_min' and scope like 'd:%')
  and not exists (select 1 from public.user_tallies where user_id = auth.uid() and kind = 'give_me_xp'), 'unknown events are ignored, big amounts clamped');

-- Crossing level 30: Keyholder exactly once (rank medals give no XP).
reset role;
update public.profiles set xp = 39000 where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('t.r', public.record_events('[]')::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'level')::int = 30
  and exists (select 1 from jsonb_array_elements(current_setting('t.r')::jsonb -> 'new_medals') m where m ->> 'id' = 'rank_keyholder'), 'reaching level 30 gives Keyholder');
select set_config('t.r', public.record_events('[]')::text, false);
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(current_setting('t.r')::jsonb -> 'new_medals') m where m ->> 'id' = 'rank_keyholder')
  and (select count(*) = 1 from public.user_medals where user_id = auth.uid() and medal_id = 'rank_keyholder'), '... and only once');

-- No max level: 10,000,000 XP is level 5,010 with the Legend medal.
reset role;
update public.profiles set xp = 10000000 where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('t.r', public.record_events('[]')::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'level')::int = 5010 and exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'rank_legend'), '10,000,000 XP: level 5,010 and Legend');

-- Streak: yesterday (their time) → 2 days; a gap → back to 1; 7 days → Slow & steady.
reset role;
update public.profiles set last_visit_date = (now() at time zone 'Asia/Dubai')::date - 1, streak_days = 6 where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('t.r', public.record_events('[]')::text, false);
select pg_temp.ok((current_setting('t.r')::jsonb ->> 'streak')::int = 7 and exists (select 1 from public.user_medals where user_id = auth.uid() and medal_id = 'steady'), 'visiting the next day (Dubai) carries the streak on; 7 days: Slow & steady');
reset role;
update public.profiles set last_visit_date = (now() at time zone 'Asia/Dubai')::date - 3 where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select pg_temp.ok((public.record_events('[]') ->> 'streak')::int = 1, 'missing days starts the streak again');

-- The board: both members, this week's XP. Ben hasn't played.
select pg_temp.ok((select count(*) = 2 from public.weekly_board()) and (select xp_week > 0 from public.weekly_board() where display_name = 'Ann'), 'the noticeboard lists members with this week''s XP');

-- Guests: no XP, no board.
select pg_temp.sign_in('00000000-0000-0000-0000-00000000000c', null, true);
do $$ begin
  perform public.record_events('[]');
  raise exception 'FAIL: a guest earned XP';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: guests can''t earn XP (%)', sqlerrm;
end $$;
do $$ begin
  perform public.weekly_board();
  raise exception 'FAIL: a guest read the board';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS: guests can''t read the board';
end $$;
reset role;
