-- Guest codes can't be guessed: a visitor (anonymous account) gets 8 wrong codes per 15 minutes, then
-- has to wait. (Supabase also limits how many anonymous accounts one network can make per hour.)
create table if not exists public.guest_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists guest_code_attempts_user_idx on public.guest_code_attempts (user_id, at desc);
alter table public.guest_code_attempts enable row level security;
revoke all on public.guest_code_attempts from anon, authenticated;

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
  -- Too many wrong codes lately: the code isn't checked (an open house still lets them in).
  if wanted <> '' and (select count(*) from public.guest_code_attempts a where a.user_id = auth.uid() and a.at > now() - interval '15 minutes') < 8 then
    select owner_id into inviter from public.guest_codes where enabled and replace(code, '-', '') = wanted;
    if inviter is null then
      insert into public.guest_code_attempts (user_id) values (auth.uid());
    end if;
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
