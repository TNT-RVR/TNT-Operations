-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — Users & Settings: company details, editable access, archive.
--
-- Backs the tabbed Users & Settings section. Three separate things:
--
--   app_company      one row of company facts. Currently HARDCODED in
--                    useOrderPricing.ts as TNT_PARTY, which means the vendor
--                    block on a customs document cannot be corrected without a
--                    code change. That is the bug this fixes.
--   app_role_access  sparse per-role permission overrides.
--   profiles.archived_at  soft delete, so a departed user can be hidden and
--                    signed out without destroying who did what.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- Company
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.app_company (
  -- One row, enforced. A second company would silently split the paperwork.
  id            boolean primary key default true check (id),

  legal_name    text not null default 'TNT Pollination',
  trade_name    text not null default '',
  address_lines text[] not null default '{}',
  city          text not null default '',
  region        text not null default '',
  postal_code   text not null default '',
  country       text not null default 'CA',

  -- Business Number / GST registration. Prints on the commercial invoice and
  -- the CUSMA certification.
  business_number text not null default '',
  gst_number    text not null default '',

  phone         text not null default '',
  email         text not null default '',
  website       text not null default '',

  -- Who signs a CUSMA certification by default.
  signatory_name  text not null default '',
  signatory_title text not null default '',

  updated_at    timestamptz not null default now()
);

insert into public.app_company (id) values (true) on conflict (id) do nothing;

-- Seeds what was hardcoded, so the paperwork keeps saying what it said.
update public.app_company
set legal_name = 'TNT Pollination',
    city = coalesce(nullif(city, ''), 'Grassy Lake'),
    region = coalesce(nullif(region, ''), 'AB'),
    country = coalesce(nullif(country, ''), 'CA')
where id = true;

alter table public.app_company enable row level security;
drop policy if exists "read for members" on public.app_company;
create policy "read for members" on public.app_company for select using (has_access());
drop policy if exists "write for admins" on public.app_company;
create policy "write for admins" on public.app_company
  for all using (app_role() = 'admin') with check (app_role() = 'admin');

drop trigger if exists app_company_touch_updated_at on public.app_company;
create trigger app_company_touch_updated_at before update on public.app_company
  for each row execute function public.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Editable access
-- ═══════════════════════════════════════════════════════════════════════════

-- SPARSE by design: only cells that DIFFER from the built-in matrix in
-- src/auth/session.tsx are stored. An empty table means the app behaves exactly
-- as it always did, so this can ship to a live app without changing anyone's
-- access on the day it lands.
--
-- Note what is NOT here: a check preventing admin from losing `users`. That
-- guarantee lives in src/domain/access.ts and is applied on READ, so it holds
-- even for a row written straight into Postgres. A constraint here would only
-- catch the cases the application layer already catches.
create table if not exists public.app_role_access (
  role    text not null,
  module  text not null,
  grant_level text not null check (grant_level in ('none', 'view', 'edit')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  primary key (role, module)
);

alter table public.app_role_access enable row level security;
-- Everyone reads: the session needs the overrides to decide what to render,
-- and knowing the permission table is not itself a permission.
drop policy if exists "read for members" on public.app_role_access;
create policy "read for members" on public.app_role_access for select using (has_access());
drop policy if exists "write for admins" on public.app_role_access;
create policy "write for admins" on public.app_role_access
  for all using (app_role() = 'admin') with check (app_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════
-- Archive
-- ═══════════════════════════════════════════════════════════════════════════

-- Soft delete. A departed crew member's name still appears on the inspections
-- they logged and the shelters they placed, so their profile row has to stay;
-- archiving hides them from the pickers and revokes their sessions instead.
alter table public.profiles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id) on delete set null;

create index if not exists profiles_active_idx on public.profiles (archived_at) where archived_at is null;

-- An archived user has no access, whatever their role says. Belt and braces
-- alongside revoking their session: if a token is still live, this stops it.
create or replace function public.has_access()
returns boolean
language sql
stable
as $$
  select public.app_role() in ('admin', 'developer', 'operator', 'viewer')
     and not exists (
       select 1 from public.profiles
       where id = auth.uid() and archived_at is not null
     );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Sign-in tracking
-- ═══════════════════════════════════════════════════════════════════════════

-- The "Waiting on setup" list needs to know who has never signed in.
-- `auth.users.last_sign_in_at` holds it but the auth schema is not exposed
-- through PostgREST, so it is mirrored here by a trigger on the auth table.
alter table public.profiles
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists invited_at timestamptz;

-- Backfill from auth so the list is right immediately rather than only for
-- people who sign in after this migration.
update public.profiles p
set last_sign_in_at = u.last_sign_in_at,
    invited_at = coalesce(p.invited_at, u.created_at)
from auth.users u
where u.id = p.id;

create or replace function public.fn_sync_last_sign_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set last_sign_in_at = new.last_sign_in_at
  where id = new.id;
  return new;
end $$;

drop trigger if exists sync_last_sign_in on auth.users;
create trigger sync_last_sign_in after update of last_sign_in_at on auth.users
  for each row execute function public.fn_sync_last_sign_in();

-- Stamp invited_at when a profile is created, so "invited 26 days ago" has a
-- source that survives even if the auth row is later touched.
create or replace function public.fn_stamp_invited_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.invited_at is null then new.invited_at := now(); end if;
  return new;
end $$;

drop trigger if exists stamp_invited_at on public.profiles;
create trigger stamp_invited_at before insert on public.profiles
  for each row execute function public.fn_stamp_invited_at();
