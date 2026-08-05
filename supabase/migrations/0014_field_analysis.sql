-- Season analysis: one row per field per season, for after-harvest analysis.
--
-- Ported from the "Leaf Bee Insights" Base44 app, which read a hand-maintained
-- season spreadsheet (CSV upload) and drew correlations over it. 157 rows,
-- 2020–2025. This is DERIVED/REPORTING data — it is not what the crews or the
-- maps engine run on, and nothing writes to it mid-season.
--
-- Two deliberate departures from the Base44 schema:
--
--  1. NUMERICS ARE NUMERIC. Base44 typed almost every metric `string` because
--     the source CSV carries "69.52%" and "-", so each of its panels re-parsed
--     with parseFloat(String(raw).replace('%','')) at render time. Percent
--     columns here are numeric in PERCENT UNITS (0–100, so 69.52 means 69.52%)
--     and blanks are NULL. Note the contrast with samples.xray_live_pct, whose
--     fraction-vs-percent convention is still unconfirmed — this table has no
--     such ambiguity, by construction.
--
--  2. IT LINKS BACK. `shelter_field_id` optionally ties a season row to the
--     real field in shelter_fields. The two data sets descend from the same
--     spreadsheet — num_structures, shelters_per_acre, male_row_spacing,
--     female_row_spacing, male_rows, female_rows, sprayer_width, seeding_angle
--     and planting_pattern are the SAME key names the tent-grid engine consumes
--     (see src/domain/tentGrid.ts, which even reads '# of Structures' as a
--     fallback header). Left NULL where no confident match exists; the link is
--     for cross-referencing, never a source of truth for placement.
--
-- The natural key is (field_name, year) — verified unique across all 157
-- exported rows. A season is re-imported by upserting on it.

create table if not exists public.field_analysis (
  id                uuid primary key default gen_random_uuid(),

  -- ── Identity ────────────────────────────────────────────────────────────
  -- Usually an LLD-style description, e.g. 'Stolk N half SW 34-10-15'.
  field_name        text not null,
  -- Season. Text, not integer: it mirrors the spreadsheet column and is only
  -- ever grouped/filtered on, never arithmetic.
  year              text not null,
  company           text not null default '',
  crop              text not null default '',
  -- The seed company's own field number, e.g. '1158-46'. Not our id.
  field_id          text not null default '',
  variety_code      text not null default '',
  farmer_name       text not null default '',

  -- Best-effort tie to the operational field. Nullable on purpose: 9 of 157
  -- rows have no coordinates at all, and names drift between seasons.
  shelter_field_id  uuid references public.shelter_fields(id) on delete set null,

  -- ── Field / operation ───────────────────────────────────────────────────
  acres             numeric,
  lat               double precision,
  lng               double precision,
  planting_pattern  text not null default '',
  male_row_spacing  numeric,
  female_row_spacing numeric,
  male_rows         numeric,
  female_rows       numeric,
  shelters_per_acre numeric,
  num_structures    numeric,
  blocks_per_shelter numeric,
  sprayer_width     numeric,
  seeding_angle     numeric,

  -- ── Bee logistics ───────────────────────────────────────────────────────
  gallons_put_out   numeric,
  gallons_returned  numeric,
  gals_per_acre     numeric,
  pounds            numeric,
  -- gallons_returned / gallons_put_out, as recorded. Kept as given rather than
  -- recomputed — the spreadsheet is the record of what was actually observed.
  percent_return    numeric,
  live_count        numeric,

  -- ── X-ray grading (percent units, 0–100) ────────────────────────────────
  live_prepupae     numeric,
  immature_larvae   numeric,
  dead_prepupae     numeric,
  dead_larvae       numeric,
  pollen_balls      numeric,
  second_generation numeric,
  predators_and_pests numeric,
  parasites         numeric,
  chalkbrood_sporulating numeric,
  chalkbrood_non_sporulating numeric,
  machine_damage    numeric,
  sex_ratio_test_viability numeric,
  percent_female    numeric,
  percent_male      numeric,

  -- ── Timeline ────────────────────────────────────────────────────────────
  seeding_date          date,
  predicted_flower_date date,
  actual_bee_release    date,
  bees_brought_back_in  date,

  -- ── Outcome ─────────────────────────────────────────────────────────────
  -- Sparse: only 33 of 157 rows carry yield. Any correlation against these
  -- runs on a much smaller n than the rest of the table — the UI must show n
  -- rather than imply the full data set. See src/domain/stats.ts MIN_N.
  clean_weight_yield numeric,
  yield_per_acre     numeric,
  avg_for_variety    numeric,

  -- ── Analysis exclusions ─────────────────────────────────────────────────
  -- Seasons ruined by weather, mis-recorded, or deliberately non-standard.
  -- Excluded from correlations by default via the settings toggles.
  hail_damage       boolean not null default false,
  bad_recording     boolean not null default false,
  experimental      boolean not null default false,

  notes             text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- One row per field per season. Re-importing a season upserts on this.
  unique (field_name, year)
);

