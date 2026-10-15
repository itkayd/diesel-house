-- Guests only get in through a member. Each of the 8 members has their own guest invite code (shown in
-- Settings > Your guests) that they can share, switch off, or replace; or they can switch on "open house"
-- so anyone can drop in as a guest without a code.
-- A guest signs in anonymously, then redeems a code with public.admit_guest(). Only admitted guests count
-- as guests (public.is_guest()), so only they can join the house and voice channels. A visit lasts 12 h.

create table public.guest_codes (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  enabled boolean not null default true,
  open_house boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.guest_codes enable row level security;
create policy "members see own guest code" on public.guest_codes
  for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_member()));
create policy "members make own guest code" on public.guest_codes
  for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.is_member()));
create policy "members change own guest code" on public.guest_codes
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_member()))
  with check (owner_id = (select auth.uid()));

create table public.guest_admissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  admitted_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.guest_admissions enable row level security;
-- no policies: only admit_guest() and is_guest() (security definer) touch it

-- A guest redeems a member's code (or walks into an open house). Returns true if let in.
create or replace function public.admit_guest(invite text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter uuid;
  wanted text := regexp_replace(upper(coalesce(invite, '')), '[^A-Z0-9]', '', 'g');
begin
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return false;
  end if;
  if wanted <> '' then
    select owner_id into inviter from public.guest_codes where enabled and replace(code, '-', '') = wanted;
  end if;
  if inviter is null then
    select owner_id into inviter from public.guest_codes where open_house limit 1;
  end if;
  if inviter is null then
    return false;
  end if;
  insert into public.guest_admissions (user_id, invited_by, expires_at)
  values (auth.uid(), inviter, now() + interval '12 hours')
  on conflict (user_id) do update set invited_by = excluded.invited_by, admitted_at = now(), expires_at = excluded.expires_at;
  return true;
end;
$$;
revoke all on function public.admit_guest(text) from public, anon;
grant execute on function public.admit_guest(text) to authenticated;

-- Is anyone letting guests in without a code right now? (So the login page can say so.)
create or replace function public.house_is_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.guest_codes where open_house);
$$;
grant execute on function public.house_is_open() to anon, authenticated;

-- A guest is someone signed in without an account who has been let in, and whose visit hasn't run out.
create or replace function public.is_guest()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.guest_admissions where user_id = auth.uid() and expires_at > now());
$$;
revoke all on function public.is_guest() from public, anon;
grant execute on function public.is_guest() to authenticated;
