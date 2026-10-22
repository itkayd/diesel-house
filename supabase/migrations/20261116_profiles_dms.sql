-- Everyone's profile, and private messages (22 Oct 2026, after U4).
-- Profiles: anyone in the house can open anyone's: name, character, level and rank, medals, a few stats,
-- and whether you're friends. Private messages: short (500 characters), at most 20 a minute and 500 a day
-- from one person, never from someone who blocked you (the sender isn't told). Each phone listens only
-- to its own messages (one Realtime subscription, filtered by Row Level Security), so it stays light.
-- Nothing is ever deleted here (a later tidy-up can remove old messages).

create or replace function public.player_profile(who uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  u auth.users;
  p public.profiles;
  member boolean;
  f public.friendships;
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  select * into u from auth.users x where x.id = who;
  if u.id is null then return null; end if;
  select * into p from public.profiles x where x.id = who;
  member := exists (select 1 from public.allowed_emails e where e.email = lower(u.email));
  select * into f from public.friendships x where x.a = least(me, who) and x.b = greatest(me, who);
  return jsonb_build_object(
    'id', who,
    'name', p.display_name,
    'character', p.character_key,
    'pet', p.pet,
    'member', member,
    'me', who = me,
    'level', case when member then p.level end,
    'xp', case when member then p.xp end,
    'streak', case when member then p.streak_days end,
    'best_streak', case when member then p.best_streak end,
    'joined', u.created_at,
    'last_on', case when member then u.last_sign_in_at end,
    'host', (select h.display_name from public.guest_admissions g join public.profiles h on h.id = g.invited_by where g.user_id = who order by g.admitted_at desc limit 1),
    'medals', coalesce((select jsonb_agg(m.medal_id order by m.earned_at) from public.user_medals m where m.user_id = who), '[]'),
    'arcade_best', (select max(s.score) from public.arcade_scores s where s.user_id = who),
    'games_won', (select count(*) from public.game_results r where who = any (r.winner_ids)),
    'critters', (select count(*) from public.critter_catches c where c.user_id = who),
    'friends', (select count(*) from public.friendships x where (x.a = who or x.b = who) and x.status = 'friends'),
    'friend', case when f.status = 'friends' then 'friends' when f.status = 'pending' and f.requested_by = me then 'outgoing'
                   when f.status = 'pending' then 'incoming' else 'none' end,
    'blocked', exists (select 1 from public.blocks b where b.blocker = me and b.blocked = who and b.active),
    'banned', exists (select 1 from public.banned_users b where b.user_id = who and b.lifted_at is null)
  );
end;
$$;
revoke all on function public.player_profile(uuid) from public, anon;
grant execute on function public.player_profile(uuid) to authenticated;

-- ---- Private messages ----
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  text text not null check (length(text) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender <> recipient)
);
create index if not exists direct_messages_pair_idx on public.direct_messages (least(sender, recipient), greatest(sender, recipient), id desc);
create index if not exists direct_messages_unread_idx on public.direct_messages (recipient) where read_at is null;
create index if not exists direct_messages_sender_idx on public.direct_messages (sender, created_at desc);
alter table public.direct_messages enable row level security;
revoke all on public.direct_messages from anon, authenticated;
grant select on public.direct_messages to authenticated;
create policy "read own messages" on public.direct_messages for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()));
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null;
end $$;

create or replace function public.send_dm(to_user uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  t text := left(trim(coalesce(body, '')), 500);
  new_id bigint;
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  if to_user is null or to_user = me or t = '' then return jsonb_build_object('ok', false, 'why', 'Nothing to send.'); end if;
  if not exists (select 1 from auth.users u where u.id = to_user) then return jsonb_build_object('ok', false, 'why', 'They’re not in the house any more.'); end if;
  if exists (select 1 from public.blocks b where b.blocker = me and b.blocked = to_user and b.active) then
    return jsonb_build_object('ok', false, 'why', 'You blocked them. Unblock them first (Settings → More).');
  end if;
  if (select count(*) from public.direct_messages d where d.sender = me and d.created_at > now() - interval '1 minute') >= 20
     or (select count(*) from public.direct_messages d where d.sender = me and d.created_at > now() - interval '1 day') >= 500 then
    return jsonb_build_object('ok', false, 'why', 'That’s a lot of messages. Wait a moment.');
  end if;
  -- Someone who blocked you never gets it (you aren't told).
  if exists (select 1 from public.blocks b where b.blocker = to_user and b.blocked = me and b.active) then
    return jsonb_build_object('ok', true, 'id', null);
  end if;
  insert into public.direct_messages (sender, recipient, text) values (me, to_user, t) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;
revoke all on function public.send_dm(uuid, text) from public, anon;
grant execute on function public.send_dm(uuid, text) to authenticated;

-- Your conversations: the other person, the last message, how many you haven't read.
create or replace function public.dm_threads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare me uuid := auth.uid();
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  return coalesce((select jsonb_agg(x order by x.last_at desc) from (
      select t.other as id, p.display_name as name, p.character_key as character, t.last_at,
        (select d.text from public.direct_messages d where least(d.sender, d.recipient) = least(me, t.other) and greatest(d.sender, d.recipient) = greatest(me, t.other) order by d.id desc limit 1) as last_text,
        (select d.sender = me from public.direct_messages d where least(d.sender, d.recipient) = least(me, t.other) and greatest(d.sender, d.recipient) = greatest(me, t.other) order by d.id desc limit 1) as last_mine,
        (select count(*) from public.direct_messages d where d.recipient = me and d.sender = t.other and d.read_at is null) as unread
      from (
        select case when d.sender = me then d.recipient else d.sender end as other, max(d.created_at) as last_at
        from public.direct_messages d where d.sender = me or d.recipient = me group by 1
      ) t
      left join public.profiles p on p.id = t.other
      where not exists (select 1 from public.blocks b where b.blocker = me and b.blocked = t.other and b.active)
      order by t.last_at desc limit 50) x), '[]');
end;
$$;
revoke all on function public.dm_threads() from public, anon;
grant execute on function public.dm_threads() to authenticated;

-- One conversation, newest 60 (or the 60 before `before_id`), oldest first.
create or replace function public.dm_history(with_user uuid, before_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare me uuid := auth.uid();
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  return coalesce((select jsonb_agg(x order by x.id) from (
      select d.id, d.sender, d.text, d.created_at, d.read_at from public.direct_messages d
      where least(d.sender, d.recipient) = least(me, with_user) and greatest(d.sender, d.recipient) = greatest(me, with_user)
        and (before_id is null or d.id < before_id)
      order by d.id desc limit 60) x), '[]');
end;
$$;
revoke all on function public.dm_history(uuid, bigint) from public, anon;
grant execute on function public.dm_history(uuid, bigint) to authenticated;

-- Read: everything they sent you so far.
create or replace function public.dm_read(with_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.direct_messages d set read_at = now() where d.recipient = auth.uid() and d.sender = with_user and d.read_at is null;
$$;
revoke all on function public.dm_read(uuid) from public, anon;
grant execute on function public.dm_read(uuid) to authenticated;

-- How many unread (for the badge).
create or replace function public.dm_unread()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.direct_messages d where d.recipient = auth.uid() and d.read_at is null
    and not exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = d.sender and b.active);
$$;
revoke all on function public.dm_unread() from public, anon;
grant execute on function public.dm_unread() to authenticated;
