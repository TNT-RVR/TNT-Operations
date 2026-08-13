-- ── What a crew is working on ────────────────────────────────────────────────
--
-- Numbered 0027 after the fact: this and 0026 were written as 0023/0024 and
-- collided with the calendar work landing in parallel. Both were applied to
-- production under the old numbers; the contents are unchanged.
--
-- Until now "what is Crew 2 doing?" was inferred from whichever screen the
-- crew's iPad happened to have open, and only while it was broadcasting. Put
-- the iPad down, open the Crews view to look at someone else, or lose signal,
-- and the crew appeared to stop working.
--
-- An assignment is a fact that outlives all of that: it survives a locked
-- screen, a closed app, and a dead battery, and it can be set the night before
-- rather than discovered at 7am.
alter table public.field_crews
  add column if not exists current_field_id uuid references public.shelter_fields(id) on delete set null,
  add column if not exists current_task     text check (current_task in ('shelter', 'tray')),
  add column if not exists assigned_at      timestamptz;

comment on column public.field_crews.current_field_id is
  'The field this crew is working. Null = not assigned.';
comment on column public.field_crews.current_task is
  'shelter | tray — which job. Null = not assigned.';

-- ── Whose work is it? ────────────────────────────────────────────────────────
--
-- Progress counted "shelters placed in this field this season" is the FIELD's
-- progress, not a crew's. Two crews in one quarter both read as having done
-- all of it. Stamping the crew on each row is what makes per-crew progress —
-- and end-of-season per-crew reporting — possible at all.
--
-- Nullable everywhere: work done before this existed, and by anyone not on a
-- crew, is not wrong. Null means "not recorded", never "no crew".
alter table public.placed_shelters
  add column if not exists crew_id uuid references public.field_crews(id) on delete set null;

alter table public.shelter_tray_links
  add column if not exists crew_id uuid references public.field_crews(id) on delete set null;

alter table public.block_placements
  add column if not exists crew_id uuid references public.field_crews(id) on delete set null;

create index if not exists placed_shelters_crew_idx on public.placed_shelters (crew_id) where crew_id is not null;
create index if not exists shelter_tray_links_crew_idx on public.shelter_tray_links (crew_id) where crew_id is not null;
create index if not exists block_placements_crew_idx on public.block_placements (crew_id) where crew_id is not null;
