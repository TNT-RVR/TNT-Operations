-- One central field list that every season hangs off.
--
-- ── The problem this fixes ───────────────────────────────────────────────────
--
-- `shelter_fields` conflates two different things: a field (a place TNT
-- pollinates, year after year) and a season's plan for that field (its company,
-- crop, acreage and shelter layout THIS year). The year lives inside its jsonb,
-- so a row IS one season — which is why 2027 cannot be set up while 2026 is
-- still running, and why every season means re-entering the same fields.
--
-- Splitting them:
--
--   pollination_fields  the place. Created once. Carries the BOUNDARY, because
--                   the land does not move (confirmed with Tyler 2026-08-24).
--                   NOT `fields`: that name belongs to the old beetent-maps app
--                   in this shared project (id, company, year, name, data), and
--                   the first draft of this migration walked straight into it —
--                   `create table if not exists` turned the collision into
--                   silence, and the statements after it were aimed at their
--                   table. Only the transaction rolling back prevented it.
--   field_seasons   the plan for one year: company, grower, crop, acres, and
--                   the placement geometry, which DOES change year to year.
--   field_aliases   the names other systems call it. The checklist import
--                   matched 0 of 14 names against the map because the sheet
--                   says "Proven Seeds SE 14-9-15" and the map says
--                   "SE 14-9-15". That is data, not a bug to be out-guessed:
--                   a fuzzy rule got "Hytech Carrots Wordmans" wrong on the
--                   first attempt and looked confident doing it.
--
-- ── What this migration does NOT do ──────────────────────────────────────────
--
-- Nothing is moved off `shelter_fields` and nothing that reads it changes. The
-- 1,747 block placements, the calendar events and the experiment notes keep
-- their foreign keys. This adds the new shape alongside and backfills it, so
-- 2026 keeps working while 2027 is built on the new tables.

