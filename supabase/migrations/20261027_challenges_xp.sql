-- UPDATE.md Phase 14 + LEVELS.md: challenges, XP, levels (no max level), streaks, medals, weekly board.
--
-- Everything is awarded on the server, in record_events(): the browser only reports what happened
-- (entered a room, sent an emote, won a game…), batched every 30 s. Each kind of event has a daily cap,
-- so nobody can farm XP from the console, and every reward is given once (completed_at / primary keys).
-- Nobody writes these tables or the profile's xp/level/streak columns directly.
--
--  profiles          + xp (bigint), level, streak_days, best_streak, last_visit_date, time_zone
--  challenge_defs    the challenge pool (3 daily + 3 weekly picked per person, stable for the day/week)
--  challenge_progress  per person, challenge and period ('d:2026-10-17' / 'w:2026-W42', in their time zone)
--  user_tallies      event counts per day (for the caps) and for all time (for medals)
--  user_medals       achievement and rank medals, once each
--  xp_ledger         every XP award (reason 'challenge:<id>' or 'medal:<id>'); the weekly board sums it
--  house_days        who was first in the house each (UTC) day
--
-- Days roll over at midnight in each person's own time zone (sent by the browser, checked against
-- pg_timezone_names). Weeks for weekly challenges are ISO weeks in their time zone; the shared weekly
-- leaderboard uses the ISO week in UTC (Monday 00:00 UTC).

-- ---- Levels (LEVELS.md §1): 100, 200 … 2,000 XP per level up to 21, then 2,000 each, forever ----------
create or replace function public.xp_for_level(level int)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when level <= 21 then 50::bigint * (level - 1) * level else 21000 + 2000::bigint * (level - 21) end;
$$;

create or replace function public.level_for_xp(xp bigint)
returns int
language sql
immutable
set search_path = ''
as $$
  with guess as (
    select case
      when xp <= 0 then 1
      when xp < 21000 then floor((1 + sqrt(1 + 0.08 * xp::double precision)) / 2)::int
      else 21 + ((xp - 21000) / 2000)::int
    end as l
  )
  -- Correct the square root's rounding at the exact boundaries.
  select case
    when public.xp_for_level(l + 1) <= greatest(xp, 0) then l + 1
    when l > 1 and public.xp_for_level(l) > greatest(xp, 0) then l - 1
    else l
  end
  from guess;
$$;

-- ---- Profiles: progress columns, written only by record_events() ---------------------------------------
alter table public.profiles
  add column xp bigint not null default 0,
  add column level int not null default 1,
  add column streak_days int not null default 0,
  add column best_streak int not null default 0,
  add column last_visit_date date,
  add column time_zone text;

-- Members can still update their own profile (name, character), but not these columns: whatever a
-- browser sends for them is ignored. record_events() runs as the table owner, so it isn't affected.
create or replace function public.profiles_keep_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.xp := 0; new.level := 1; new.streak_days := 0; new.best_streak := 0; new.last_visit_date := null; new.time_zone := null;
  else
    new.xp := old.xp; new.level := old.level; new.streak_days := old.streak_days; new.best_streak := old.best_streak;
    new.last_visit_date := old.last_visit_date; new.time_zone := old.time_zone;
  end if;
  return new;
end;
$$;
create trigger profiles_keep_progress before insert or update on public.profiles
  for each row execute function public.profiles_keep_progress();

-- ---- The challenge pool (UPDATE.md §5). Titles and icons for the screen are in src/challenges/pool.ts. ----
create table public.challenge_defs (
  id text primary key,
  period text not null check (period in ('day', 'week')),
  title text not null,
  kind text not null, -- the event that moves it on ('first_in' and 'streak' are worked out here)
  goal int not null check (goal > 0),
  xp int not null check (xp > 0),
  uniq boolean not null default false -- count different things (rooms, games), not times
);
alter table public.challenge_defs enable row level security;
create policy "members read challenges" on public.challenge_defs for select to authenticated using ((select public.is_member()));

