-- UPDATE.md Phase 10: hallway voice (whisper + walkie-talkie) on its own Realtime topic, voice:hallway.
-- Same rule as the house channel: members and admitted guests. Rooms keep their door check.
drop policy if exists "house and allowed voice rooms: receive" on realtime.messages;
drop policy if exists "house and allowed voice rooms: send" on realtime.messages;

create policy "house, hallway voice and allowed voice rooms: receive" on realtime.messages
  for select to authenticated
  using (
    extension in ('broadcast', 'presence')
    and (
      ((select realtime.topic()) in ('house', 'voice:hallway') and ((select public.is_member()) or (select public.is_guest())))
      or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
    )
  );

create policy "house, hallway voice and allowed voice rooms: send" on realtime.messages
  for insert to authenticated
  with check (
    extension in ('broadcast', 'presence')
    and (
      ((select realtime.topic()) in ('house', 'voice:hallway') and ((select public.is_member()) or (select public.is_guest())))
      or ((select realtime.topic()) ~ '^voice:room_0[1-8]$' and (select public.can_enter_room(substr((select realtime.topic()), 7))))
    )
  );
