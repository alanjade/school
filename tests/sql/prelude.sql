-- Minimal stand-ins for the Supabase platform objects the migrations expect
-- (roles, auth/storage schemas, auth.uid(), storage helpers, realtime
-- publication), so the repo migrations can be replayed on plain Postgres.
-- Used by tests/sql/run.sh. Not for a real Supabase project.

drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
drop schema if exists extensions cascade; create schema extensions;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, owner_id text, version text, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create publication supabase_realtime;
create extension if not exists pgcrypto schema extensions;
do $$ declare r text; begin foreach r in array array['supabase_auth_admin','supabase_admin','supabase_storage_admin','authenticator','dashboard_user','supabase_realtime_admin'] loop
  begin execute format('create role %I nologin', r); exception when duplicate_object then null; end; end loop; end $$;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select '' $$;
