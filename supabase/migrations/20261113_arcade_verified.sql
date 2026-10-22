-- Night Raid scores are proven, not guessed (22 Oct 2026). No more "believable score" limits: pro players
-- can score anything the game allows. Instead every run is checked by playing it again on the server.
--
--  1. Starting a run, the game asks the database for a run id and a random seed (arcade_start). The seed
--     decides every wave, dive and drop, so the run can't be planned in advance.
--  2. The game records what you did (your moves and Ults, tick by tick; it runs at a fixed 60 steps a second).
--  3. At game over the phone sends the record to /api/arcade. The server plays the same game with the same
--     seed and the same moves (src/games/nightRaidGame.ts, the same code the phone runs) and gets the score
--     itself. Only that score is saved (arcade_record, server only). If it doesn't match what the phone
--     claimed, or the run was played faster than real time (a sped-up game), the run is rejected and shows
--     on the admin page as "not possible".
--  4. Each run id works once.

create table if not exists public.arcade_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('nightraid')),
  seed bigint not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'started' check (status in ('started', 'verified', 'rejected')),
  claimed int,          -- the score the phone said
  score int,            -- the score the server's replay got
  waves int,
  ticks int,            -- game steps (60 a second)
  real_ms int,          -- real time from start to the record arriving
  reason text,          -- why it was rejected
  flags jsonb,          -- notes for the admin page (e.g. a very fast clear)
  score_id bigint
);
create index if not exists arcade_runs_user_idx on public.arcade_runs (user_id, started_at desc);
create index if not exists arcade_runs_status_idx on public.arcade_runs (status, finished_at desc);
alter table public.arcade_runs enable row level security;
revoke all on public.arcade_runs from anon, authenticated;

-- Start a run (members; guests play without saving).
create or replace function public.arcade_start(game text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  run public.arcade_runs;
begin
  if uid is null or not (select public.is_member()) then
    return jsonb_build_object('ok', false, 'why', 'guest');
  end if;
  if game is distinct from 'nightraid' then
    raise exception 'no such game';
  end if;
  -- Not a score limit: just stops one account filling the table (a game takes longer than this anyway).
  if (select count(*) from public.arcade_runs r where r.user_id = uid and r.started_at > now() - interval '10 minutes') >= 40 then
    return jsonb_build_object('ok', false, 'why', 'busy');
  end if;
  insert into public.arcade_runs (user_id, game, seed)
    values (uid, game, ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647)
    returning * into run;
  return jsonb_build_object('ok', true, 'run', run.id, 'seed', run.seed);
end;
$$;
revoke all on function public.arcade_start(text) from public, anon;
grant execute on function public.arcade_start(text) to authenticated;

-- The server's verdict on a run (service role only; /api/arcade calls it after replaying the run).
create or replace function public.arcade_record(run uuid, claimed int, score int, waves int, ticks int, real_ms int, ok boolean, reason text default null, flags jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  r public.arcade_runs;
  uid uuid;
  prev int;
  record_before int;
  xp int := 0;
  paid int;
  level_before int;
  sid bigint;
  p jsonb;
  utc_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  select * into r from public.arcade_runs a where a.id = run for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'why', 'no_run');
  end if;
  if r.status <> 'started' then
    return jsonb_build_object('ok', false, 'why', 'used');
  end if;
  uid := r.user_id;
  if not ok then
    update public.arcade_runs a set status = 'rejected', finished_at = now(), claimed = arcade_record.claimed, score = arcade_record.score,
      waves = arcade_record.waves, ticks = arcade_record.ticks, real_ms = arcade_record.real_ms, reason = arcade_record.reason, flags = arcade_record.flags
      where a.id = run;
    return jsonb_build_object('ok', false, 'why', 'rejected');
  end if;

  select max(s.score) into prev from public.arcade_scores s where s.user_id = uid and s.game = r.game;
  select max(s.score) into record_before from public.arcade_scores s where s.game = r.game;
  if score >= 300 and score > coalesce(prev, 0) then
    select count(*) into paid from public.xp_ledger l where l.user_id = uid and l.reason like 'arcade:%' and l.created_at >= utc_today;
    if paid < 3 then
      xp := case when score > coalesce(record_before, 0) then 150 else 50 end;
    end if;
  end if;
  insert into public.arcade_scores (user_id, game, score, waves, duration_ms, xp) values (uid, r.game, score, waves, ticks * 1000 / 60, xp) returning id into sid;
  update public.arcade_runs a set status = 'verified', finished_at = now(), claimed = arcade_record.claimed, score = arcade_record.score,
    waves = arcade_record.waves, ticks = arcade_record.ticks, real_ms = arcade_record.real_ms, flags = arcade_record.flags, score_id = sid
    where a.id = run;

  select pr.level into level_before from public.profiles pr where pr.id = uid;
  if xp > 0 then
    insert into public.xp_ledger (user_id, amount, reason) values (uid, xp, 'arcade:' || r.game || case when xp > 50 then ':record' else ':best' end);
    update public.profiles pr set xp = pr.xp + xp, level = public.level_for_xp(pr.xp + xp) where pr.id = uid;
  end if;
  -- Challenges and medals, as that player (record_events works for "whoever is signed in").
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'email', (select u.email from auth.users u where u.id = uid), 'role', 'authenticated')::text, true);
  perform set_config('dh.internal', 'on', true);
  p := public.record_events(jsonb_build_array(jsonb_build_object('k', 'game_played', 'u', r.game), jsonb_build_object('k', 'arcade_played', 'u', r.game)), null);
  perform set_config('dh.internal', '', true);
  p := p || jsonb_build_object('level_before', level_before, 'gained', coalesce((p ->> 'gained')::int, 0) + xp);
  return jsonb_build_object(
    'ok', true, 'score', score, 'previous', prev, 'best', greatest(coalesce(prev, 0), score),
    'new_best', score > coalesce(prev, 0), 'record', score > coalesce(record_before, 0),
    'house_best', greatest(coalesce(record_before, 0), score), 'xp', xp, 'progress', p);
