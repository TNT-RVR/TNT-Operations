-- ── When each incubator's temperature setting changed ────────────────────────
--
-- `incubators.temp_mode` holds only what an incubator is set to RIGHT NOW.
-- Nothing recorded the moment it moved from cool storage to incubation, or the
-- day someone dropped it to holding — so "when did we turn 3 on?" could only be
-- answered by inferring it from the measured temperature.
--
-- That inference is genuinely useful and stays (the report keeps it, for the
-- years that predate this table). But it can only ever say what the chamber
-- HELD, not what a person SET, and it cannot see a change that never moved the
-- temperature — off → cool storage on an already-cold chamber looks like
-- nothing happened. This table records the act itself.
--
-- ── Why a trigger and not an app-side insert ─────────────────────────────────
--
-- `temp_mode` is written from more than one place: the incubator modal, and
-- potentially anything operating on the row directly (a fix applied in the SQL
-- editor, a future script). An app-side log captures only the writer that
-- remembers to call it, and the ones it misses are exactly the unusual events
-- most worth having a record of. A trigger cannot be forgotten.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.incubator_mode_events (
  id            uuid primary key default gen_random_uuid(),
  incubator_id  uuid not null references public.incubators(id) on delete cascade,
  -- Null `from_mode` means this is the first record for the incubator (its
  -- creation, or the backfill below) rather than a change from something.
  from_mode     text,
  to_mode       text not null,
  changed_at    timestamptz not null default now(),
  -- Who did it, when the change came through an authenticated session. Null for
  -- a change made with the service key or directly in SQL — recorded honestly
  -- as "we do not know" rather than attributed to nobody in particular.
  changed_by    uuid references auth.users(id) on delete set null,
  -- True for the seed row written below when logging began. Its changed_at is
  -- the moment we STARTED recording, not the moment the mode was set.
  backfilled    boolean not null default false,
  note          text
);

-- Separate from the create, so re-running this on a database that already has
-- the table (an earlier draft, a partial apply) adds the column rather than
-- silently skipping it.
alter table public.incubator_mode_events
  add column if not exists backfilled boolean not null default false;

comment on table public.incubator_mode_events is
  'Append-only log of temperature-setting changes. Written by a trigger on incubators.temp_mode.';
comment on column public.incubator_mode_events.backfilled is
  'True for the seed row written when logging began. Its changed_at is when we started recording, NOT when the mode was set.';

create index if not exists incubator_mode_events_inc_at_idx
  on public.incubator_mode_events (incubator_id, changed_at desc);

-- ── The trigger ──────────────────────────────────────────────────────────────

create or replace function public.log_incubator_mode_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- INSERT records the starting mode; UPDATE records only a real change.
  if tg_op = 'INSERT' then
    insert into public.incubator_mode_events (incubator_id, from_mode, to_mode, changed_by)
    values (new.id, null, new.temp_mode, auth.uid());
    return new;
  end if;

  -- `is distinct from` rather than <>, so a null on either side still counts.
  if new.temp_mode is distinct from old.temp_mode then
    insert into public.incubator_mode_events (incubator_id, from_mode, to_mode, changed_by)
    values (new.id, old.temp_mode, new.temp_mode, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists incubators_log_mode_change on public.incubators;
create trigger incubators_log_mode_change
  after insert or update of temp_mode on public.incubators
  for each row execute function public.log_incubator_mode_change();

-- ── Seed the log with where each incubator stands today ──────────────────────
--
-- One row per incubator recording its CURRENT mode, so the log is never empty
-- and the first real change has something to be a change from.
--
-- These carry `backfilled = true` and today's timestamp, which is NOT a claim
-- that the chamber was set this morning — it is the moment logging began, and
-- the true date is unknown. The report marks them as such and keeps reading
-- everything earlier from the measured temperature. (`incubators` has no
-- created_at to borrow a better date from; inventing one would be worse than
-- saying plainly that we do not know.)
insert into public.incubator_mode_events (incubator_id, from_mode, to_mode, backfilled, note)
select i.id, null, i.temp_mode, true,
       'Mode on the day logging began. The date it was actually set is not recorded.'
from public.incubators i
where not exists (
  select 1 from public.incubator_mode_events e where e.incubator_id = i.id
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Readable by anyone with incubation access; NOT writable from the client at
-- all. The trigger is SECURITY DEFINER and does the inserting, so a log entry
-- can only come from a real change to the incubator — nobody can write history
-- that did not happen, or erase a change they would rather not have made.
alter table public.incubator_mode_events enable row level security;

drop policy if exists "read for members" on public.incubator_mode_events;
create policy "read for members" on public.incubator_mode_events
  for select using (has_access());

revoke insert, update, delete on public.incubator_mode_events from anon, authenticated;