create index if not exists field_analysis_year_idx    on public.field_analysis (year);
create index if not exists field_analysis_company_idx on public.field_analysis (company);
create index if not exists field_analysis_crop_idx    on public.field_analysis (crop);
create index if not exists field_analysis_field_idx   on public.field_analysis (shelter_field_id);

-- Percentages that arrive outside 0–100 mean the source column changed
-- convention (fraction vs percent) — fail the import rather than silently
-- correlate against garbage.
alter table public.field_analysis
  drop constraint if exists field_analysis_pct_range;
alter table public.field_analysis
  add constraint field_analysis_pct_range check (
    (live_prepupae              is null or live_prepupae              between 0 and 100) and
    (immature_larvae            is null or immature_larvae            between 0 and 100) and
    (dead_prepupae              is null or dead_prepupae              between 0 and 100) and
    (dead_larvae                is null or dead_larvae                between 0 and 100) and
    (pollen_balls               is null or pollen_balls               between 0 and 100) and
    (second_generation          is null or second_generation          between 0 and 100) and
    (predators_and_pests        is null or predators_and_pests        between 0 and 100) and
    (parasites                  is null or parasites                  between 0 and 100) and
    (chalkbrood_sporulating     is null or chalkbrood_sporulating     between 0 and 100) and
    (chalkbrood_non_sporulating is null or chalkbrood_non_sporulating between 0 and 100) and
    (machine_damage             is null or machine_damage             between 0 and 100) and
    (sex_ratio_test_viability   is null or sex_ratio_test_viability   between 0 and 100) and
    (percent_female             is null or percent_female             between 0 and 100) and
    (percent_male               is null or percent_male               between 0 and 100)
  );


-- Historical weather per field-season, cached.
--
-- The Base44 app fetched Open-Meteo's archive API live, inside the render path,
-- once per field PER PANEL — six panels each refetching the same field
-- independently, on every mount. Weather for a season that ended is immutable,
-- so it is fetched once and kept.
--
-- Keyed by rounded coordinates, not by field: neighbouring fields share a grid
-- cell and there is no sense fetching the same cell twice. 3 decimal places is
-- ~110 m, well under Open-Meteo's own grid resolution.
create table if not exists public.weather_cache (
  id          uuid primary key default gen_random_uuid(),
  lat_key     numeric not null,
  lng_key     numeric not null,
  year        text not null,

  -- Season window actually requested (Apr 1 – Sep 30), so a later widening of
  -- the window is detectable rather than silently served from a short cache.
  start_date  date not null,
  end_date    date not null,

  -- Open-Meteo's `daily` block as returned: time[], temperature_2m_max[], etc.
  -- Stored raw so new derived metrics don't require a refetch.
  daily       jsonb not null,

  fetched_at  timestamptz not null default now(),

  unique (lat_key, lng_key, year, start_date, end_date)
);

create index if not exists weather_cache_year_idx on public.weather_cache (year);

-- RLS: signed-in non-pending read; editors write (same model as 0001/0005/0012).
do $$
declare t text;
begin
  foreach t in array array['field_analysis', 'weather_cache'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;
