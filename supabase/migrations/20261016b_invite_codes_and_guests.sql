-- Invite codes and guests (replaces the email knock list from 20261016_access_requests.sql).
--
-- Members (the 8 friends) join with a single-use invite code Diesel makes on the door list (admin.html).
-- api/join.ts checks the code and makes their account (name + password; no email is ever sent). Their
-- account's login address is a made-up one on the guest list, so public.is_member() works unchanged.
--
-- Guests: anyone can drop in with Supabase's anonymous sign-in. They can be in the house and talk in
-- rooms (doors permitting, Phase 6) but can't own rooms or edit profiles.

drop table if exists public.access_requests;
drop function if exists public.access_requests_cap();

create table public.invite_codes (
  id bigint generated always as identity primary key,
  code_hash text not null unique,               -- sha256 of the code; the code itself is shown once
  label text check (char_length(label) <= 40),  -- who it's for, e.g. "Sami"
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
alter table public.invite_codes enable row level security;
-- no policies: only the server functions (secret key) read or change codes

-- Signed in without an account (Supabase anonymous sign-in).
create or replace function public.is_guest()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;
grant execute on function public.is_guest() to authenticated;

-- Realtime: members and guests may use the house and voice channels.
drop policy if exists "members receive house and voice" on realtime.messages;
drop policy if exists "members send house and voice" on realtime.messages;

create policy "members and guests receive house and voice"
on realtime.messages
for select
to authenticated
using (
  ((select public.is_member()) or (select public.is_guest()))
  and ((select realtime.topic()) = 'house' or (select realtime.topic()) ~ '^voice:room_0[1-8]$')
  and realtime.messages.extension in ('broadcast', 'presence')
);

create policy "members and guests send house and voice"
on realtime.messages
for insert
to authenticated
with check (
  ((select public.is_member()) or (select public.is_guest()))
  and ((select realtime.topic()) = 'house' or (select realtime.topic()) ~ '^voice:room_0[1-8]$')
  and realtime.messages.extension in ('broadcast', 'presence')
);

-- Guests may see the rooms (names, moods, doors) but not change them; members as before.
create policy "guests read rooms" on public.rooms for select to authenticated using ((select public.is_guest()));
-- ...and room owners' display names, for the door signs.
create policy "guests read profiles" on public.profiles for select to authenticated using ((select public.is_guest()));
