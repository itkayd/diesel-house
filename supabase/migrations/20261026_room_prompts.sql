-- UPDATE.md Phase 13: room owners can add their own Hot Takes / Would You Rather prompts.
-- Already applied on the live database (16 Oct 22:52, version 20261016225241); this file brings the repo in line.
-- Each prompt is "option A|option B", at most 200 characters, at most 50 per room. Only the owner can
-- update their room (existing rooms RLS), so only they can change the list.

create or replace function public.prompts_ok(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_length(p, 1), 0) <= 50
    and not exists (select 1 from unnest(p) x where char_length(x) > 200 or x !~ '^[^|]+\|[^|]+$');
$$;

alter table public.rooms add column prompts text[] check (public.prompts_ok(prompts));
