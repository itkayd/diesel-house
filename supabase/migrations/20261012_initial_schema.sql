-- ALREADY APPLIED to Supabase project "diesel-house" (ref adnpeaytzgelqxuvpdyf) on 2026-10-12.
-- Kept here as a record. Do not re-run.

-- Invite list: only these emails can use the app
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- no policies: only admins (dashboard / service role) can read or edit

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Player profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Guest' check (char_length(display_name) between 1 and 24),
  character_index smallint not null default 0 check (character_index between 0 and 19),
  colour text not null default '#4FB3A9',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "members read profiles" on public.profiles
  for select to authenticated using ((select public.is_member()));
create policy "members create own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()) and (select public.is_member()));
create policy "members update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- The 8 rooms
create table public.rooms (
  id text primary key check (id ~ '^room_0[1-8]$'),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null default 'Empty room' check (char_length(name) between 1 and 32),
  door_state text not null default 'open' check (door_state in ('open','knock','locked')),
  mood text check (mood in ('gaming','deeptalk','music','study','chill','dnd')),
  updated_at timestamptz not null default now()
);
alter table public.rooms enable row level security;
create policy "members read rooms" on public.rooms
  for select to authenticated using ((select public.is_member()));
create policy "owner updates own room" on public.rooms
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
-- owners are assigned by the admin in the dashboard

insert into public.rooms (id) values
  ('room_01'),('room_02'),('room_03'),('room_04'),
  ('room_05'),('room_06'),('room_07'),('room_08');

-- Room chat
create table public.messages (
  id bigint generated always as identity primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);
create index messages_room_created_idx on public.messages (room_id, created_at desc);
create index messages_author_idx on public.messages (author_id);
alter table public.messages enable row level security;
create policy "members read messages" on public.messages
  for select to authenticated using ((select public.is_member()));
create policy "members post as themselves" on public.messages
  for insert to authenticated with check (author_id = (select auth.uid()) and (select public.is_member()));
create policy "authors delete own messages" on public.messages
  for delete to authenticated using (author_id = (select auth.uid()));

-- Reactions on messages
create table public.reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, author_id, emoji)
);
create index reactions_author_idx on public.reactions (author_id);
alter table public.reactions enable row level security;
create policy "members read reactions" on public.reactions
  for select to authenticated using ((select public.is_member()));
create policy "members react as themselves" on public.reactions
  for insert to authenticated with check (author_id = (select auth.uid()) and (select public.is_member()));
create policy "authors remove own reactions" on public.reactions
  for delete to authenticated using (author_id = (select auth.uid()));

-- Live updates
alter publication supabase_realtime add table public.rooms, public.messages, public.reactions;
