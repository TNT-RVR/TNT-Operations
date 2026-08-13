-- ── Crews ────────────────────────────────────────────────────────────────────
--
-- Numbered 0026 after the fact — written as 0023, collided with the calendar
-- feed work. Already applied to production under the old number; unchanged.
--
-- NAMED `field_crews`, not `crews`. The old desktop app already owns
-- `public.field_crews` — a GPS position log with lat/lon/course/sats — and CLAUDE.md
-- is explicit that its tables are never dropped or altered. A `create table if
-- not exists public.field_crews` silently does NOTHING against it and then every
-- index and policy below fails against the wrong shape, which is exactly how
-- this was found.
--
-- A crew is a group of people working a field together, not a device and not a
-- person. Two or three accounts at a time, and the membership changes through
-- the day as people get moved around — so membership is its own table with
-- history, NOT a column on `profiles`. "Who was on which crew last Tuesday" is
-- a question that gets asked after the fact, and a single mutable column
-- cannot answer it.
--
-- Each crew has a LEAD, normally the crew's iPad signed in to its own account.
-- The lead's GPS is what marks where the crew is: several phones in one truck
-- reporting slightly different positions is noise, and the iPad is the device
-- that stays with the vehicle rather than going up a ladder in someone's
-- pocket.
--
-- Individual phones still scan as themselves. The crew is who you are WITH,
-- not who does the work.

create table if not exists public.field_crews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Crews are per-season: "Crew 1" in 2027 is a different group of people to
  -- "Crew 1" in 2026, and reporting must not merge them.
  season      integer not null default extract(year from now()),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

create unique index if not exists field_crews_name_season_uidx on public.field_crews (lower(name), season);

create table if not exists public.field_crew_members (
  id         uuid primary key default gen_random_uuid(),
  crew_id    uuid not null references public.field_crews(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- 'lead' is the device whose GPS speaks for the crew. Exactly one at a time,
  -- enforced by the partial index below.
  role       text not null default 'member' check (role in ('lead', 'member')),
  joined_at  timestamptz not null default now(),
  -- Null = still on the crew. Leaving is a timestamp, not a delete, so the
  -- history above survives.
  left_at    timestamptz
);

-- One active membership per person: someone cannot be on two crews at once,
-- and joining a second crew has to mean leaving the first.
create unique index if not exists field_crew_members_one_active_uidx
  on public.field_crew_members (user_id)
  where left_at is null;

-- One lead per crew.
create unique index if not exists field_crew_members_one_lead_uidx
  on public.field_crew_members (crew_id)
  where left_at is null and role = 'lead';

create index if not exists field_crew_members_crew_idx on public.field_crew_members (crew_id) where left_at is null;

alter table public.field_crews enable row level security;
alter table public.field_crew_members enable row level security;

do $$
declare t text;
begin
  foreach t in array array['field_crews', 'field_crew_members'] loop
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    -- Joining and leaving is ordinary field work, not administration: a crew
    -- reshuffling at 6am cannot wait for an admin to press a button.
    execute format('drop policy if exists "write for members" on public.%I;', t);
    execute format(
      'create policy "write for members" on public.%I for all using (has_access()) with check (has_access());', t);
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tnt_readonly') then
    grant select on public.field_crews, public.field_crew_members to tnt_readonly;
  end if;
end
$$;
