-- Paste into Supabase → SQL Editor → Run (22 Oct 2026). The three admin functions that delete things:
-- "Remove" on a Night Raid score, "Clear resolved older than 30 days" on Device logs, and the daily tidy of
-- old admin sign-ins. They're in supabase/migrations/20261112_admin.sql too; Supabase asks a person to
-- approve anything with a delete in it, so they're here to run by hand. Safe to run more than once.
create or replace function public.admin_tidy()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.admin_login_attempts a where a.at < now() - interval '30 days';
  delete from public.admin_sessions s where s.expires_at < now() - interval '30 days';
$$;

create or replace function public.admin_score_delete(token text, score_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  s public.arcade_scores;
begin
  select * into s from public.arcade_scores a where a.id = score_id;
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'No such score.'); end if;
  delete from public.arcade_scores a where a.id = score_id;
  if s.xp > 0 then
    update public.profiles p set xp = greatest(0, p.xp - s.xp), level = public.level_for_xp(greatest(0, p.xp - s.xp)) where p.id = s.user_id;
    insert into public.xp_ledger (user_id, amount, reason) values (s.user_id, -s.xp, 'admin: score removed');
  end if;
  perform public.admin_audit_log(acct, 'delete score', score_id::text, to_jsonb(s));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_logs_clear(token text, older_than_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  acct public.admin_accounts := public.admin_auth(token);
  n integer;
begin
  delete from public.client_errors e where e.resolved_at is not null and e.at < now() - make_interval(days => greatest(older_than_days, 1));
  get diagnostics n = row_count;
  perform public.admin_audit_log(acct, 'clear logs', older_than_days::text, jsonb_build_object('deleted', n));
  return jsonb_build_object('ok', true, 'deleted', n);
end;
$$;

revoke all on function public.admin_tidy(), public.admin_score_delete(text, bigint), public.admin_logs_clear(text, integer) from public, anon, authenticated;
grant execute on function public.admin_tidy(), public.admin_score_delete(text, bigint), public.admin_logs_clear(text, integer) to service_role;
