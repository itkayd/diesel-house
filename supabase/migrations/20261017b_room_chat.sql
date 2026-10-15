-- Phase 7: room chat for everyone the door lets in (members and invited guests).
-- Guests have no profile, so each message carries its author's name and character. For members the
-- database fills these in from their profile (nobody can post as someone else); guests' names are marked
-- as guests. Reading and posting follow the door: public.can_enter_room(room).

alter table public.messages drop constraint messages_author_id_fkey;
alter table public.messages add constraint messages_author_id_fkey foreign key (author_id) references auth.users(id) on delete cascade;
alter table public.messages
  add column author_name text not null default '' check (char_length(author_name) <= 24),
  add column author_character smallint not null default 0 check (author_character between 0 and 19),
  add column author_guest boolean not null default false;

create or replace function public.messages_fill_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  new.author_id := auth.uid();
  new.created_at := now();
  select display_name, character_index into p from public.profiles where id = new.author_id;
  if found then
    new.author_name := p.display_name;
    new.author_character := p.character_index;
    new.author_guest := false;
  else
    new.author_guest := true;
    new.author_name := left(coalesce(nullif(btrim(new.author_name), ''), 'Guest'), 24);
  end if;
  return new;
end;
$$;
revoke all on function public.messages_fill_author() from public, anon, authenticated;
create trigger messages_fill_author before insert on public.messages
for each row execute function public.messages_fill_author();

drop policy if exists "members read messages" on public.messages;
drop policy if exists "members post as themselves" on public.messages;
create policy "people the door lets in read the chat" on public.messages
  for select to authenticated using ((select public.can_enter_room(room_id)));
create policy "people the door lets in post" on public.messages
  for insert to authenticated with check (author_id = (select auth.uid()) and (select public.can_enter_room(room_id)));
-- "authors delete own messages" stays as it was.

alter table public.reactions drop constraint reactions_author_id_fkey;
alter table public.reactions add constraint reactions_author_id_fkey foreign key (author_id) references auth.users(id) on delete cascade;
drop policy if exists "members read reactions" on public.reactions;
drop policy if exists "members react as themselves" on public.reactions;
create policy "people who can see the message see its reactions" on public.reactions
  for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and (select public.can_enter_room(m.room_id))));
create policy "people who can see the message react" on public.reactions
  for insert to authenticated
  with check (author_id = (select auth.uid())
              and exists (select 1 from public.messages m where m.id = message_id and (select public.can_enter_room(m.room_id))));
-- "authors remove own reactions" stays as it was.

-- Deletes reach other screens with the old row's id (needed for live removal).
alter table public.messages replica identity full;
alter table public.reactions replica identity full;
