-- ── Scheduling a crew onto a job ─────────────────────────────────────────────
--
-- A calendar event can already name a field. This lets it name WHO and WHAT:
-- "Crew 2, shelters, Bow Island, Thursday". The field views then read the
-- schedule instead of asking a crew to pick a field on the morning, and the
-- supplies list is computed from the same row.
--
-- Both nullable — most events are a delivery or a meeting, not a crew job.
alter table public.calendar_events
  add column if not exists crew_id uuid references public.field_crews(id) on delete set null,
  add column if not exists task    text check (task in ('shelter', 'tray'));

create index if not exists calendar_events_crew_idx
  on public.calendar_events (crew_id, start_date) where crew_id is not null;
