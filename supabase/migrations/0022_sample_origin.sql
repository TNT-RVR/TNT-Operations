-- ── Where a sample lot came from ─────────────────────────────────────────────
--
-- Closes the loop in the bee cycle. Blocks go out to a field, come back, and
-- are weighed in and out; the difference is that field's bee return. Those
-- returns ARE next season's sample lot — the bees that go back into the
-- incubators and out to the fields again.
--
-- Until now that link lived only in someone's head. Sample names look like
-- fields ("BASF Test Canola", "David Torrie Se 13-11-14"), which is a person
-- typing what they remember, and nothing could answer "how did the bees we put
-- out this year perform where they came from?"
--
--   field_id       the field whose blocks produced these bees
--   harvest_season the year they were HARVESTED, not the year they are used.
--                  A lot harvested in 2026 is placed in 2027; storing the
--                  harvest year keeps it tied to the returns it came from,
--                  which is the number it can be checked against.
--
-- Both nullable: every existing lot predates this, and bought-in bees have no
-- field of origin at all. A null means "not recorded", never "unknown field".
alter table public.samples
  add column if not exists field_id       uuid references public.shelter_fields(id) on delete set null,
  add column if not exists harvest_season integer;

comment on column public.samples.field_id is
  'Field whose block returns produced this lot; null for bought-in or pre-2026 lots.';
comment on column public.samples.harvest_season is
  'Season the bees were harvested. The lot is normally placed the FOLLOWING season.';

-- One lot per field per harvest, so "create the lot for this field" is
-- repeatable rather than a way to make duplicates. Partial, because the
-- nulls above are legitimate and must not collide with each other.
create unique index if not exists samples_field_harvest_uidx
  on public.samples (field_id, harvest_season)
  where field_id is not null and harvest_season is not null;

create index if not exists samples_harvest_season_idx
  on public.samples (harvest_season);
