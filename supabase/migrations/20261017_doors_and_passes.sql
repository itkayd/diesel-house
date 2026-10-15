-- Phase 6: doors that mean it.
-- A room's door is open, knock-first, or locked (rooms.door_state). People other than the owner can only
-- be in a knock/locked room with a pass the owner gives them ("Let in"), which lasts 12 hours or until the
-- owner removes them. The voice channel for a room checks this, so nobody can listen in by going around
-- the game.

create table public.room_passes (
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, -- members or guests
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  primary key (room_id, user_id)
);
create index room_passes_user_idx on public.room_passes (user_id);
alter table public.room_passes enable row level security;

create policy "members read passes" on public.room_passes
  for select to authenticated using ((select public.is_member()));
create policy "guests read own passes" on public.room_passes
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_guest()));
create policy "owners let people in" on public.room_passes
  for insert to authenticated
  with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = (select auth.uid())));
create policy "owners renew passes" on public.room_passes
  for update to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = (select auth.uid())));
create policy "owners remove people" on public.room_passes
  for delete to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = (select auth.uid())));

-- Can the caller be in this room (and its voice)? Open door, their own room, or a live pass.
create or replace function public.can_enter_room(room text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ((select public.is_member()) or (select public.is_guest()))
    and exists (
      select 1 from public.rooms r
      where r.id = room
        and (r.door_state = 'open'
             or r.owner_id = auth.uid()
             or exists (select 1 from public.room_passes p
                        where p.room_id = r.id and p.user_id = auth.uid() and p.expires_at > now()))
    );
$$;
revoke all on function public.can_enter_room(text) from public, anon;
grant execute on function public.can_enter_room(text) to authenticated;

-- Realtime: the house channel for members and guests; each voice room only for people the door lets in.
drop policy if exists "members and guests receive house and voice" on realtime.messages;
drop policy if exists "members and guests send house and voice" on realtime.messages;

create policy "house and allowed voice rooms: receive"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and (
    ((select realtime.topic()) = 'house' and ((select public.is_member()) or (select public.is_guest())))
    or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
  )
);

create policy "house and allowed voice rooms: send"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and (
    ((select realtime.topic()) = 'house' and ((select public.is_member()) or (select public.is_guest())))
    or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
  )
);
