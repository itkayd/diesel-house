-- Knock requests from the login page. Instead of Supabase emailing a magic link (its built-in sender only
-- allows a few an hour), the login page records the email here; Diesel opens /admin.html, gets each
-- person's sign-in link, and emails it from his own address.
-- Anyone may add a request; nobody can read or change them through the public API. Only the admin
-- function (api/admin.ts, using the server-side secret key) can.

create table public.access_requests (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(email) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'sent', 'dismissed')),
  handled_at timestamptz
);

-- One open request per email (knocking twice doesn't pile up).
create unique index access_requests_one_pending on public.access_requests (email) where status = 'pending';

alter table public.access_requests enable row level security;

create policy "anyone can knock"
on public.access_requests
for insert
to anon, authenticated
with check (status = 'pending' and handled_at is null);

-- Keep the queue from being flooded: at most 200 open requests at once.
create function public.access_requests_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.access_requests where status = 'pending') >= 200 then
    raise exception 'too many open requests';
  end if;
  return new;
end;
$$;
revoke all on function public.access_requests_cap() from public, anon, authenticated;

create trigger access_requests_cap before insert on public.access_requests
for each row execute function public.access_requests_cap();
