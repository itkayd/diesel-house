-- Just enough of Supabase for the migrations to run on a plain local Postgres (supabase/tests/run.sh):
-- the API roles, auth.users + auth.uid() (who's "signed in" comes from a setting), and realtime stubs.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions; -- where Supabase keeps it
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}'
);
grant select on auth.users to service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;

create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;
create table if not exists realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text, private boolean, inserted_at timestamptz default now());
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

create schema if not exists extensions;
