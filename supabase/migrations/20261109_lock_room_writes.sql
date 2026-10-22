-- Rooms change only through the game's checked functions (set_dnd, set_room_rules, set_room_music, ...).
-- The old room-owner rights are switched off here; the old columns and table are removed by
-- 20261102_drop_room_owners.sql once Diesel confirms that deletion in Supabase (it deletes data, so
-- Supabase asks first).
revoke insert, update, delete on public.rooms from anon, authenticated;
do $$ begin
  if to_regclass('public.room_passes') is not null then
    revoke all on public.room_passes from anon, authenticated;
  end if;
end $$;
