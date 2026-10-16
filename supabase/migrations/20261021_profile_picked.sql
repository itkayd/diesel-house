-- New members get the character picker on their first visit: joining makes their profile (their name is
-- needed straight away) but marks it as not picked yet. Hanoon and D joined before this and never got to
-- choose, so they get the picker next time too.
alter table public.profiles add column picked boolean not null default true;
update public.profiles set picked = false where character_index = 0 and display_name in ('Hanoon', 'D');
