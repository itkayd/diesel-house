-- Device logs (22 Oct 2026): what goes wrong on people's phones, with enough context to fix it without
-- anyone having to describe it. The client_errors table grows:
--   kind     error (a crash), warning (something odd the game noticed and fixed itself, e.g. a stuck
--            joystick let go), problem (a feature failed: voice, saving a score) or report (a player
--            pressed "Report a problem" and wrote what happened)
--   context  the device (screen, touch, browser, connection…) and the last few things that happened
--            (rooms walked into, taps on the joystick, pop-ups, connection changes…), as JSON
--   resolved_at / note  for the admin page: mark a log dealt with and say how.
-- Written only through report_issue() (members and guests, at most 30 an hour each, 16 kB of context);
-- read only by the admin page (server side). report_error() stays for older copies of the game.

alter table public.client_errors add column if not exists kind text not null default 'error';
alter table public.client_errors add column if not exists context jsonb;
alter table public.client_errors add column if not exists resolved_at timestamptz;
alter table public.client_errors add column if not exists note text;
do $$ begin
  alter table public.client_errors add constraint client_errors_kind_check check (kind in ('error', 'warning', 'problem', 'report'));
exception when duplicate_object then null;
end $$;
create index if not exists client_errors_kind_idx on public.client_errors (kind, at desc);

create or replace function public.report_issue(kind text, message text, stack text default null, page text default null, agent text default null, build text default null, context jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
begin
  if not ((select public.is_member()) or (select public.is_guest())) then
    return;
  end if;
  if kind not in ('error', 'warning', 'problem', 'report') then
    kind := 'error';
  end if;
  -- At most 30 an hour each (reports by hand: 5), so a broken loop can't fill the table.
  if (select count(*) from public.client_errors e where e.user_id = auth.uid() and e.at > now() - interval '1 hour') >= 30 then
    return;
  end if;
  if kind = 'report' and (select count(*) from public.client_errors e where e.user_id = auth.uid() and e.kind = 'report' and e.at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  if context is not null and pg_column_size(context) > 16000 then
    context := jsonb_build_object('truncated', true);
  end if;
  insert into public.client_errors (user_id, kind, message, stack, page, agent, build, context)
    values (auth.uid(), kind, left(coalesce(message, '?'), 1000), left(stack, 4000), left(page, 300), left(agent, 300), left(build, 60), context);
end;
$$;
revoke all on function public.report_issue(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.report_issue(text, text, text, text, text, text, jsonb) to authenticated;
