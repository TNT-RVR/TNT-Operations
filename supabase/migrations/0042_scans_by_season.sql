-- Attribute crew work to a SEASON, not just to a field.
--
-- ── The problem ──────────────────────────────────────────────────────────────
--
-- Block placements, shelter scans, work-order events and experiment notes all
-- carry `field_id` into `shelter_fields` — a table that holds one season at a
-- time. So two seasons of the same field share one row, and the only thing
-- telling 2026's placements from 2027's is the date on each one. That is fine
-- until a field is dropped for a year and picked up again, or until anyone asks
-- "how did this field do in 2026" and has to reconstruct the answer from
-- timestamps.
--
-- ── The approach: add, backfill, and TRIGGER — do not rewrite ────────────────
--
-- `field_id` stays. Dropping it would break every read path at once and remove
-- any way back, and there are 2,000+ placements being written by crews as this
-- runs. So each table gains a nullable `field_season_id`, existing rows are
-- backfilled, and a trigger fills it in from `field_id` plus the row's own date
-- on every insert and update.
--
-- The trigger is the point. Editing each write path in the app would mean
-- finding them all — and a path that was missed writes a row with no season and
-- nobody notices until a report is short. The database is the one place every
-- write must pass through.
--
-- All existing rows are 2026 (checked: earliest 2026-08-07), and every 2026
-- field has a season, so the backfill is total rather than partial.

-- ── The column, per table ────────────────────────────────────────────────────
alter table public.block_placements
  add column if not exists field_season_id uuid references public.field_seasons (id) on delete set null;
alter table public.placed_shelters
  add column if not exists field_season_id uuid references public.field_seasons (id) on delete set null;
alter table public.calendar_events
  add column if not exists field_season_id uuid references public.field_seasons (id) on delete set null;
alter table public.experiment_notes
  add column if not exists field_season_id uuid references public.field_seasons (id) on delete set null;

create index if not exists block_placements_season_idx on public.block_placements (field_season_id);
create index if not exists placed_shelters_season_idx on public.placed_shelters (field_season_id);
create index if not exists calendar_events_season_idx on public.calendar_events (field_season_id);
create index if not exists experiment_notes_season_idx on public.experiment_notes (field_season_id);

-- ── Which season a row belongs to ────────────────────────────────────────────
--
-- The field's season for the YEAR THE WORK HAPPENED. A row dated in a year that
-- has no season yet resolves to null rather than to the nearest season: a
-- placement quietly attributed to the wrong year is worse than one attributed
-- to none, because it would be counted.
create or replace function public.fn_season_for(p_field_id uuid, p_when timestamptz)
returns uuid
language sql stable as $$
  select fs.id
  from public.field_seasons fs
  where fs.shelter_field_id = p_field_id
    and fs.year = to_char(coalesce(p_when, now()) at time zone 'America/Edmonton', 'YYYY')
  limit 1
$$;

comment on function public.fn_season_for is
  'The field_seasons row for a map field in the year some work happened. Edmonton time: a placement made at 6pm on 31 December is that year''s work, not the next one''s.';

-- ── Keep it filled, on every write ───────────────────────────────────────────
create or replace function public.fn_stamp_block_placement_season() returns trigger
language plpgsql as $$
begin
  if new.field_season_id is null and new.field_id is not null then
    new.field_season_id := public.fn_season_for(new.field_id, new.placed_at);
  end if;
  return new;
end $$;

drop trigger if exists block_placements_season on public.block_placements;
create trigger block_placements_season before insert or update on public.block_placements
  for each row execute function public.fn_stamp_block_placement_season();

create or replace function public.fn_stamp_placed_shelter_season() returns trigger
language plpgsql as $$
begin
  if new.field_season_id is null and new.field_id is not null then
    new.field_season_id := public.fn_season_for(new.field_id, new.placed_at);
  end if;
  return new;
end $$;

drop trigger if exists placed_shelters_season on public.placed_shelters;
create trigger placed_shelters_season before insert or update on public.placed_shelters
  for each row execute function public.fn_stamp_placed_shelter_season();

create or replace function public.fn_stamp_calendar_event_season() returns trigger
language plpgsql as $$
begin
  if new.field_season_id is null and new.field_id is not null then
    -- start_date is a date, not a timestamp: cast so the lookup gets a moment.
    new.field_season_id := public.fn_season_for(new.field_id, new.start_date::timestamptz);
  end if;
  return new;
end $$;

drop trigger if exists calendar_events_season on public.calendar_events;
create trigger calendar_events_season before insert or update on public.calendar_events
  for each row execute function public.fn_stamp_calendar_event_season();

create or replace function public.fn_stamp_experiment_note_season() returns trigger
language plpgsql as $$
begin
  if new.field_season_id is null and new.field_id is not null then
    new.field_season_id := public.fn_season_for(new.field_id, coalesce(new.observed_at, new.created_at));
  end if;
  return new;
end $$;

drop trigger if exists experiment_notes_season on public.experiment_notes;
create trigger experiment_notes_season before insert or update on public.experiment_notes
  for each row execute function public.fn_stamp_experiment_note_season();

-- ── Backfill what is already there ───────────────────────────────────────────
update public.block_placements p
   set field_season_id = public.fn_season_for(p.field_id, p.placed_at)
 where p.field_season_id is null and p.field_id is not null;

update public.placed_shelters s
   set field_season_id = public.fn_season_for(s.field_id, s.placed_at)
 where s.field_season_id is null and s.field_id is not null;

update public.calendar_events e
   set field_season_id = public.fn_season_for(e.field_id, e.start_date::timestamptz)
 where e.field_season_id is null and e.field_id is not null;

update public.experiment_notes n
   set field_season_id = public.fn_season_for(n.field_id, coalesce(n.observed_at, n.created_at))
 where n.field_season_id is null and n.field_id is not null;
