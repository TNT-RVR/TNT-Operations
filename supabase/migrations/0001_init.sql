-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — Phase 3: schema, roles, RLS.
-- Run once in the Supabase SQL editor, or `supabase db push`. Re-runnable:
-- guarded with if-not-exists / drop-if-exists throughout.
--
-- Data model mirrors src/data/types.ts (Field, Incubator, Inspection,
-- SensorReading) so SupabaseProvider maps rows 1:1 to the app types. Roles +
-- access mirror src/auth/session.tsx (admin/developer/operator/viewer + the
-- MODULES matrix): everyone signed in can VIEW; only admin/developer/operator
-- can WRITE operational data; only admin/developer manage users.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- ── Roles ─────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.app_role as enum ('admin', 'developer', 'operator', 'viewer');
exception when duplicate_object then null; end $$;

-- ── profiles: one row per auth user, carrying their app role. ──────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  email       text not null default '',
  role        public.app_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

-- New auth users get a profile automatically (default role = viewer; an admin
-- promotes them later in the Users screen). SECURITY DEFINER so the insert
-- bypasses RLS on profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role lookups for policies. SECURITY DEFINER so reading profiles here does NOT
-- recurse into profiles' own RLS policies.
create or replace function public.app_role()
returns public.app_role
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.can_edit()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'developer', 'operator');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'developer');
$$;

-- ── Operational tables (columns match src/data/types.ts) ──────────────────────

-- Field summary + full authoring payload. The typed columns satisfy the current
-- `Field` seam; `data` (jsonb) carries the complete field dict the shelter-grid
-- engine consumes (boundary, pivot, bay params, tracks…) for the Phase 4/5 editor.
-- NAMED `shelter_fields` (not `fields`) so it coexists with the old beetent-maps
-- app's differently-shaped `public.fields` table in this shared project.
create table if not exists public.shelter_fields (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client        text not null default '',
  region        text not null default '',
  shape_type    text not null default 'pivot' check (shape_type in ('pivot', 'polygon')),
  shelter_count integer not null default 0,
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
create index if not exists shelter_fields_client_idx on public.shelter_fields (client);

create table if not exists public.incubators (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  location            text not null default '',
  status              text not null default 'idle' check (status in ('active', 'idle')),
  started_at          timestamptz,
  temp_target_c       numeric not null default 30,
  humidity_target_pct numeric not null default 55
);

create table if not exists public.inspections (
  id            uuid primary key default gen_random_uuid(),
  incubator_id  uuid not null references public.incubators (id) on delete cascade,
  at            timestamptz not null default now(),
  inspector     text not null default '',
  health_score  integer not null default 0 check (health_score between 0 and 100),
  notes         text not null default ''
);
create index if not exists inspections_incubator_idx on public.inspections (incubator_id, at desc);

create table if not exists public.sensor_readings (
  id            uuid primary key default gen_random_uuid(),
  incubator_id  uuid not null references public.incubators (id) on delete cascade,
  at            timestamptz not null default now(),
  temp_c        numeric not null,
  humidity_pct  numeric not null,
  source        text not null check (source in ('govee', 'esp32'))
);
create index if not exists sensor_readings_incubator_idx on public.sensor_readings (incubator_id, at desc);

-- ── updated_at trigger for shelter_fields ────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists shelter_fields_touch_updated_at on public.shelter_fields;
create trigger shelter_fields_touch_updated_at
  before update on public.shelter_fields
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Operational tables: any signed-in user may SELECT (all roles have at least
-- 'view'); writes require can_edit() (admin/developer/operator). Sensor readings
-- are normally written by Edge Functions via the service role (bypasses RLS);
-- the write policy also lets an operator add a manual reading.
alter table public.shelter_fields  enable row level security;
alter table public.incubators      enable row level security;
alter table public.inspections     enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.profiles        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['shelter_fields', 'incubators', 'inspections', 'sensor_readings'] loop
    execute format('drop policy if exists "read for authenticated" on public.%I;', t);
    execute format(
      'create policy "read for authenticated" on public.%I for select to authenticated using (true);', t);

    execute format('drop policy if exists "insert for editors" on public.%I;', t);
    execute format(
      'create policy "insert for editors" on public.%I for insert to authenticated with check (public.can_edit());', t);

    execute format('drop policy if exists "update for editors" on public.%I;', t);
    execute format(
      'create policy "update for editors" on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit());', t);

    execute format('drop policy if exists "delete for editors" on public.%I;', t);
    execute format(
      'create policy "delete for editors" on public.%I for delete to authenticated using (public.can_edit());', t);
  end loop;
end $$;

-- profiles: a user always sees their OWN profile (the app reads its role/name);
-- admin/developer see and manage everyone (the Users screen).
drop policy if exists "profiles self or admin read" on public.profiles;
create policy "profiles self or admin read" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles admin insert" on public.profiles;
create policy "profiles admin insert" on public.profiles
  for insert to authenticated with check (public.is_admin());

-- A user may edit their own name; admins may edit anyone (incl. role changes).
drop policy if exists "profiles self or admin update" on public.profiles;
create policy "profiles self or admin update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles admin delete" on public.profiles;
create policy "profiles admin delete" on public.profiles
  for delete to authenticated using (public.is_admin());

-- ── Realtime: stream live sensor readings (and inspections) to the web app. ───
do $$
declare t text;
begin
  foreach t in array array['sensor_readings', 'inspections'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
