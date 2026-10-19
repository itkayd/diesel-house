-- Drop the old room-ownership schema (REDESIGN.md §2: "leave the columns one release, then drop them";
-- Diesel said yes on 18 Oct). Rooms have been shared since R1 and nothing in the game reads these.
-- Kept: guest_codes.owner_id (a member's invite code, a different thing) and the retired room_01..08 rows
-- (their old chat is still readable in Settings → More).

drop policy if exists "owner updates own room" on public.rooms;
drop table if exists public.room_passes;
alter table public.rooms drop column if exists owner_id;
alter table public.rooms drop column if exists door_state;
alter table public.rooms drop column if exists mood;
