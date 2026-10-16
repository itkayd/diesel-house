-- Every guest visit makes an anonymous account, so listing all accounts to find the 8 members stops working
-- once there are a few hundred. Members are counted and listed from allowed_emails instead, and the daily
-- cron (/api/ping) deletes guest accounts whose visit ended more than 7 days ago (or that never got in).
-- Guests' chat messages stay when their account goes: they keep the name, character and host they were
-- posted with, and lose only the link to the account.

-- The member accounts (name + password logins on the guest list), for the door list and the 8-account limit.
create or replace function public.member_accounts()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.created_at, u.last_sign_in_at
  from public.allowed_emails a
  join auth.users u on lower(u.email) = a.email
  where a.email like '%@members.diesel-house.invalid'
  order by u.created_at;
$$;
revoke all on function public.member_accounts() from public, anon, authenticated;
grant execute on function public.member_accounts() to service_role;

-- Guest accounts that can go: visit ended over 7 days ago, or signed in over 7 days ago and never let in.
create or replace function public.stale_guest_ids(max_rows int default 500)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  left join public.guest_admissions g on g.user_id = u.id
  where u.is_anonymous
    and (g.expires_at < now() - interval '7 days'
         or (g.user_id is null and u.created_at < now() - interval '7 days'))
  limit max_rows;
$$;
revoke all on function public.stale_guest_ids(int) from public, anon, authenticated;
grant execute on function public.stale_guest_ids(int) to service_role;

-- Keep chat messages when their author's account is deleted.
alter table public.messages alter column author_id drop not null;
alter table public.messages drop constraint messages_author_id_fkey;
alter table public.messages add constraint messages_author_id_fkey foreign key (author_id) references auth.users(id) on delete set null;
