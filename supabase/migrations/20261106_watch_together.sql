-- Watch & listen together: a YouTube video (or a Spotify track/album/playlist) playing for everyone in the
-- Lounge or the Disco. The database keeps what's on and where it was at a moment (media_pos seconds at
-- media_at, or paused there); each browser plays it through the official YouTube / Spotify player and
-- keeps in step. Anyone in the house can put something on, pause, skip or stop it.
-- Nothing is uploaded or re-streamed: each person's own player fetches it from YouTube or Spotify.

alter table public.rooms add column if not exists media_kind text;
alter table public.rooms add column if not exists media_id text;
alter table public.rooms add column if not exists media_pos real;
alter table public.rooms add column if not exists media_at timestamptz;
alter table public.rooms add column if not exists media_paused boolean not null default false;
alter table public.rooms add column if not exists media_by uuid references auth.users(id) on delete set null;
create index if not exists rooms_media_by_idx on public.rooms (media_by);
alter table public.rooms add constraint rooms_media_check check (
  (media_kind is null and media_id is null)
  or (media_kind = 'youtube' and media_id ~ '^[A-Za-z0-9_-]{11}$')
  or (media_kind = 'spotify' and media_id ~ '^(track|album|playlist|episode):[A-Za-z0-9]{22}$'));
alter table public.rooms add constraint rooms_media_pos_check check (media_pos is null or (media_pos >= 0 and media_pos <= 86400));

-- kind null: stop. Otherwise put `id` on at `pos` seconds, playing or paused.
create or replace function public.set_room_media(room text, kind text, id text, pos real, paused boolean)
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
  if room not in ('lounge', 'disco') then
    raise exception 'only the Lounge and the Disco have a screen';
  end if;
  -- Taps closer together than this are someone else's at the same moment: keep the first.
  if exists (select 1 from public.rooms r where r.id = room and r.media_at > now() - interval '700 milliseconds') then
    raise exception 'too soon';
  end if;
  update public.rooms r
    set media_kind = kind,
        media_id = case when kind is null then null else id end,
        media_pos = case when kind is null then null else greatest(0, coalesce(pos, 0)) end,
        media_at = case when kind is null then null else now() end,
        media_paused = coalesce(kind is not null and paused, false),
        media_by = case when kind is null then null else auth.uid() end,
        -- One thing at a time in the Disco: a video stops the jukebox.
        music = case when kind is not null then null else r.music end,
        music_at = case when kind is not null then null else r.music_at end,
        updated_at = now()
    where r.id = room and r.active;
end;
$$;
revoke all on function public.set_room_media(text, text, text, real, boolean) from public, anon;
grant execute on function public.set_room_media(text, text, text, real, boolean) to authenticated;

-- …and the jukebox stops a video.
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
  if exists (select 1 from public.rooms r where r.id = room and r.music_at > now() - interval '2 seconds') then
    raise exception 'too soon';
  end if;
  update public.rooms r
    set music = track,
        music_at = case when track is null then null else now() end,
        music_by = case when track is null then null else auth.uid() end,
        media_kind = case when track is not null then null else r.media_kind end,
        media_id = case when track is not null then null else r.media_id end,
        media_pos = case when track is not null then null else r.media_pos end,
        media_at = case when track is not null then null else r.media_at end,
        updated_at = now()
    where r.id = room and r.active;
end;
$$;
