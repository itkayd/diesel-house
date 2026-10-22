-- U4 · Social and safety (22 Oct 2026, design/review/UX-RULES.md §4): blocking, friends, and reporting a
-- player to Diesel. (No word filter: the house is 18+.) Nothing here is ever deleted: an unblock, an
-- ended friendship and a resolved report keep their row, so the admin page has the history.

-- ---- Blocks: you don't hear them, don't see their chat, and they can't invite you or friend you ----
create table if not exists public.blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;
create policy "read own blocks" on public.blocks for select to authenticated using (blocker = (select auth.uid()));

-- ---- Friends: one row per pair (a < b) ----
create table if not exists public.friendships (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'friends', 'ended')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  since timestamptz,
  primary key (a, b),
  check (a < b)
);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

-- ---- Reports about a player, for the admin page ----
create table if not exists public.player_reports (
  id bigint generated always as identity primary key,
  reporter uuid references auth.users(id) on delete set null,
  reported uuid references auth.users(id) on delete set null,
  reported_name text,
  reason text not null check (reason in ('harassment', 'hate', 'spam', 'cheating', 'other')),
  details text check (length(details) <= 1000),
  context jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  note text
);
create index if not exists player_reports_open_idx on public.player_reports (created_at desc) where resolved_at is null;
alter table public.player_reports enable row level security;
revoke all on public.player_reports from anon, authenticated;

-- Members and guests (who are in the house right now).
create or replace function public.in_house()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select (select public.is_member()) or (select public.is_guest()) $$;
revoke all on function public.in_house() from public, anon;
grant execute on function public.in_house() to authenticated;

-- Block or unblock someone. Blocking also ends a friendship (or a request) between you.
create or replace function public.set_block(who uuid, on_off boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare me uuid := auth.uid();
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  if who is null or who = me then return jsonb_build_object('ok', false, 'why', 'not possible'); end if;
  insert into public.blocks (blocker, blocked, active) values (me, who, on_off)
    on conflict (blocker, blocked) do update set active = excluded.active, updated_at = now();
  if on_off then
    update public.friendships f set status = 'ended', updated_at = now()
      where f.a = least(me, who) and f.b = greatest(me, who) and f.status <> 'ended';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_block(uuid, boolean) from public, anon;
grant execute on function public.set_block(uuid, boolean) to authenticated;

-- Ask to be friends (members). If they already asked you, you're friends now. A person who blocked you
-- never gets the request (and you're not told).
create or replace function public.friend_request(who uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null or not (select public.is_member()) then raise exception 'members only'; end if;
  if who is null or who = me or not exists (
    select 1 from auth.users u join public.allowed_emails e on e.email = lower(u.email) where u.id = who) then
    return jsonb_build_object('ok', false, 'why', 'Only members can be friends.');
  end if;
  if exists (select 1 from public.blocks b where b.blocker = who and b.blocked = me and b.active) then
    return jsonb_build_object('ok', true, 'status', 'pending'); -- quietly nothing
  end if;
  select * into f from public.friendships x where x.a = least(me, who) and x.b = greatest(me, who);
  if f.status = 'friends' then
    return jsonb_build_object('ok', true, 'status', 'friends');
  end if;
  if f.status = 'pending' and f.requested_by = who then
    update public.friendships x set status = 'friends', since = now(), updated_at = now() where x.a = f.a and x.b = f.b;
    return jsonb_build_object('ok', true, 'status', 'friends');
  end if;
  insert into public.friendships (a, b, status, requested_by) values (least(me, who), greatest(me, who), 'pending', me)
    on conflict (a, b) do update set status = 'pending', requested_by = me, updated_at = now(), since = null;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;
revoke all on function public.friend_request(uuid) from public, anon;
grant execute on function public.friend_request(uuid) to authenticated;

-- Answer a request (yes: friends; no: it goes away), or end a friendship / cancel your own request.
create or replace function public.friend_answer(who uuid, yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare me uuid := auth.uid();
begin
  if me is null or not (select public.is_member()) then raise exception 'members only'; end if;
  if yes then
    update public.friendships f set status = 'friends', since = now(), updated_at = now()
      where f.a = least(me, who) and f.b = greatest(me, who) and f.status = 'pending' and f.requested_by = who;
  else
    update public.friendships f set status = 'ended', updated_at = now()
      where f.a = least(me, who) and f.b = greatest(me, who) and f.status <> 'ended';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.friend_answer(uuid, boolean) from public, anon;
grant execute on function public.friend_answer(uuid, boolean) to authenticated;

-- Your friends, requests to you, requests from you, and who you've blocked.
create or replace function public.my_social()
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
  return jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', p.display_name, 'character', p.character_key, 'level', p.level,
        'status', case when f.status = 'friends' then 'friends' when f.requested_by = me then 'outgoing' else 'incoming' end,
        'since', f.since, 'last_seen', o.last_sign_in_at) order by f.status desc, p.display_name)
      from public.friendships f
      cross join lateral (select case when f.a = me then f.b else f.a end as id) x
      join auth.users o on o.id = x.id
      left join public.profiles p on p.id = o.id
      where (f.a = me or f.b = me) and f.status <> 'ended'
        and not exists (select 1 from public.blocks b where b.blocker = me and b.blocked = o.id and b.active)), '[]'),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('id', b.blocked, 'name', p.display_name) order by b.updated_at desc)
      from public.blocks b left join public.profiles p on p.id = b.blocked where b.blocker = me and b.active), '[]')
  );