end;
$$;
revoke all on function public.arcade_record(uuid, int, int, int, int, int, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.arcade_record(uuid, int, int, int, int, int, boolean, text, jsonb) to service_role;

-- The old way (the phone says its score) is closed: a score only gets in through a replayed run.
revoke all on function public.submit_arcade(text, int, int, int) from public, anon, authenticated;

-- Admin page: runs the server rejected, and the latest verified ones.
create or replace function public.admin_score_flags(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'rejected', coalesce((select jsonb_agg(x) from (
        select r.id, r.user_id, p.display_name as name, r.claimed, r.score, r.waves, r.ticks, r.real_ms, r.reason, r.flags, r.finished_at
        from public.arcade_runs r left join public.profiles p on p.id = r.user_id
        where r.status = 'rejected' order by r.finished_at desc limit 100) x), '[]'),
    'flagged', coalesce((select jsonb_agg(x) from (
        select r.id, r.user_id, p.display_name as name, r.score, r.waves, r.ticks, r.real_ms, r.flags, r.finished_at
        from public.arcade_runs r left join public.profiles p on p.id = r.user_id
        where r.status = 'verified' and r.flags is not null order by r.finished_at desc limit 100) x), '[]'),
    'runs_week', (select count(*) from public.arcade_runs r where r.started_at > now() - interval '7 days'),
    'verified_week', (select count(*) from public.arcade_runs r where r.status = 'verified' and r.finished_at > now() - interval '7 days'),
    'rejected_week', (select count(*) from public.arcade_runs r where r.status = 'rejected' and r.finished_at > now() - interval '7 days')
  );
end;
$$;

-- Admin page: things done outside the database (invite codes, passwords, removing a member) go in the
-- audit log too.
create or replace function public.admin_note(token text, action text, target text default null, detail jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  perform public.admin_audit_log(acct, left(action, 60), left(target, 200), detail);
end;
$$;

-- The dashboard counts current bans only (an unban keeps its row as history).
create or replace function public.admin_overview(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'members', (select count(*) from public.allowed_emails),
    'guests_now', (select count(*) from public.guest_admissions g where g.expires_at > now()),
    'banned', (select count(*) from public.banned_users b where b.lifted_at is null),
    'active_today', (select count(*) from public.profiles p where p.last_visit_date >= current_date - 1),
    'logs_open', (select count(*) from public.client_errors e where e.resolved_at is null),
    'logs_24h', (select count(*) from public.client_errors e where e.at > now() - interval '24 hours'),
    'reports_open', (select count(*) from public.client_errors e where e.kind = 'report' and e.resolved_at is null),
    'games_week', (select count(*) from public.game_results r where r.created_at > now() - interval '7 days'),
    'arcade_week', (select count(*) from public.arcade_scores s where s.created_at > now() - interval '7 days'),
    'arcade_record', (select max(s.score) from public.arcade_scores s),
    'rejected_week', (select count(*) from public.arcade_runs r where r.status = 'rejected' and r.finished_at > now() - interval '7 days'),
    'xp_today', (select coalesce(sum(l.amount), 0) from public.xp_ledger l where l.created_at > now() - interval '24 hours'),
    'catches_today', (select count(*) from public.critter_catches c where c.caught_at > now() - interval '24 hours'),
    'chat_today', (select count(*) from public.messages m where m.created_at > now() - interval '24 hours'),
    'logs_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select date_trunc('day', e.at)::date d, count(*) n from public.client_errors e where e.at > now() - interval '14 days' group by 1) x), '[]')
  );
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('admin_score_flags', 'admin_note', 'admin_overview') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
