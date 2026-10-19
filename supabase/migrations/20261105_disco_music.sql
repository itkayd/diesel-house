-- R4: the Disco's jukebox. One track plays for everyone in the room, from the moment it was started
-- (each browser works out where in the loop it is from music_at). Anyone in the house can pick a track or
-- stop it. Tracks: CC0 chiptunes by ansimuz (public/assets/music, src/house/jukebox.ts TRACKS).

alter table public.rooms add column if not exists music text;
alter table public.rooms add column if not exists music_at timestamptz;
alter table public.rooms add column if not exists music_by uuid references auth.users(id) on delete set null;
alter table public.rooms add constraint rooms_music_check check (music is null or music in ('determination', 'sun_tribe', 'sun_tribe_inside', 'ghost_town'));
create index if not exists rooms_music_by_idx on public.rooms (music_by);

create or replace function public.set_room_music(room text, track text)
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
  if room <> 'disco' then
    raise exception 'only the Disco has a jukebox';
  end if;
  -- No flipping tracks back and forth faster than every 2 s.
  if exists (select 1 from public.rooms r where r.id = room and r.music_at > now() - interval '2 seconds') then
    raise exception 'too soon';
  end if;
  update public.rooms r
    set music = track,
        music_at = case when track is null then null else now() end,
        music_by = case when track is null then null else auth.uid() end,
        updated_at = now()
    where r.id = room and r.active;
end;
$$;
revoke all on function public.set_room_music(text, text) from public, anon;
grant execute on function public.set_room_music(text, text) to authenticated;
