-- UPDATE.md Phase 12: mini-games.
-- 1. Game results, written only through record_game() by the game's host. Members read them (leaderboard
--    later); guests can play, but only members' ids are kept.
-- 2. Dice rolls show in room chat as a system line: messages.kind 'roll'.
-- 3. Room owners choose which games their table offers: rooms.games (null = all).
-- 4. Realtime: one topic per game spot, game:hall (members and guests) and game:room_0N (door check).

create table public.game_results (
  id bigint generated always as identity primary key,
  game text not null check (game in ('dice', 'rps', 'quickdraw', 'higherlower', 'wyr', 'four')),
  spot text not null check (spot ~ '^(hall|duel|room_0[1-8])$'),
  host_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  players uuid[] not null,
  winner_ids uuid[] not null default '{}',
  score jsonb not null default '{}',
  seed text check (char_length(seed) <= 128),
  created_at timestamptz not null default now()
);
create index game_results_created_idx on public.game_results (created_at desc);
create index game_results_host_idx on public.game_results (host_id);
alter table public.game_results enable row level security;
create policy "members read game results" on public.game_results
  for select to authenticated using ((select public.is_member()));
-- No insert/update/delete policies: record_game() only.

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
  if not (select public.is_member()) then
    raise exception 'members only';
  end if;
  if not (auth.uid() = any (players)) then
    raise exception 'the host must be playing';
  end if;
  if coalesce(array_length(players, 1), 0) > 8 or pg_column_size(score_json) > 4000 then
    raise exception 'too big';
  end if;
  -- One result per host every 5 s at most (a round takes longer than that).
  if exists (select 1 from public.game_results r where r.host_id = auth.uid() and r.created_at > now() - interval '5 seconds') then
    raise exception 'too soon';
  end if;
  -- Members only: guests (anonymous accounts) can play but don't go on the leaderboard.
  select coalesce(array_agg(distinct u.id), '{}') into kept
    from auth.users u where u.id = any (players) and not coalesce(u.is_anonymous, false);
  select coalesce(array_agg(w), '{}') into winners from unnest(winner_ids) w where w = any (kept);
  insert into public.game_results (game, spot, players, winner_ids, score, seed)
    values (game, spot, kept, winners, coalesce(score_json, '{}'), seed)
    returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.record_game(text, text, uuid[], uuid[], jsonb, text) from public, anon;
grant execute on function public.record_game(text, text, uuid[], uuid[], jsonb, text) to authenticated;

alter table public.messages add column kind text not null default 'text' check (kind in ('text', 'roll'));

alter table public.rooms add column games text[] check (games <@ array['dice', 'rps', 'quickdraw', 'higherlower', 'wyr', 'four']);

drop policy if exists "house, hallway voice and allowed voice rooms: receive" on realtime.messages;
drop policy if exists "house, hallway voice and allowed voice rooms: send" on realtime.messages;

create policy "house, hallway, games and allowed rooms: receive" on realtime.messages
  for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (
      ((select realtime.topic()) in ('house', 'voice:hallway', 'game:hall') and ((select public.is_member()) or (select public.is_guest())))
      or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
      or ((select realtime.topic()) ~ '^game:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 6))))
    )
  );

create policy "house, hallway, games and allowed rooms: send" on realtime.messages
  for insert to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (
      ((select realtime.topic()) in ('house', 'voice:hallway', 'game:hall') and ((select public.is_member()) or (select public.is_guest())))
      or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
      or ((select realtime.topic()) ~ '^game:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 6))))
    )
  );
