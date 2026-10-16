-- Codes look like "ABCD-1234": four letters (no I, L or O) then four digits. Existing guest codes are replaced.
-- Guests show whose friend they are ("Sam · friend of Diesel"): public.guest_hosts() tells people in the house
-- which member let each current guest in, and guests' chat messages keep that name.

alter table public.guest_codes drop constraint guest_codes_code_check;
update public.guest_codes set code =
  (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ', 1 + floor(random() * 23)::int, 1), '') from generate_series(1, 4) where owner_id is not null) -- refers to the row, so each row gets its own code
  || '-' || lpad(floor(random() * 10000)::int::text, 4, '0'),
  updated_at = now();
alter table public.guest_codes add constraint guest_codes_code_check check (code ~ '^[A-HJKMNP-Z]{4}-[0-9]{4}$');

-- Current guests and the member who invited them, for anyone in the house (members and admitted guests).
create or replace function public.guest_hosts()
returns table (guest_id uuid, host_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, p.display_name
  from public.guest_admissions a
  join public.profiles p on p.id = a.invited_by
  where a.expires_at > now() and (public.is_member() or public.is_guest());
$$;
revoke all on function public.guest_hosts() from public, anon;
grant execute on function public.guest_hosts() to authenticated;

alter table public.messages add column author_host text check (char_length(author_host) <= 24);

create or replace function public.messages_fill_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  new.author_id := auth.uid();
  new.created_at := now();
  new.author_host := null;
  select display_name, character_index into p from public.profiles where id = new.author_id;
  if found then
    new.author_name := p.display_name;
    new.author_character := p.character_index;
    new.author_guest := false;
  else
    new.author_guest := true;
    new.author_name := left(coalesce(nullif(btrim(new.author_name), ''), 'Guest'), 24);
    select left(h.display_name, 24) into new.author_host
    from public.guest_admissions a join public.profiles h on h.id = a.invited_by
    where a.user_id = new.author_id;
  end if;
  return new;
end;
$$;
