-- Nesting-block management: place → retrieve → strip, with bee returns.
--
-- A block carries a permanent QR label and is REUSED every season, exactly like
-- a tray. So identity splits in two:
--
--   blocks            one row per physical block, forever. The QR resolves here.
--   block_placements  one row per block PER SEASON. Placing the same block next
--                     year adds a row rather than overwriting this year's, so
--                     the history survives.
--
-- Each placement accumulates through three scans in the field:
--   1. place    → field + GPS   (placed_at)
--   2. retrieve → gross weight  (retrieved_at)  block + bee material
--   3. strip    → empty weight  (stripped_at)   block alone
-- Bee return is the difference, computed on read — never stored, so it can't
-- drift out of step with the weights it comes from.
--
-- NOTE: this SUPERSEDES the unused nesting_blocks stub from 0008, which hung
-- blocks off a shelter and had no location or weights. It is empty in
-- production (verified 0 rows) so nothing is migrated, but it is left in place
-- rather than dropped — LineageHome still reads it.

create table if not exists public.blocks (
  id          uuid primary key default gen_random_uuid(),
  -- What the QR code encodes. The physical, permanent identity of the block.
  label       text not null unique,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.block_placements (
  id            uuid primary key default gen_random_uuid(),
  block_id      uuid not null references public.blocks(id) on delete cascade,
  -- Calendar year of placement. One run per block per season.
  season        integer not null,

  -- Where it went. field_id is how we roll returns up per field.
  field_id      uuid references public.shelter_fields(id) on delete set null,
  -- Reserved: blocks may later be placed into a specific shelter rather than
  -- loose in a field. Nullable and unused for now, so adding it costs nothing.
  shelter_id    uuid references public.placed_shelters(id) on delete set null,
  lat           double precision,
  lon           double precision,

  placed_at     timestamptz,
  placed_by     text not null default '',

  -- Scan 2: weighed with the bee material still in it.
  retrieved_at  timestamptz,
  gross_weight_lbs numeric,
  retrieved_by  text not null default '',

  -- Scan 3: weighed after the bee material is removed.
  stripped_at   timestamptz,
  stripped_weight_lbs numeric,
  stripped_by   text not null default '',

  notes         text not null default '',

  -- The whole point of the season split: same block, new year, new row.
  unique (block_id, season)
);

create index if not exists block_placements_block_idx  on public.block_placements (block_id);
create index if not exists block_placements_field_idx  on public.block_placements (field_id);
create index if not exists block_placements_season_idx on public.block_placements (season);

-- A weight is a physical quantity; negatives are always a typo or a bad scale.
alter table public.block_placements
  drop constraint if exists block_placements_weights_nonneg;
alter table public.block_placements
  add constraint block_placements_weights_nonneg check (
    (gross_weight_lbs    is null or gross_weight_lbs    >= 0) and
    (stripped_weight_lbs is null or stripped_weight_lbs >= 0)
  );

-- RLS: signed-in non-pending read; editors write (same model as 0001/0005/0008).
do $$
declare t text;
begin
  foreach t in array array['blocks', 'block_placements'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;
