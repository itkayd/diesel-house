-- R4: pets. A member can have one animal that follows them around (cosmetic only). Free pets unlock at
-- level 3; more come with the shop (STORE.md §3.2, phase S2 adds owned pets to the check).
-- Same list and level as FREE_PETS / PET_LEVEL in src/house/animals.ts.

create or replace function public.free_pets()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['cat', 'dog', 'hamster', 'chicken', 'frog'];
$$;

alter table public.profiles add column if not exists pet text;
alter table public.profiles add constraint profiles_pet_check check (pet is null or pet ~ '^[a-z0-9_]{2,24}$');

create or replace function public.profiles_check_pet()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pet is not null and new.pet is distinct from (case when tg_op = 'UPDATE' then old.pet end) then
    if not (new.pet = any (public.free_pets())) then
      raise exception 'that pet isn''t yours yet';
    end if;
    -- The level as stored (old row): a client can't raise its own level (profiles_keep_progress puts it back,
    -- but that trigger runs after this one).
    if (case when tg_op = 'UPDATE' then old.level else 1 end) < 3 then
      raise exception 'pets unlock at level 3';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger profiles_check_pet before insert or update of pet on public.profiles
  for each row execute function public.profiles_check_pet();
