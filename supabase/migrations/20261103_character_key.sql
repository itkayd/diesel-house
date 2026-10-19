-- R4 / STORE.md §3.4: characters are Ninja Adventure skins, stored by key ('ninja.boy') instead of a number.
-- 1. profiles.character_key, filled from character_index (old characters map onto the 12 free starters).
--    character_index stays one release so older copies of the game keep working; drop it after that.
-- 2. Only starters can be worn until the shop exists (phase S2 adds owned characters to the check).
-- 3. Chat messages carry the author's skin; guests always one of their two.
-- The weekly and catches boards still return character_index: while only starters can be worn, that
-- number maps back to exactly one key (asSkin in src/characters.ts). The shop phase (S2) adds character_key.

-- ---- The free starters, and the legacy number each one is shown as to older copies ----
create or replace function public.starter_characters()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['ninja.boy', 'ninja.woman', 'ninja.villager', 'ninja.villager2', 'ninja.villager3', 'ninja.villager4',
               'ninja.princess', 'ninja.eskimo', 'ninja.child', 'ninja.oldman', 'ninja.villager5', 'ninja.villager6'];
$$;

-- Guests choose from two (as before: a man and a woman).
create or replace function public.guest_characters()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['ninja.boy', 'ninja.woman'];
$$;

-- Old character numbers (0-15 chibis, 16-19 LimeZu) to starters. Same table as LEGACY in src/characters.ts.
create or replace function public.character_from_index(i int)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['ninja.boy', 'ninja.woman', 'ninja.villager', 'ninja.villager2', 'ninja.villager3', 'ninja.villager4',
                'ninja.princess', 'ninja.eskimo', 'ninja.child', 'ninja.oldman', 'ninja.villager5', 'ninja.villager6',
                'ninja.boy', 'ninja.woman', 'ninja.villager', 'ninja.villager2',
                'ninja.boy', 'ninja.villager3', 'ninja.woman', 'ninja.oldman'])[coalesce(i, 0) + 1];
$$;

alter table public.profiles add column if not exists character_key text;
update public.profiles set character_key = coalesce(public.character_from_index(character_index), 'ninja.boy') where character_key is null;
-- No default: a new row without a key gets the starter for its number (the trigger below).
alter table public.profiles alter column character_key drop default;
alter table public.profiles alter column character_key set not null;
alter table public.profiles drop constraint if exists profiles_character_key_check;
alter table public.profiles add constraint profiles_character_key_check check (character_key ~ '^[a-z]+\.[a-z0-9_]{2,32}$');

-- Wearing a character: a starter (owned characters join this check with the shop). An older copy of the
-- game that still writes character_index gets the matching starter.
create or replace function public.profiles_check_character()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.character_key is not distinct from old.character_key
     and new.character_index is distinct from old.character_index then
    new.character_key := public.character_from_index(new.character_index);
  elsif tg_op = 'INSERT' and new.character_key is null then
    new.character_key := public.character_from_index(new.character_index);
  end if;
  if not (new.character_key = any (public.starter_characters())) then
    raise exception 'that character isn''t yours to wear';
  end if;
  return new;
end;
$$;
create or replace trigger profiles_check_character before insert or update of character_key, character_index on public.profiles
  for each row execute function public.profiles_check_character();

-- ---- Chat: the author's skin ----
alter table public.messages add column if not exists author_skin text;
update public.messages set author_skin = public.character_from_index(author_character) where author_skin is null;

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
  select display_name, character_index, character_key into p from public.profiles where id = new.author_id;
  if found then
    new.author_name := p.display_name;
    new.author_character := p.character_index;
    new.author_skin := p.character_key;
    new.author_guest := false;
  else
    new.author_guest := true;
    new.author_name := left(coalesce(nullif(btrim(new.author_name), ''), 'Guest'), 24);
    if new.author_character not in (16, 18) then
      new.author_character := 16;
    end if;
    if new.author_skin is null or not (new.author_skin = any (public.guest_characters())) then
      new.author_skin := public.character_from_index(new.author_character);
    end if;
    select left(h.display_name, 24) into new.author_host
    from public.guest_admissions a join public.profiles h on h.id = a.invited_by
    where a.user_id = new.author_id;
  end if;
  return new;
end;
$$;