insert into public.challenge_defs (id, period, title, kind, goal, xp, uniq) values
  ('d_hi_rooms', 'day', 'Say hi in 3 different room chats', 'chat_sent', 3, 30, true),
  ('d_voice', 'day', 'Spend 15 minutes in voice with 2+ friends', 'voice_min_group', 15, 40, false),
  ('d_rps', 'day', 'Win a rock-paper-scissors duel', 'rps_won', 1, 25, false),
  ('d_walkie', 'day', 'Use the walkie-talkie 3 times', 'walkie_used', 3, 20, false),
  ('d_emotes', 'day', 'Send 5 emotes', 'emote_sent', 5, 15, false),
  ('d_react', 'day', 'React to 5 chat messages', 'reaction_sent', 5, 15, false),
  ('d_first', 'day', 'Be the first friend in the house today', 'first_in', 1, 40, false),
  ('d_knock', 'day', 'Knock on a door and get let in', 'knock_admitted', 1, 25, false),
  ('d_game', 'day', 'Play any mini-game', 'game_played', 1, 30, false),
  ('d_whisper', 'day', 'Whisper to someone in the hallway', 'whisper_used', 1, 20, false),
  ('w_rooms', 'week', 'Visit every room', 'room_enter', 8, 150, true),
  ('w_wins', 'week', 'Win 5 games', 'game_won', 5, 150, false),
  ('w_voice', 'week', 'Spend 2 hours in voice', 'voice_min', 120, 200, false),
  ('w_host4', 'week', 'Host a game with 4 or more players', 'host_game_4', 1, 100, false),
  ('w_all_games', 'week', 'Play all 6 mini-games', 'game_played', 6, 200, true),
  ('w_streak', 'week', 'Keep a 4-day streak', 'streak', 4, 120, false),
  ('w_guest', 'week', 'Welcome a guest a friend invited', 'guest_met', 1, 80, false),
  ('w_qd', 'week', 'Win Quick Draw with a reaction under 250 ms', 'qd_fast', 1, 100, false);

-- Each person's 3 daily and 3 weekly challenges: a shuffle seeded by who they are and the day/week, so
-- it's the same all day on every device.
create or replace function public.active_challenges(who uuid, day_key text, week_key text)
returns setof public.challenge_defs
language sql
stable
set search_path = ''
as $$
  (select d.* from public.challenge_defs d where d.period = 'day' order by md5(who::text || day_key || d.id) limit 3)
  union all
  (select d.* from public.challenge_defs d where d.period = 'week' order by md5(who::text || week_key || d.id) limit 3);
$$;
revoke all on function public.active_challenges(uuid, text, text) from public, anon, authenticated;

create table public.challenge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null references public.challenge_defs(id) on delete cascade,
  period_key text not null,
  progress int not null default 0,
  seen text[] not null default '{}',
  completed_at timestamptz,
  primary key (user_id, challenge_id, period_key)
);
create index challenge_progress_challenge_idx on public.challenge_progress (challenge_id);
alter table public.challenge_progress enable row level security;
create policy "read own challenge progress" on public.challenge_progress for select to authenticated using (user_id = (select auth.uid()));

create table public.user_tallies (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null, -- 'd:<local date>' for the daily caps, 'all' for medals
  kind text not null,
  n bigint not null default 0,
  seen text[] not null default '{}',
  primary key (user_id, scope, kind)
);
alter table public.user_tallies enable row level security;
create policy "read own tallies" on public.user_tallies for select to authenticated using (user_id = (select auth.uid()));

create table public.user_medals (
  user_id uuid not null references auth.users(id) on delete cascade,
  medal_id text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, medal_id)
);
alter table public.user_medals enable row level security;
create policy "members read medals" on public.user_medals for select to authenticated using ((select public.is_member()));

create table public.xp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index xp_ledger_user_idx on public.xp_ledger (user_id, created_at);
create index xp_ledger_created_idx on public.xp_ledger (created_at);
alter table public.xp_ledger enable row level security;
create policy "read own xp" on public.xp_ledger for select to authenticated using (user_id = (select auth.uid()));

create table public.house_days (
  day date primary key,
  first_user uuid references auth.users(id) on delete set null
);
create index house_days_first_user_idx on public.house_days (first_user);
alter table public.house_days enable row level security;
-- No policies: record_events() only.

-- Nobody writes any of these directly (no insert/update/delete policies); take away the grants too.
revoke insert, update, delete on public.challenge_defs, public.challenge_progress, public.user_tallies, public.user_medals, public.xp_ledger, public.house_days from anon, authenticated;

