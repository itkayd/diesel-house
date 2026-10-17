-- More critters when more people are in: each 2-minute slot that has critters has one per person in the
-- house, plus a coin-flip extra (3 people: 3 or 4; on your own: 1 or 2), up to 8. Apply after
-- 20261028_critters.sql.
--
-- Critter number `idx` (0-7) of a slot: number 0 is the slot's critter as before (critter_for_slot), the
-- others come from the same weights with their own hash. Quiet slots (25%) still have none at all. How many
-- there are depends on who's online, which only the browsers know, so the database accepts any idx 0-7;
-- the 25-a-day limit still holds. The browser's twin is critterAt() in src/critters/critters.ts.
--
-- Catches move to critter_catches (one per critter: slot and number), copying what's already in catches.
-- Nothing is removed (the old one-per-slot catches table just stops being used), so this applies without
-- any destructive step; catch_critter(slot) still works and means critter number 0.

create or replace function public.critter_at(at_slot bigint, idx int)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when idx < 0 or idx > 7 or public.critter_for_slot(at_slot) is null then null
    when idx = 0 then public.critter_for_slot(at_slot)
    else (
      select d.id
      from (select c.id, sum(c.weight) over (order by c.ord) as upto from public.critter_defs c) d
      where d.upto > (((at_slot * 8 + idx) * 2654435761) % 4294967296 / 100) % 100
      order by d.upto
      limit 1
    )
  end;
$$;

create table public.critter_catches (
  slot bigint not null,
  idx int not null default 0 check (idx between 0 and 7),
  critter text not null references public.critter_defs(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp int not null,
  caught_at timestamptz not null default now(),
  primary key (slot, idx) -- one catch per critter: whoever got there first
);
create index critter_catches_user_idx on public.critter_catches (user_id, caught_at);
create index critter_catches_caught_idx on public.critter_catches (caught_at);
create index critter_catches_critter_idx on public.critter_catches (critter);
alter table public.critter_catches enable row level security;
create policy "everyone in the house sees catches" on public.critter_catches for select to authenticated
  using ((select public.is_member()) or (select public.is_guest()));
revoke insert, update, delete on public.critter_catches from anon, authenticated;
alter publication supabase_realtime add table public.critter_catches;
insert into public.critter_catches (slot, idx, critter, user_id, xp, caught_at)
  select slot, 0, critter, user_id, xp, caught_at from public.catches on conflict do nothing;

-- Catch critter number `idx` of `at_slot` (this slot, or the one just ended: clocks differ a little).
create or replace function public.catch_critter_at(at_slot bigint, idx int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  uid uuid := auth.uid();
  -- dh.test_slot: a pretend clock for supabase/tests (a browser can't set it).
  now_slot bigint := coalesce(nullif(current_setting('dh.test_slot', true), '')::bigint, floor(extract(epoch from now()) / 120)::bigint);
  which text;
  d public.critter_defs;
  winner uuid;
  level_before int;
  r jsonb;
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if uid is null or not (select public.is_member()) then
    raise exception 'members only';
  end if;
  if at_slot < now_slot - 1 or at_slot > now_slot then
    return jsonb_build_object('ok', false, 'why', 'gone');
  end if;
  which := public.critter_at(at_slot, idx);
  if which is null then
    return jsonb_build_object('ok', false, 'why', 'nothing');
  end if;
  if (select count(*) from public.critter_catches c where c.user_id = uid and c.caught_at >= today) >= 25 then
    return jsonb_build_object('ok', false, 'why', 'enough');
  end if;
  select * into d from public.critter_defs c where c.id = which;
  insert into public.critter_catches (slot, idx, critter, user_id, xp) values (at_slot, idx, which, uid, d.xp) on conflict do nothing;
  if not found then
    select c.user_id into winner from public.critter_catches c where c.slot = at_slot and c.idx = idx;
    return jsonb_build_object('ok', false, 'why', 'taken', 'by', winner);
  end if;

  select p.level into level_before from public.profiles p where p.id = uid;
  insert into public.xp_ledger (user_id, amount, reason) values (uid, d.xp, 'catch:' || which);
  update public.profiles p set xp = p.xp + d.xp, level = public.level_for_xp(p.xp + d.xp) where p.id = uid;
  -- Challenges ('caught'), rank medals and the up-to-date picture, as record_events() gives it.
  perform set_config('dh.internal', 'on', true);
  r := public.record_events(jsonb_build_array(jsonb_build_object('k', 'caught', 'u', which)), null);
  perform set_config('dh.internal', '', true);
  r := r || jsonb_build_object('level_before', level_before, 'gained', (r ->> 'gained')::int + d.xp);
  return jsonb_build_object('ok', true, 'critter', which, 'name', d.name, 'xp', d.xp, 'progress', r);
end;
$$;
revoke all on function public.catch_critter_at(bigint, int) from public, anon;
grant execute on function public.catch_critter_at(bigint, int) to authenticated;

-- The old call (one critter per slot) means critter number 0.
create or replace function public.catch_critter(at_slot bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.catch_critter_at(at_slot, 0);
$$;

-- Today's catches, from the new table.
create or replace function public.catch_board()
returns table (user_id uuid, display_name text, character_index smallint, level int, caught bigint, xp bigint, critters text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if not (select public.is_member()) then
    raise exception 'members only';
  end if;
  return query
    select pr.id, pr.display_name, pr.character_index, pr.level, count(*), sum(c.xp)::bigint, array_agg(c.critter order by c.caught_at)
    from public.critter_catches c
    join public.profiles pr on pr.id = c.user_id
    where c.caught_at >= today
    group by pr.id, pr.display_name, pr.character_index, pr.level
    order by 6 desc, 5 desc, pr.display_name;
end;
$$;