end;
$$;
revoke all on function public.my_social() from public, anon;
grant execute on function public.my_social() to authenticated;

-- Report someone to Diesel. `context`: what the game saw (where, their recent chat lines…). At most 10 an
-- hour from one person, so it can't be used to flood the queue.
create or replace function public.report_player(who uuid, reason text, details text default null, context jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare me uuid := auth.uid();
begin
  if me is null or not public.in_house() then raise exception 'members and guests only'; end if;
  if who is null or who = me then return jsonb_build_object('ok', false, 'why', 'not possible'); end if;
  if reason not in ('harassment', 'hate', 'spam', 'cheating', 'other') then reason := 'other'; end if;
  if (select count(*) from public.player_reports r where r.reporter = me and r.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'why', 'You’ve sent a lot of reports. Diesel will look at them; try again later.');
  end if;
  insert into public.player_reports (reporter, reported, reported_name, reason, details, context)
    values (me, who, (select p.display_name from public.profiles p where p.id = who), reason, left(nullif(trim(details), ''), 1000),
      case when pg_column_size(context) <= 16000 then context end);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.report_player(uuid, text, text, jsonb) from public, anon;
grant execute on function public.report_player(uuid, text, text, jsonb) to authenticated;

-- ---- Admin page: the report queue ----
create or replace function public.admin_reports(token text, open_only boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return coalesce((select jsonb_agg(x) from (
      select r.id, r.created_at, r.reason, r.details, r.context, r.resolved_at, r.resolved_by, r.note,
        r.reporter, rp.display_name as reporter_name, r.reported, coalesce(dp.display_name, r.reported_name) as reported_name,
        (select count(*) from public.player_reports o where o.reported = r.reported) as reported_total,
        exists (select 1 from public.banned_users b where b.user_id = r.reported and b.lifted_at is null) as reported_banned
      from public.player_reports r
      left join public.profiles rp on rp.id = r.reporter
      left join public.profiles dp on dp.id = r.reported
      where not open_only or r.resolved_at is null
      order by r.created_at desc limit 300) x), '[]');
end;
$$;

create or replace function public.admin_report_resolve(token text, ids bigint[], note text default null, reopen boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  update public.player_reports r set resolved_at = case when reopen then null else now() end,
    resolved_by = case when reopen then null else acct.username end, note = coalesce(nullif(trim(note), ''), r.note)
    where r.id = any (ids);
  perform public.admin_audit_log(acct, case when reopen then 'reopen reports' else 'resolve reports' end, array_to_string(ids, ','), jsonb_build_object('note', note));
  return jsonb_build_object('ok', true);
end;
$$;

-- The dashboard counts open player reports too.
create or replace function public.admin_overview(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare acct public.admin_accounts := public.admin_auth(token);
begin
  return jsonb_build_object(
    'members', (select count(*) from public.allowed_emails),
    'guests_now', (select count(*) from public.guest_admissions g where g.expires_at > now()),
    'banned', (select count(*) from public.banned_users b where b.lifted_at is null),
    'active_today', (select count(*) from public.profiles p where p.last_visit_date >= current_date - 1),
    'logs_open', (select count(*) from public.client_errors e where e.resolved_at is null),
    'logs_24h', (select count(*) from public.client_errors e where e.at > now() - interval '24 hours'),
    'reports_open', (select count(*) from public.client_errors e where e.kind = 'report' and e.resolved_at is null),
    'player_reports_open', (select count(*) from public.player_reports r where r.resolved_at is null),
    'games_week', (select count(*) from public.game_results r where r.created_at > now() - interval '7 days'),
    'arcade_week', (select count(*) from public.arcade_scores s where s.created_at > now() - interval '7 days'),
    'arcade_record', (select max(s.score) from public.arcade_scores s),
    'rejected_week', (select count(*) from public.arcade_runs r where r.status = 'rejected' and r.finished_at > now() - interval '7 days'),
    'xp_today', (select coalesce(sum(l.amount), 0) from public.xp_ledger l where l.created_at > now() - interval '24 hours'),
    'catches_today', (select count(*) from public.critter_catches c where c.caught_at > now() - interval '24 hours'),
    'chat_today', (select count(*) from public.messages m where m.created_at > now() - interval '24 hours'),
    'friendships', (select count(*) from public.friendships f where f.status = 'friends'),
    'logs_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select date_trunc('day', e.at)::date d, count(*) n from public.client_errors e where e.at > now() - interval '14 days' group by 1) x), '[]')
  );
end;
$$;

revoke all on function public.admin_reports(text, boolean), public.admin_report_resolve(text, bigint[], text, boolean), public.admin_overview(text) from public, anon, authenticated;
grant execute on function public.admin_reports(text, boolean), public.admin_report_resolve(text, bigint[], text, boolean), public.admin_overview(text) to service_role;