-- ---- Daily caps per kind of event. `internal`: only the server itself may record it (e.g. 'caught',
-- recorded by catch_critter() in 20261028_critters.sql), never a browser. ------------------------------
create table public.event_caps (
  kind text primary key,
  cap int not null check (cap > 0),
  internal boolean not null default false
);
alter table public.event_caps enable row level security;
-- No policies: read by record_events() only.
insert into public.event_caps (kind, cap) values
  ('room_enter', 200), ('chat_sent', 200), ('voice_min', 300), ('voice_min_group', 300), ('rps_won', 30),
  ('walkie_used', 60), ('emote_sent', 50), ('reaction_sent', 100), ('knock', 30), ('knock_admitted', 20),
  ('game_played', 60), ('game_won', 60), ('whisper_used', 60), ('host_game_4', 20), ('qd_fast', 10),
  ('qd_round_won', 30), ('double_six', 10), ('party', 10), ('guest_met', 20);
revoke insert, update, delete on public.event_caps from anon, authenticated;

-- ---- record_events: the only way XP, streaks, challenges and medals change -----------------------------
-- (Split into small helpers that only record_events() can use, so each piece is easy to read and apply.)

-- One challenge moves on by `amount` (or to `set_to`, for the streak / first in the house; or by one new
-- `about` for the "different things" ones). Returns {id, title, xp} the moment it's completed, else null.
create or replace function public.bump_challenge(uid uuid, c public.challenge_defs, pkey text, amount int, about text, set_to int default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
#variable_conflict use_variable
declare
  pr public.challenge_progress;
  prog int;
begin
  insert into public.challenge_progress (user_id, challenge_id, period_key) values (uid, c.id, pkey) on conflict do nothing;
  select * into pr from public.challenge_progress where user_id = uid and challenge_id = c.id and period_key = pkey for update;
  if pr.completed_at is not null then
    return null;
  end if;
  if set_to is not null then
    if set_to <= pr.progress then
      return null;
    end if;
    prog := set_to;
  elsif c.uniq then
    if about is null or about = any (pr.seen) then
      return null;
    end if;
    pr.seen := pr.seen || about;
    prog := cardinality(pr.seen);
  else
    prog := pr.progress + amount;
  end if;
  update public.challenge_progress
    set progress = least(prog, c.goal), seen = pr.seen, completed_at = case when prog >= c.goal then now() end
    where user_id = uid and challenge_id = c.id and period_key = pkey;
  if prog < c.goal then
    return null;
  end if;
  insert into public.xp_ledger (user_id, amount, reason) values (uid, c.xp, 'challenge:' || c.id);
  return jsonb_build_object('id', c.id, 'title', c.title, 'xp', c.xp);
end;
$$;

-- Achievement medals (LEVELS.md §7.3) earned and not yet given: id and their one-off XP.
create or replace function public.medals_due(uid uuid, local_now timestamp, streak int)
returns table (id text, xp int)
language sql
stable
set search_path = ''
as $$
  with t as (select kind, n, seen from public.user_tallies where user_id = uid and scope = 'all')
  select v.id, v.xp from (values
    ('decor', 25, exists (select 1 from public.rooms r where r.owner_id = uid and r.name <> 'Empty room')),
    ('first_knock', 25, exists (select 1 from t where kind = 'knock' and n >= 1)),
    ('social', 50, exists (select 1 from t where kind = 'emote_sent' and cardinality(seen) >= 3)),
    ('over_out', 50, exists (select 1 from t where kind = 'walkie_used' and n >= 3)),
    ('night_owl', 50, extract(hour from local_now) < 5),
    ('high_roller', 75, exists (select 1 from t where kind = 'double_six' and n >= 1)),
    ('fast_hand', 75, exists (select 1 from t where kind = 'qd_round_won' and n >= 1)),
    ('duelist', 100, exists (select 1 from t where kind = 'rps_won' and n >= 3)),
    ('host', 150, exists (select 1 from t where kind = 'party' and n >= 1)),
    ('steady', 200, streak >= 7)
  ) as v(id, xp, earned)
  where v.earned and not exists (select 1 from public.user_medals um where um.user_id = uid and um.medal_id = v.id);
$$;

-- Where someone stands, for the screen: XP, level, streak, medals, their 6 challenges, this week's XP.
create or replace function public.progress_json(uid uuid, day_key text, week_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'xp', p.xp,
    'level', p.level,
    'streak', p.streak_days,
    'best_streak', p.best_streak,
    'day', day_key,
    'week', week_key,
    'medals', coalesce((select jsonb_agg(jsonb_build_object('id', um.medal_id, 'at', um.earned_at) order by um.earned_at) from public.user_medals um where um.user_id = uid), '[]'),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'period', a.period, 'title', a.title, 'goal', a.goal, 'xp', a.xp,
        'progress', coalesce(cp.progress, 0), 'done', cp.completed_at is not null
      ) order by a.period, a.id)
      from public.active_challenges(uid, day_key, week_key) a
      left join public.challenge_progress cp
        on cp.user_id = uid and cp.challenge_id = a.id and cp.period_key = case a.period when 'day' then day_key else week_key end
    ), '[]'),
    'week_xp', coalesce((select sum(l.amount) from public.xp_ledger l where l.user_id = uid and l.created_at >= date_trunc('week', now() at time zone 'UTC') at time zone 'UTC'), 0)
  )
  from public.profiles p where p.id = uid;
