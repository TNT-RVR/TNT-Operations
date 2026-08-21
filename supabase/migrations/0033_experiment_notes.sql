-- ── Experiment notes ─────────────────────────────────────────────────────────
--
-- Trials get run every season — a new tray density, a different release timing,
-- a chemical applied on half a quarter — and the record of them has lived in
-- phone photos, notebooks and memory. By the time anyone asks what happened,
-- the block labels are gone and nobody is certain which shelters were in it.
--
-- So: a note, written where it is observed, with the things it is about
-- attached to it. Everything except the note text is optional, because the one
-- thing that must never happen is somebody not recording an observation
-- because the form wanted a field they did not have.
--
-- The experiment itself is a TYPED NAME, not a table. What counts as an
-- experiment is not knowable in advance, most run once, and a setup screen
-- somebody must visit first is how a quick observation becomes no observation.
-- The UI offers the names already used, which is enough to keep them tidy.
create table if not exists public.experiment_notes (
  id           uuid primary key default gen_random_uuid(),
  -- Free text, e.g. "Tray density 2026". Blank is allowed: an observation
  -- without a home is still worth keeping, and can be filed later.
  experiment   text not null default '',
  -- The observation. The only thing this table really exists for.
  notes        text not null default '',
  /** When it was observed — not when it was typed, if those differ. */
  observed_at  timestamptz not null default now(),
  /** Optional field, and optional GPS taken at the time of writing. */
  field_id     uuid references public.shelter_fields(id) on delete set null,
  lat          double precision,
  lng          double precision,
  /** Reported GPS accuracy in metres, so a vague fix can be read as vague. */
  accuracy_m   double precision,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists experiment_notes_experiment_idx
  on public.experiment_notes (experiment, observed_at desc);
create index if not exists experiment_notes_observed_idx
  on public.experiment_notes (observed_at desc);

-- ── What the note is about ───────────────────────────────────────────────────
--
-- A note can name any number of blocks and trays. Kept as rows rather than an
-- array so that "which trays were in that trial" is a query rather than a
-- json-parsing exercise in two years' time.
--
-- Both the id AND the scanned label are stored. The id is the real link; the
-- label is what the crew actually read off the tag, and it survives a block
-- that was never in the system, a mis-scan worth keeping, and a tray label
-- reused between seasons. Recording only the id would silently drop every scan
-- that did not resolve — which are exactly the ones worth investigating.
create table if not exists public.experiment_note_items (
  id        uuid primary key default gen_random_uuid(),
  note_id   uuid not null references public.experiment_notes(id) on delete cascade,
  kind      text not null check (kind in ('block', 'tray')),
  /** What was scanned or typed, verbatim. Never null. */
  label     text not null,
  /** Resolved links, when the label matched something. */
  block_id  uuid references public.blocks(id) on delete set null,
  tray_id   uuid references public.trays(id) on delete set null,
  /** Where this particular item was scanned, when it differs from the note. */
  lat       double precision,
  lng       double precision,
  added_at  timestamptz not null default now()
);

create index if not exists experiment_note_items_note_idx
  on public.experiment_note_items (note_id);
create index if not exists experiment_note_items_block_idx
  on public.experiment_note_items (block_id) where block_id is not null;
create index if not exists experiment_note_items_tray_idx
  on public.experiment_note_items (tray_id) where tray_id is not null;

alter table public.experiment_notes enable row level security;
alter table public.experiment_note_items enable row level security;

drop policy if exists "read for members" on public.experiment_notes;
create policy "read for members" on public.experiment_notes
  for select using (has_access());

-- Anyone who can record field work can write one. An experiment note is an
-- observation, and the person standing in front of the thing being observed is
-- usually not an admin — requiring can_edit() here would mean the notes get
-- taken on paper instead, which is the situation this replaces.
drop policy if exists "write for field workers" on public.experiment_notes;
create policy "write for field workers" on public.experiment_notes
  for all using (can_record_field_work()) with check (can_record_field_work());

drop policy if exists "read for members" on public.experiment_note_items;
create policy "read for members" on public.experiment_note_items
  for select using (has_access());

drop policy if exists "write for field workers" on public.experiment_note_items;
create policy "write for field workers" on public.experiment_note_items
  for all using (can_record_field_work()) with check (can_record_field_work());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tnt_readonly') then
    grant select on public.experiment_notes to tnt_readonly;
    grant select on public.experiment_note_items to tnt_readonly;
    execute 'drop policy if exists tnt_readonly_select on public.experiment_notes';
    execute 'create policy tnt_readonly_select on public.experiment_notes '
         || 'for select to tnt_readonly using (true)';
    execute 'drop policy if exists tnt_readonly_select on public.experiment_note_items';
    execute 'create policy tnt_readonly_select on public.experiment_note_items '
         || 'for select to tnt_readonly using (true)';
  end if;
end
$$;
