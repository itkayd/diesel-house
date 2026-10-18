-- REDESIGN.md R1: rooms are data, nobody owns a room, "Do not disturb" instead of knock / lock, room game
-- rules anyone in the house can change (with a log), and error reports from friends' phones.
-- Apply after 20261029_more_critters.sql.
--
-- Nothing is removed: rooms.owner_id, door_state, mood, room_passes and the knock policies stay for one
-- release so older copies of the game keep working, then a later migration drops them (Diesel first).
-- The two `drop constraint` lines only swap a check for a looser one.

-- ---- 1. Room ids: any short lowercase id (was room_01..08) ----
alter table public.rooms drop constraint if exists rooms_id_check;
alter table public.rooms add constraint rooms_id_check check (id ~ '^[a-z0-9_]{3,32}$');
alter table public.game_results drop constraint if exists game_results_spot_check;
alter table public.game_results add constraint game_results_spot_check check (spot ~ '^[a-z0-9_]{3,32}$');

-- active: false retires a room (R3 retires room_01..08 once the new house is up).
alter table public.rooms add column if not exists active boolean not null default true;
-- Do not disturb: anyone in the room can ask for quiet; the game shows it only while someone is inside
-- and clears it when the next person finds the room empty.
alter table public.rooms add column if not exists dnd boolean not null default false;
alter table public.rooms add column if not exists dnd_set_by uuid references auth.users(id) on delete set null;
alter table public.rooms add column if not exists dnd_at timestamptz;
create index if not exists rooms_dnd_set_by_idx on public.rooms (dnd_set_by);

-- The 7 themed rooms of the new house (REDESIGN.md §2), ready for R3. Nothing in the game uses them yet.
insert into public.rooms (id, name) values
  ('garden', 'Garden'), ('rooftop', 'Rooftop'), ('library', 'Library'), ('disco', 'Disco'),
  ('gaming', 'Gaming room'), ('cafe', 'Café'), ('lounge', 'Lounge')
on conflict (id) do nothing;

-- ---- 2. Who can be in a room: everyone in the house, any active room ----
create or replace function public.can_enter_room(room text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ((select public.is_member()) or (select public.is_guest()))
    and exists (select 1 from public.rooms r where r.id = room and r.active);
$$;

-- Realtime channels: the house, the hallway, the hall's game table, and voice / game channels of any
-- room in the rooms table (was a fixed room_0[1-8] pattern).
alter policy "house, hallway, games and allowed rooms: receive" on realtime.messages
using (
  (extension = any (array['broadcast', 'presence']))
  and (
    ((select realtime.topic()) = any (array['house', 'voice:hallway', 'game:hall']) and ((select public.is_member()) or (select public.is_guest())))
    or ((select realtime.topic()) like 'voice:%' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
    or ((select realtime.topic()) like 'game:%' and (select public.can_enter_room(substr((select realtime.topic()), 6))))
  )
);
alter policy "house, hallway, games and allowed rooms: send" on realtime.messages
with check (
  (extension = any (array['broadcast', 'presence']))
  and (
    ((select realtime.topic()) = any (array['house', 'voice:hallway', 'game:hall']) and ((select public.is_member()) or (select public.is_guest())))
    or ((select realtime.topic()) like 'voice:%' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
    or ((select realtime.topic()) like 'game:%' and (select public.can_enter_room(substr((select realtime.topic()), 6))))
  )
);

-- ---- 3. Do not disturb ----
create or replace function public.set_dnd(room text, quiet boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not ((select public.is_member()) or (select public.is_guest())) then
    raise exception 'house members and guests only';
  end if;
  update public.rooms r
    set dnd = quiet,
        dnd_set_by = case when quiet then auth.uid() else null end,
        dnd_at = case when quiet then now() else null end,
        updated_at = now()
    where r.id = room and r.active and r.dnd is distinct from quiet;
end;
$$;
revoke all on function public.set_dnd(text, boolean) from public, anon;
grant execute on function public.set_dnd(text, boolean) to authenticated;

-- ---- 4. Room game rules: which games the room's table offers, and its own Would you rather prompts ----
-- Any member can change them (no owners); every change is logged so it's clear who did what.
create table if not exists public.room_changes (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  what jsonb not null
);
create index if not exists room_changes_room_idx on public.room_changes (room_id, changed_at desc);
create index if not exists room_changes_user_idx on public.room_changes (user_id);
alter table public.room_changes enable row level security;
create policy "members read room changes" on public.room_changes for select to authenticated
  using ((select public.is_member()));
revoke insert, update, delete on public.room_changes from anon, authenticated;

create or replace function public.set_room_rules(room text, room_games text[], room_prompts text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  before public.rooms;
begin
  if not (select public.is_member()) then
    raise exception 'members only';
  end if;
  select * into before from public.rooms r where r.id = room and r.active;
  if not found then
    raise exception 'no such room';
  end if;
  if (select count(*) from public.room_changes c where c.user_id = auth.uid() and c.changed_at > now() - interval '1 minute') >= 10 then
    raise exception 'too many changes, try again in a minute';
  end if;
  -- (the columns' own checks reject unknown games and malformed prompts)
  update public.rooms r set games = room_games, prompts = room_prompts, updated_at = now() where r.id = room;
  insert into public.room_changes (room_id, user_id, what)
    values (room, auth.uid(), jsonb_build_object(
      'games', jsonb_build_object('from', to_jsonb(before.games), 'to', to_jsonb(room_games)),
      'prompts', jsonb_build_object('from', coalesce(array_length(before.prompts, 1), 0), 'to', coalesce(array_length(room_prompts, 1), 0))));
end;
$$;
revoke all on function public.set_room_rules(text, text[], text[]) from public, anon;
grant execute on function public.set_room_rules(text, text[], text[]) to authenticated;

-- ---- 5. Error reports from friends' phones (BUGS.md #13) ----
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  at timestamptz not null default now(),
  message text not null,
  stack text,
  page text,
  agent text,
  build text
);
create index if not exists client_errors_at_idx on public.client_errors (at desc);
create index if not exists client_errors_user_idx on public.client_errors (user_id);
alter table public.client_errors enable row level security;
-- No policies: written only through report_error(); Diesel reads them in the Supabase dashboard.
revoke all on public.client_errors from anon, authenticated;

create or replace function public.report_error(message text, stack text default null, page text default null, agent text default null, build text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not ((select public.is_member()) or (select public.is_guest())) then
    return;
  end if;
  -- At most 20 an hour each, so a broken loop can't fill the table.
  if (select count(*) from public.client_errors e where e.user_id = auth.uid() and e.at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into public.client_errors (user_id, message, stack, page, agent, build)
    values (auth.uid(), left(coalesce(message, '?'), 500), left(stack, 2000), left(page, 300), left(agent, 300), left(build, 60));
end;
$$;
revoke all on function public.report_error(text, text, text, text, text) from public, anon;
grant execute on function public.report_error(text, text, text, text, text) to authenticated;

-- ---- 6. Challenges: "Knock on a door and get let in" can't happen any more ----
-- Same id (so today's progress and history stay), new rule until the Disco arrives in R3.
update public.challenge_defs
  set title = 'Visit 2 different rooms', kind = 'room_enter', goal = 2, uniq = true
  where id = 'd_knock';
