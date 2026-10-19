-- Arcade: Night Raid (src/games/nightRaid.ts), a one-player shooter at the Gaming room's arcade cabinet.
-- Scores are kept per game; beating your own best pays more XP than catching a critter (5-25) or a day's
-- "play a game" challenge (30): a new personal best 50 XP, a new house record 150. At most 3 paid bests a
-- day (UTC), and only for a real game (300+ points). The score comes from the player's browser, so the
-- database checks it's believable for how long the game lasted and how many waves were cleared.

create table if not exists public.arcade_scores (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('nightraid')),
  score int not null check (score between 0 and 10000000),
  waves int not null check (waves between 0 and 1000),
  duration_ms int not null check (duration_ms between 0 and 7200000),
  xp int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists arcade_scores_game_idx on public.arcade_scores (game, score desc);
create index if not exists arcade_scores_user_idx on public.arcade_scores (user_id, game, score desc);
create index if not exists arcade_scores_time_idx on public.arcade_scores (created_at);
alter table public.arcade_scores enable row level security;
create policy "members read arcade scores" on public.arcade_scores for select to authenticated using ((select public.is_member()));
revoke insert, update, delete on public.arcade_scores from anon, authenticated;

-- 'Played Night Raid' counts for "Play any mini-game" (server-side only).
insert into public.event_caps (kind, cap, internal) values ('arcade_played', 60, true) on conflict (kind) do nothing;

create or replace function public.submit_arcade(game text, score int, waves int, duration_ms int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  prev int;
  record_before int;
  xp int := 0;
  paid int;
  level_before int;
  r jsonb;
  utc_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if uid is null or not ((select public.is_member()) or (select public.is_guest())) then
    raise exception 'members and guests only';
  end if;
  if not (select public.is_member()) then
    return jsonb_build_object('ok', false, 'why', 'guest');
  end if;
  if game is distinct from 'nightraid' then
    raise exception 'no such game';
  end if;
  -- Believable: at least 5 s, at most 150 points a second (plus a first-wave allowance), and no more
  -- than a wave every 5 s.
  if duration_ms < 5000 or score < 0 or score > duration_ms / 1000 * 150 + 1000 or waves < 0 or waves > duration_ms / 5000 + 1 then
    return jsonb_build_object('ok', false, 'why', 'unbelievable');
  end if;
  if exists (select 1 from public.arcade_scores s where s.user_id = uid and s.created_at > now() - interval '8 seconds') then
    return jsonb_build_object('ok', false, 'why', 'too_soon');
  end if;

  select max(s.score) into prev from public.arcade_scores s where s.user_id = uid and s.game = game;
  select max(s.score) into record_before from public.arcade_scores s where s.game = game;
  if score >= 300 and score > coalesce(prev, 0) then
    select count(*) into paid from public.xp_ledger l where l.user_id = uid and l.reason like 'arcade:%' and l.created_at >= utc_today;
    if paid < 3 then
      xp := case when score > coalesce(record_before, 0) then 150 else 50 end;
    end if;
  end if;
  insert into public.arcade_scores (user_id, game, score, waves, duration_ms, xp) values (uid, game, score, waves, duration_ms, xp);

  select p.level into level_before from public.profiles p where p.id = uid;
  if xp > 0 then
    insert into public.xp_ledger (user_id, amount, reason) values (uid, xp, 'arcade:' || game || case when xp > 50 then ':record' else ':best' end);
    update public.profiles p set xp = p.xp + xp, level = public.level_for_xp(p.xp + xp) where p.id = uid;
  end if;
  -- Challenges ("Play any mini-game"), rank medals and the up-to-date picture, as record_events() gives it.
  perform set_config('dh.internal', 'on', true);
  r := public.record_events(jsonb_build_array(jsonb_build_object('k', 'game_played', 'u', game), jsonb_build_object('k', 'arcade_played', 'u', game)), null);
  perform set_config('dh.internal', '', true);
  r := r || jsonb_build_object('level_before', level_before, 'gained', coalesce((r ->> 'gained')::int, 0) + xp);
  return jsonb_build_object(
    'ok', true, 'score', score, 'previous', prev, 'best', greatest(coalesce(prev, 0), score),
    'new_best', score > coalesce(prev, 0), 'record', score > coalesce(record_before, 0),
    'house_best', greatest(coalesce(record_before, 0), score), 'xp', xp, 'progress', r);
end;
$$;
revoke all on function public.submit_arcade(text, int, int, int) from public, anon;
grant execute on function public.submit_arcade(text, int, int, int) to authenticated;

-- This week's best score per person (top 10), and the all-time house record.
create or replace function public.arcade_board(game text)
returns table (user_id uuid, display_name text, character_key text, level int, best int, record boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  since timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  top int;
begin
  if not (select public.is_member()) then
    raise exception 'members only';
  end if;
  select max(s.score) into top from public.arcade_scores s where s.game = game;
  return query
    select pr.id, pr.display_name, pr.character_key, pr.level, b.best, b.best = top
    from (select s.user_id as uid, max(s.score) as best from public.arcade_scores s where s.game = game and s.created_at >= since group by s.user_id) b
    join public.profiles pr on pr.id = b.uid
    order by b.best desc, pr.display_name
    limit 10;
end;
$$;
revoke all on function public.arcade_board(text) from public, anon;
grant execute on function public.arcade_board(text) to authenticated;
