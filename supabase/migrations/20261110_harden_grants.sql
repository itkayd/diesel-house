-- Security pass (22 Oct 2026): table rights are cut down to exactly what the game writes directly. Row
-- rules (RLS) already stopped anything else, but nothing should rely on one layer only.
--  * Nobody wipes a table (TRUNCATE skips row rules altogether).
--  * Signed-out visitors (anon) write nothing anywhere.
--  * Signed-in players write only: their profile's name, look and pet; chat messages and reactions
--    (insert / delete their own); their guest code. Everything else goes through checked functions.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate on public.%I from anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

-- Written only by the server or by checked (security definer) functions.
revoke insert, update, delete on public.allowed_emails, public.invite_codes, public.guest_admissions, public.game_results
  from authenticated;

-- Profiles: name, look, pet, and the "has picked a character" flag. XP, level and streaks were already
-- kept by a trigger (profiles_keep_progress); now the rights say so too.
revoke insert, update on public.profiles from authenticated;
grant insert (id, display_name, character_index, character_key, colour, picked) on public.profiles to authenticated;
grant update (id, display_name, character_index, character_key, colour, picked, pet) on public.profiles to authenticated;

-- Chat: post and delete (own, by row rules); never edit.
revoke update on public.messages, public.reactions from authenticated;
