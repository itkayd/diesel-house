-- Guest codes can't be guessed (20261117): 8 wrong codes per 15 minutes per visitor, then codes aren't
-- checked. Uses Amy from social_test.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'PASS: %', what;
end $$;
create or replace function pg_temp.visitor(who uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', who::text, false),
         set_config('request.jwt.claims', json_build_object('sub', who, 'is_anonymous', true)::text, false);
$$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', null), ('00000000-0000-0000-0000-0000000000f2', null) on conflict do nothing;
insert into public.guest_codes (owner_id, code) values ('00000000-0000-0000-0000-0000000000b1', 'ABCD-2345')
  on conflict (owner_id) do update set code = excluded.code, enabled = true, open_house = false;
update public.guest_codes set open_house = false;
set client_min_messages = notice;

set role authenticated;
select pg_temp.visitor('00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok(not public.admit_guest('WXYZ-' || lpad(i::text, 4, '2')), 'wrong code ' || i || ' is refused') from generate_series(1, 8) i;
select pg_temp.ok(not public.admit_guest('ABCD-2345'), 'after 8 wrong codes even the right one waits');
select pg_temp.visitor('00000000-0000-0000-0000-0000000000f2');
select pg_temp.ok(public.admit_guest('abcd 2345'), 'another visitor with the right code gets in');
reset role;