$$;
-- The day's first visitor tidies away rows older than 90 days (totals stay on profiles). Kept separate:
-- record_events() works without it (it skips the tidy-up until this exists).
create or replace function public.tidy_progress(utc_day date)
returns void
language sql
set search_path = ''
as $$
  delete from public.xp_ledger where created_at < now() - interval '90 days';
  delete from public.user_tallies where scope like 'd:%' and scope < 'd:' || to_char(utc_day - 90, 'YYYY-MM-DD');
  delete from public.challenge_progress where period_key like 'd:%' and period_key < 'd:' || to_char(utc_day - 90, 'YYYY-MM-DD');
  delete from public.house_days where day < utc_day - 90;
$$;
revoke all on function public.tidy_progress(date) from public, anon, authenticated;
revoke all on function public.bump_challenge(uuid, public.challenge_defs, text, int, text, int) from public, anon, authenticated;
revoke all on function public.medals_due(uuid, timestamp, int) from public, anon, authenticated;
revoke all on function public.progress_json(uuid, text, text) from public, anon, authenticated;

-- events: [{ "k": kind, "n": amount (default 1), "u": what it was about (a room, a friend, a game) }, …]
-- tz: the browser's IANA time zone (e.g. 'Asia/Dubai'), remembered on the profile.
-- An empty list still counts as a visit (streak, first in the house) and returns everything for the screen.
create or replace function public.record_events(events jsonb default '[]', tz text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  p public.profiles;
  local_now timestamp;
  today date;
  day_key text;
  week_key text;
  utc_day date := (now() at time zone 'UTC')::date;
  streak int;
  first_in boolean;
  e jsonb;
  k text;
  amount int;
  about text;
  cap int;
  internal boolean;
  used bigint;
  c public.challenge_defs;
  got jsonb;
  gained bigint := 0;
  level_after int;
  done jsonb := '[]';
  medals jsonb := '[]';
  m record;
  trusted boolean := coalesce(current_setting('dh.internal', true), '') = 'on'; -- set by the server's own functions
begin
  if uid is null or not (select public.is_member()) then
    raise exception 'members only';
  end if;
  if jsonb_typeof(coalesce(events, '[]')) <> 'array' or jsonb_array_length(coalesce(events, '[]')) > 300 then
    raise exception 'bad events';
  end if;
  if tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    update public.profiles set time_zone = tz where id = uid;
  end if;
  select * into p from public.profiles where id = uid for update;
  if not found then
    raise exception 'no profile';
  end if;
  local_now := now() at time zone coalesce(p.time_zone, 'UTC');
  today := local_now::date;
  day_key := 'd:' || to_char(today, 'YYYY-MM-DD');
  week_key := 'w:' || to_char(today, 'IYYY-"W"IW');

  -- A visit: the streak goes on if you were here yesterday (your time), else starts again.
  streak := p.streak_days;
  if p.last_visit_date is distinct from today then
    streak := case when p.last_visit_date = today - 1 then p.streak_days + 1 else 1 end;
    update public.profiles set streak_days = streak, best_streak = greatest(best_streak, streak), last_visit_date = today where id = uid;
  end if;

  -- First in the house today (UTC). The day's first visitor also tidies up old rows.
  insert into public.house_days (day, first_user) values (utc_day, uid) on conflict (day) do nothing;
  if found and to_regprocedure('public.tidy_progress(date)') is not null then
    perform public.tidy_progress(utc_day);
  end if;
  first_in := exists (select 1 from public.house_days where day = utc_day and first_user = uid);

  -- The events, clamped to each kind's daily cap.
  for e in select value from jsonb_array_elements(coalesce(events, '[]')) loop
    k := e ->> 'k';
    select ec.cap, ec.internal into cap, internal from public.event_caps ec where ec.kind = k;
    continue when cap is null or (internal and not trusted);
    amount := greatest(1, least(60, coalesce((e ->> 'n')::int, 1)));
    about := nullif(left(e ->> 'u', 64), '');
    insert into public.user_tallies (user_id, scope, kind) values (uid, day_key, k) on conflict do nothing;
    select n into used from public.user_tallies where user_id = uid and scope = day_key and kind = k for update;
    amount := least(amount, cap - used)::int;
    continue when amount <= 0;
    update public.user_tallies set n = n + amount where user_id = uid and scope = day_key and kind = k;
    insert into public.user_tallies (user_id, scope, kind, n, seen)
      values (uid, 'all', k, amount, case when about is null then '{}' else array[about] end)
      on conflict (user_id, scope, kind) do update
        set n = public.user_tallies.n + amount,
            seen = case when about is null or about = any (public.user_tallies.seen) or cardinality(public.user_tallies.seen) >= 50
                        then public.user_tallies.seen else public.user_tallies.seen || about end;
    for c in select * from public.active_challenges(uid, day_key, week_key) a where a.kind = k loop
      got := public.bump_challenge(uid, c, case c.period when 'day' then day_key else week_key end, amount, about);
      if got is not null then
        gained := gained + c.xp;
        done := done || got;
      end if;
    end loop;
  end loop;

  -- Challenges worked out here: first in the house, and the streak.
  for c in select * from public.active_challenges(uid, day_key, week_key) a where a.kind in ('first_in', 'streak') loop
    continue when (case c.kind when 'first_in' then (case when first_in then 1 else 0 end) else streak end) <= 0;
    got := public.bump_challenge(uid, c, case c.period when 'day' then day_key else week_key end, 0, null,
      case c.kind when 'first_in' then 1 else streak end);
    if got is not null then
      gained := gained + c.xp;
      done := done || got;
    end if;
  end loop;

  -- Achievement medals: first time only, each with a one-off XP bonus.
  for m in select * from public.medals_due(uid, local_now, streak) loop
    insert into public.user_medals (user_id, medal_id) values (uid, m.id) on conflict do nothing;
    if found then
      insert into public.xp_ledger (user_id, amount, reason) values (uid, m.xp, 'medal:' || m.id);
      gained := gained + m.xp;
      medals := medals || jsonb_build_object('id', m.id, 'xp', m.xp);
    end if;
  end loop;

  -- XP and level (no cap), then rank medals for every rank reached (no XP: they come from XP).
  update public.profiles set xp = xp + gained, level = public.level_for_xp(xp + gained) where id = uid returning level into level_after;
  for m in
    select v.id from (values ('rank_visitor', 1), ('rank_housemate', 10), ('rank_regular', 20), ('rank_keyholder', 30), ('rank_landlord', 40), ('rank_legend', 50)) as v(id, lv)
    where level_after >= v.lv
  loop
    insert into public.user_medals (user_id, medal_id) values (uid, m.id) on conflict do nothing;
    if found then
      medals := medals || jsonb_build_object('id', m.id, 'xp', 0);
    end if;
  end loop;

  return public.progress_json(uid, day_key, week_key)
    || jsonb_build_object('level_before', p.level, 'gained', gained, 'completed', done, 'new_medals', medals);
end;
$$;
revoke all on function public.record_events(jsonb, text) from public, anon;
grant execute on function public.record_events(jsonb, text) to authenticated;

-- ---- The noticeboard: this week's XP (UTC ISO week), games won, streaks. Members only. ------------------
create or replace function public.weekly_board()
returns table (user_id uuid, display_name text, character_index smallint, level int, xp_week bigint, wins_week bigint, streak int, best_streak int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
begin
  if not (select public.is_member()) then
    raise exception 'members only';
  end if;
  return query
    select pr.id, pr.display_name, pr.character_index, pr.level,
      coalesce((select sum(l.amount) from public.xp_ledger l where l.user_id = pr.id and l.created_at >= since), 0)::bigint,
      (select count(*) from public.game_results g where pr.id = any (g.winner_ids) and g.created_at >= since),
      pr.streak_days, pr.best_streak
    from public.profiles pr
    join auth.users u on u.id = pr.id
    join public.allowed_emails a on a.email = lower(u.email)
    order by 5 desc, pr.level desc, pr.display_name;
end;
$$;
revoke all on function public.weekly_board() from public, anon;
grant execute on function public.weekly_board() to authenticated;
