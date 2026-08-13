-- ── Calendar events ──────────────────────────────────────────────────────────
--
-- The calendar has only ever shown INCUBATION MILESTONES, which are derived:
-- computed from each run's start date, never stored, and impossible to add to.
-- So anything else the operation has to remember — a sprayer booking, a
-- delivery, a crew start date, a meeting — lived somewhere else entirely.
--
-- These are the opposite: written by people, editable, and independent of any
-- incubator. The two are shown together and stay separate underneath, because
-- a derived milestone must not be editable and a typed event must not vanish
-- when a run's start date moves.
--
-- All-day by default. Farm work is planned in days, not appointments; a start
-- time is there when someone wants it and null the rest of the time.
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  -- Local calendar dates (YYYY-MM-DD), not timestamps: an event on the 14th is
  -- on the 14th regardless of who is looking or what timezone their phone
  -- thinks it is in. The operation runs in one place.
  start_date  date not null,
  end_date    date,
  -- Optional clock time, as text (HH:MM). Null = all day.
  start_time  text,
  notes       text not null default '',
  -- A loose grouping the UI colours by: 'field', 'shop', 'delivery', 'meeting'
  -- or anything else someone types. Deliberately not an enum — the categories
  -- people actually use are not knowable in advance, and a CHECK constraint
  -- would mean a migration every time the answer changed.
  category    text not null default '',
  /** Optional links, so an event can be about a field or an incubator. */
  field_id     uuid references public.shelter_fields(id) on delete set null,
  incubator_id uuid references public.incubators(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists calendar_events_start_idx on public.calendar_events (start_date);

alter table public.calendar_events enable row level security;

drop policy if exists "read for members" on public.calendar_events;
create policy "read for members" on public.calendar_events
  for select using (has_access());

-- Editors write. A calendar everyone can edit is a calendar nobody trusts, and
-- `can_edit()` is already the line this app draws for operational data.
drop policy if exists "write for editors" on public.calendar_events;
create policy "write for editors" on public.calendar_events
  for all using (can_edit()) with check (can_edit());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tnt_readonly') then
    grant select on public.calendar_events to tnt_readonly;
  end if;
end
$$;
