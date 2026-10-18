-- More games, and fixes to saving results.
-- 1. Four new table games for 2-8 players: Quiz night (quiz), Sketch & guess (sketch), Liar's dice (liars)
--    and Letter rush (letters). They join the allowed lists for results and for a room's games.
-- 2. A guest who starts a game is its host, so record_game() refused the whole result ("members only")
--    and the members playing lost their game for challenges. Now a guest host may save it too; as before,
--    only members' ids are kept (nothing is saved if no member played).
-- 3. One result per host every 5 s dropped a result that came straight after another (a forfeit, then
--    "Play again"; a duel and a table game). Now: one per host and game every 2 s.

alter table public.game_results drop constraint if exists game_results_game_check;
alter table public.game_results add constraint game_results_game_check
  check (game in ('dice', 'rps', 'quickdraw', 'higherlower', 'wyr', 'four', 'quiz', 'sketch', 'liars', 'letters'));

alter table public.rooms drop constraint if exists rooms_games_check;
alter table public.rooms add constraint rooms_games_check
  check (games <@ array['dice', 'rps', 'quickdraw', 'higherlower', 'wyr', 'four', 'quiz', 'sketch', 'liars', 'letters']);

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
