-- House switches are enforced by the database too (22 Oct 2026), not only hidden in the game: with
-- critters switched off on the admin page no critter can be caught, with Night Raid off no run can start,
-- and a game switched off for the house records no results. (The game hides them too, live:
-- src/net/houseSettings.ts.)

-- Is a house switch on? (house_settings.<key>.enabled; missing = on)
create or replace function public.house_on(setting text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'enabled')::boolean from public.house_settings s where s.key = setting), true);
$$;
revoke all on function public.house_on(text) from public, anon;
grant execute on function public.house_on(text) to authenticated, service_role;

-- Critters: none turn up while they're switched off (so none can be caught).
create or replace function public.critter_at(at_slot bigint, idx int)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when not public.house_on('critters') then null
    when idx < 0 or idx > 7 or public.critter_for_slot(at_slot) is null then null
    when idx = 0 then public.critter_for_slot(at_slot)
    else (
      select d.id
      from (select c.id, sum(c.weight) over (order by c.ord) as upto from public.critter_defs c) d
      where d.upto > (((at_slot * 8 + idx) * 2654435761) % 4294967296 / 100) % 100
      order by d.upto
      limit 1
    )
  end;
$$;

-- Night Raid: no new runs while it's switched off.
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
  if not public.house_on('arcade') then
    return jsonb_build_object('ok', false, 'why', 'off');
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

-- Table games: a game switched off for the whole house records nothing.
create or replace function public.record_game(game text, spot text, players uuid[], winner_ids uuid[], score_json jsonb, seed text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  kept uuid[];
  winners uuid[];
  new_id bigint;
begin
  if not ((select public.is_member()) or (select public.is_guest())) then
    raise exception 'members and guests only';
  end if;
  if not (auth.uid() = any (players)) then
    raise exception 'the host must be playing';
  end if;
  if coalesce(array_length(players, 1), 0) > 8 or pg_column_size(score_json) > 4000 then
    raise exception 'too big';
  end if;
  if exists (select 1 from public.house_settings s where s.key = 'games_off' and s.value ? game) then
    return null;
  end if;
  -- One result per host and game every 2 s at most (a round takes longer than that).
  if exists (select 1 from public.game_results r where r.host_id = auth.uid() and r.game = game and r.created_at > now() - interval '2 seconds') then
    raise exception 'too soon';
  end if;
  -- Members only: guests (anonymous accounts) can play but don't go on the leaderboard.
  select coalesce(array_agg(distinct u.id), '{}') into kept
    from auth.users u where u.id = any (players) and not coalesce(u.is_anonymous, false);
  if cardinality(kept) = 0 then
    return null;
  end if;
  select coalesce(array_agg(w), '{}') into winners from unnest(winner_ids) w where w = any (kept);
  insert into public.game_results (game, spot, players, winner_ids, score, seed)
    values (game, spot, kept, winners, coalesce(score_json, '{}'), seed)
    returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.record_game(text, text, uuid[], uuid[], jsonb, text) from public, anon;
grant execute on function public.record_game(text, text, uuid[], uuid[], jsonb, text) to authenticated;
