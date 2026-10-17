-- Critters: catch the cats, dogs and other critters that turn up around the house for a little XP.
-- Apply after 20261027_challenges_xp.sql.
--
-- Every 2 minutes ("slot" = seconds since 1970 / 120) there's a 75% chance a critter turns up somewhere in
-- the house. Which critter is worked out from the slot number (critter_for_slot), identically in the
-- browser (src/critters/critters.ts), so everyone sees the same one without any messages; the browser also
-- picks where it stands. The first member to walk into it catches it: catch_critter() decides who was
-- first (one row per slot), pays the XP, and moves the 'caught' challenges on. 25 catches a day at most.
-- Everyone in the house sees a catch live (catches is in the realtime publication).

create table public.critter_defs (
  id text primary key,
  name text not null,
  xp int not null check (xp > 0),
  weight int not null check (weight > 0), -- out of the total: how often it's the one that turns up
  ord int not null unique
);
alter table public.critter_defs enable row level security;
create policy "everyone in the house reads critters" on public.critter_defs for select to authenticated
  using ((select public.is_member()) or (select public.is_guest()));
revoke insert, update, delete on public.critter_defs from anon, authenticated;
-- Keep in step with CRITTERS in src/critters/critters.ts.
insert into public.critter_defs (id, name, xp, weight, ord) values
  ('cat', 'Cat', 5, 24, 1),
  ('dog', 'Dog', 5, 24, 2),
  ('duck', 'Duck', 5, 18, 3),
  ('frog', 'Frog', 8, 12, 4),
  ('bunny', 'Bunny', 8, 10, 5),
  ('owl', 'Owl', 15, 6, 6),
  ('fox', 'Fox', 15, 4, 7),
  ('medal', 'Lost medal', 25, 2, 8);

-- The critter for a slot, or null (25% of slots have none). Same maths as critterFor() in the browser.
create or replace function public.critter_for_slot(at_slot bigint)
returns text
language sql
stable
set search_path = ''
as $$
  with h as (select (at_slot * 2654435761) % 4294967296 as v)
  select case when (select v % 100 from h) >= 75 then null else (
    select d.id
    from (select c.id, sum(c.weight) over (order by c.ord) as upto from public.critter_defs c) d
    where d.upto > (select (v / 100) % 100 from h)
    order by d.upto
    limit 1
  ) end;
$$;

create table public.catches (
  slot bigint primary key, -- one catch per slot: whoever got there first
  critter text not null references public.critter_defs(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp int not null,
  caught_at timestamptz not null default now()
);
create index catches_user_idx on public.catches (user_id, caught_at);
create index catches_caught_idx on public.catches (caught_at);
alter table public.catches enable row level security;
create policy "everyone in the house sees catches" on public.catches for select to authenticated
  using ((select public.is_member()) or (select public.is_guest()));
revoke insert, update, delete on public.catches from anon, authenticated;
alter publication supabase_realtime add table public.catches;

-- Catching counts towards challenges, but only from here (internal: a browser can't send it).
insert into public.event_caps (kind, cap, internal) values ('caught', 30, true);
insert into public.challenge_defs (id, period, title, kind, goal, xp, uniq) values
  ('d_catch', 'day', 'Catch 3 critters', 'caught', 3, 20, false),
  ('w_catch', 'week', 'Catch 15 critters', 'caught', 15, 120, false);

-- Walked into the critter of `at_slot` (this slot, or the one just ended: clocks differ a little).
-- Returns { ok, critter, name, xp, progress (as record_events) } or { ok: false, why, by }.
create or replace function public.catch_critter(at_slot bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  which := public.critter_for_slot(at_slot);
  if which is null then
    return jsonb_build_object('ok', false, 'why', 'nothing');
  end if;
  if (select count(*) from public.catches c where c.user_id = uid and c.caught_at >= today) >= 25 then
    return jsonb_build_object('ok', false, 'why', 'enough');
  end if;
  select * into d from public.critter_defs c where c.id = which;
  insert into public.catches (slot, critter, user_id, xp) values (at_slot, which, uid, d.xp) on conflict do nothing;
  if not found then
    select c.user_id into winner from public.catches c where c.slot = at_slot;
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
revoke all on function public.catch_critter(bigint) from public, anon;
grant execute on function public.catch_critter(bigint) to authenticated;

-- The noticeboard's "Today's catches" (UTC day, like the weekly board): members who caught something.
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
    from public.catches c
    join public.profiles pr on pr.id = c.user_id
    where c.caught_at >= today
    group by pr.id, pr.display_name, pr.character_index, pr.level
    order by 6 desc, 5 desc, pr.display_name;
end;
$$;
revoke all on function public.catch_board() from public, anon;
grant execute on function public.catch_board() to authenticated;
