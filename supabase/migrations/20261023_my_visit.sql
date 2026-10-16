-- A guest's own visit, for their profile: when it ends and which member invited them.
-- Guests can't read guest_admissions directly (no policies), so this returns just their own row.
create or replace function public.my_visit()
returns table (expires_at timestamptz, host_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.expires_at, p.display_name
  from public.guest_admissions a
  left join public.profiles p on p.id = a.invited_by
  where a.user_id = auth.uid();
$$;
revoke all on function public.my_visit() from public, anon;
grant execute on function public.my_visit() to authenticated;
