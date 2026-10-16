-- Indexes for foreign keys the database advisor flagged (lookups and deletes of members and guests).
create index if not exists guest_admissions_invited_by_idx on public.guest_admissions (invited_by);
create index if not exists invite_codes_used_by_idx on public.invite_codes (used_by);
create index if not exists rooms_owner_id_idx on public.rooms (owner_id);