-- ── The place ────────────────────────────────────────────────────────────────
-- Plain `create table`, deliberately: `if not exists` is what let the first
-- attempt collide silently with another app's table. In a shared project a name
-- that is already taken has to fail loudly. Re-running this file therefore
-- errors on the second statement, which is the correct outcome.
create table public.pollination_fields (
  id          uuid primary key default gen_random_uuid(),
  -- Identity is the NAME (Tyler, 2026-08-24). Other systems' names live in
  -- field_aliases and resolve to this one.
  name        text not null unique,
  grower      text not null default '',
  region      text not null default '',
  lld         text not null default '',
  /*
   * The outline, in whichever way it was authored: `{boundary_polygon: [...]}`
   * for a drawn field, `{PP_Latitude, PP_Longitude, Radius}` for a pivot. Here
   * rather than on the season because the boundary is the one part of the
   * geometry that does not change year to year — which is exactly what makes
   * "reuse last year's layout?" a question worth asking about the REST of it.
   */
  boundary    jsonb not null default '{}'::jsonb,
  notes       text not null default '',
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── The plan for one year ────────────────────────────────────────────────────
create table public.field_seasons (
  id                uuid primary key default gen_random_uuid(),
  field_id          uuid not null references public.pollination_fields (id) on delete cascade,
  year              text not null,
  -- Intake: what someone types when the season is planned.
  company           text not null default '',
  crop              text not null default '',
  acres             numeric,
  planned_shelters  integer,
  status            text not null default 'planned'
                    check (status in ('planned', 'active', 'complete', 'dropped')),
  /*
   * The placement plan: rows, angles, spacing, pins, exclusions — the engine's
   * whole parameter set for this year. Copied forward on rollover when the user
   * accepts last season's layout, and edited from there.
   */
  geometry          jsonb not null default '{}'::jsonb,
  /** Which season this was copied from, so "same as last year" is answerable. */
  copied_from       uuid references public.field_seasons (id) on delete set null,
  /** The map row this season corresponds to, while both models coexist. */
  shelter_field_id  uuid references public.shelter_fields (id) on delete set null,
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (field_id, year)
);

create index if not exists field_seasons_year_idx on public.field_seasons (year);
create index if not exists field_seasons_field_idx on public.field_seasons (field_id);

-- ── The names everything else uses ───────────────────────────────────────────
create table public.field_aliases (
  id         uuid primary key default gen_random_uuid(),
  field_id   uuid not null references public.pollination_fields (id) on delete cascade,
  alias      text not null,
  -- Where the name comes from: 'sheet' (the Checklist workbook), 'analysis'
  -- (the season analysis export), 'legacy', or whatever comes next.
  source     text not null default 'sheet',
  created_at timestamptz not null default now(),
  unique (source, alias)
);

create index if not exists field_aliases_field_idx on public.field_aliases (field_id);

-- ── RLS, same shape as every other operational table ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['pollination_fields', 'field_seasons', 'field_aliases'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s read" on public.%I;', t, t);
    execute format(
      'create policy "%s read" on public.%I for select to authenticated using (public.has_access());', t, t);
    execute format('drop policy if exists "%s write" on public.%I;', t, t);
    execute format(
      'create policy "%s write" on public.%I for insert to authenticated with check (public.can_edit());', t, t);
    execute format('drop policy if exists "%s update" on public.%I;', t, t);
    execute format(
      'create policy "%s update" on public.%I for update to authenticated using (public.can_edit()) with check (public.can_edit());', t, t);
    execute format('drop policy if exists "%s delete" on public.%I;', t, t);
    execute format(
      'create policy "%s delete" on public.%I for delete to authenticated using (public.can_edit());', t, t);
  end loop;
end $$;

create or replace function public.fn_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pollination_fields_touch on public.pollination_fields;
create trigger pollination_fields_touch before update on public.pollination_fields
  for each row execute function public.fn_touch_updated_at();

drop trigger if exists field_seasons_touch on public.field_seasons;
create trigger field_seasons_touch before update on public.field_seasons
  for each row execute function public.fn_touch_updated_at();

-- ── Backfill from the map ────────────────────────────────────────────────────
-- One field per map row, carrying its boundary; one season per map row, for the
-- year stamped on it. Re-runnable: conflicts update rather than duplicate.

insert into public.pollination_fields (name, grower, region, lld, boundary)
select
  sf.name,
  coalesce(sf.data->>'grower', sf.client, ''),
  coalesce(sf.region, ''),
  coalesce(sf.data->>'lld', ''),
  case
    when sf.data ? 'boundary_polygon' then jsonb_build_object('boundary_polygon', sf.data->'boundary_polygon')
    else jsonb_strip_nulls(jsonb_build_object(
      'PP_Latitude', sf.data->'PP_Latitude',
      'PP_Longitude', sf.data->'PP_Longitude',
      'Radius', sf.data->'Radius'))
  end
from public.shelter_fields sf
on conflict (name) do update
  set lld = excluded.lld, region = excluded.region, boundary = excluded.boundary;

insert into public.field_seasons (field_id, year, company, crop, acres, geometry, shelter_field_id, status)
select
  f.id,
  coalesce(nullif(sf.data->>'year', ''), to_char(now(), 'YYYY')),
  coalesce(sf.data->>'company', sf.client, ''),
  coalesce(sf.data->>'crop', ''),
  nullif(sf.data->>'acres', '')::numeric,
  -- The season carries the whole parameter set; the boundary keys are on the
  -- field now but left here too, so nothing that reads this jsonb breaks.
  sf.data,
  sf.id,
  'active'
from public.shelter_fields sf
join public.pollination_fields f on f.name = sf.name
on conflict (field_id, year) do update
  set company = excluded.company,
      acres = excluded.acres,
      geometry = excluded.geometry,
      shelter_field_id = excluded.shelter_field_id;

-- Aliases the checklist already proved we need: every sheet name that has been
-- linked to a map field becomes a registered alias, so the next import resolves
-- it without guessing.
insert into public.field_aliases (field_id, alias, source)
select distinct f.id, c.field_name, 'sheet'
from public.field_checklist c
join public.shelter_fields sf on sf.id = c.shelter_field_id
join public.pollination_fields f on f.name = sf.name
where c.field_name <> sf.name
on conflict (source, alias) do nothing;
