-- Phase 5: Realtime Authorization.
-- Only signed-in people on the guest list (public.is_member()) may use the game's private Realtime
-- channels: "house" (positions + who's online) and "voice:room_01".."voice:room_08" (voice signalling).
-- Clients join these with { config: { private: true } }. Anyone else, including a browser holding only the
-- publishable key, gets refused when joining.
-- Phase 6 tightens the voice rooms further (door state + passes).

create policy "members receive house and voice"
on realtime.messages
for select
to authenticated
using (
  (select public.is_member())
  and ((select realtime.topic()) = 'house' or (select realtime.topic()) ~ '^voice:room_0[1-8]$')
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "members send house and voice"
on realtime.messages
for insert
to authenticated
with check (
  (select public.is_member())
  and ((select realtime.topic()) = 'house' or (select realtime.topic()) ~ '^voice:room_0[1-8]$')
  and realtime.messages.extension in ('broadcast', 'presence')
);
