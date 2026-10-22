-- Night Raid got combos (up to +30% points) and an Ult (Shuriken Storm hits every spook at once), so a
-- strong run scores faster than before. The believable-score limit goes from 150 to 250 points a second
-- (plus 2000 to start). Same function otherwise (20261107_arcade.sql).

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
  -- Believable: at least 5 s, at most 250 points a second (plus a first-wave allowance), and no more
  -- than a wave every 5 s.
  if duration_ms < 5000 or score < 0 or score > duration_ms / 1000 * 250 + 2000 or waves < 0 or waves > duration_ms / 5000 + 1 then
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
