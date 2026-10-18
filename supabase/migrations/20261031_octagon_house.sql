-- REDESIGN.md R3: the octagon house is up.
-- 1. The 8 old personal rooms are retired (no voice, games or new chat in them). Their chat stays readable
--    for one release, from Settings → Old rooms.
-- 2. Challenges and medals that were about owners and knocking get their new rules (REDESIGN.md §2):
--    d_knock → "Dance in the Disco for 2 minutes", w_rooms → "Visit all 7 rooms", medal decor → House tour,
--    first_knock → Dance machine, host → Party starter (same rule as R1). Same ids: nobody loses progress,
--    medals or XP.

-- ---- 1. Retire room_01..08 ----
update public.rooms set active = false where id ~ '^room_0[1-8]$';

-- Old chat: members can still read what was said in a retired room (nobody can post there: posting
-- still needs can_enter_room(), which needs an active room).
create policy "members read retired rooms' chat" on public.messages
  for select to authenticated
  using ((select public.is_member()) and exists (select 1 from public.rooms r where r.id = room_id and not r.active));

-- ---- 2. Challenges ----
insert into public.event_caps (kind, cap) values ('dance_min', 60) on conflict (kind) do update set cap = excluded.cap;

update public.challenge_defs
  set title = 'Dance in the Disco for 2 minutes', kind = 'dance_min', goal = 2, uniq = false
  where id = 'd_knock';
update public.challenge_defs
  set title = 'Visit all 7 rooms', goal = 7, uniq = true
  where id = 'w_rooms';

-- ---- 3. Medals ----
-- House tour: every active room is in your room_enter list (the list keeps up to 50 different rooms).
-- Dance machine: 2 minutes on the Disco floor. The rest are as they were.
create or replace function public.medals_due(uid uuid, local_now timestamp, streak int)
returns table (id text, xp int)
language sql
stable
set search_path = ''
as $$
  with t as (select kind, n, seen from public.user_tallies where user_id = uid and scope = 'all')
  select v.id, v.xp from (values
    ('decor', 25, exists (
      select 1 from t where kind = 'room_enter'
        and not exists (select 1 from public.rooms r where r.active and not (r.id = any (t.seen))))),
    ('first_knock', 25, exists (select 1 from t where kind = 'dance_min' and n >= 2)),
    ('social', 50, exists (select 1 from t where kind = 'emote_sent' and cardinality(seen) >= 3)),
    ('over_out', 50, exists (select 1 from t where kind = 'walkie_used' and n >= 3)),
    ('night_owl', 50, extract(hour from local_now) < 5),
    ('high_roller', 75, exists (select 1 from t where kind = 'double_six' and n >= 1)),
    ('fast_hand', 75, exists (select 1 from t where kind = 'qd_round_won' and n >= 1)),
    ('duelist', 100, exists (select 1 from t where kind = 'rps_won' and n >= 3)),
    ('host', 150, exists (select 1 from t where kind = 'party' and n >= 1)),
    ('steady', 200, streak >= 7)
  ) as v(id, xp, earned)
  where v.earned and not exists (select 1 from public.user_medals um where um.user_id = uid and um.medal_id = v.id);
$$;
