-- Guests choose from two characters only (16 = LimeZu Adam, 18 = LimeZu Amelia; see src/characters.ts).
-- Their chat messages always carry one of those, whatever their device sends.
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
    if new.author_character not in (16, 18) then
      new.author_character := 16;
    end if;
    select left(h.display_name, 24) into new.author_host
    from public.guest_admissions a join public.profiles h on h.id = a.invited_by
    where a.user_id = new.author_id;
  end if;
  return new;
end;
$$;
