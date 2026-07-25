-- Bee lineage (spec Part 1.3): make the physical-inventory chain first-class —
--   nesting blocks → shelters → trays → incubators → season.
-- Trays already link to samples/batches/incubators (0003). This adds the
-- field-side physical records: placed shelters (QR + GPS), tray↔shelter scan
-- links, and nesting blocks living in shelters.

create table if not exists public.placed_shelters (
  id          uuid primary key default gen_random_uuid(),
  field_id    uuid references public.shelter_fields(id) on delete set null,
  qr_code     text unique,
  -- Which computed grid pin this placement corresponds to (null = manual/extra).
  grid_idx    integer,
  lat         double precision,
  lon         double precision,
  placed_at   timestamptz not null default now(),
  placed_by   text not null default '',
  status      text not null default 'placed', -- placed | collected
  notes       text not null default ''
);
create index if not exists placed_shelters_field_idx on public.placed_shelters (field_id);

create table if not exists public.shelter_tray_links (
  id          uuid primary key default gen_random_uuid(),
  shelter_id  uuid not null references public.placed_shelters(id) on delete cascade,
  tray_id     uuid not null references public.trays(id) on delete cascade,
  scanned_at  timestamptz not null default now(),
  scanned_by  text not null default '',
  unique (shelter_id, tray_id)
);
create index if not exists shelter_tray_links_tray_idx on public.shelter_tray_links (tray_id);

create table if not exists public.nesting_blocks (
  id          uuid primary key default gen_random_uuid(),
  qr_code     text unique,
  shelter_id  uuid references public.placed_shelters(id) on delete set null,
  notes       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists nesting_blocks_shelter_idx on public.nesting_blocks (shelter_id);

-- RLS: signed-in non-pending read; editors write (same model as 0001/0005).
do $$
declare t text;
begin
  foreach t in array array['placed_shelters', 'shelter_tray_links', 'nesting_blocks'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read for members" on public.%I;', t);
    execute format('create policy "read for members" on public.%I for select using (has_access());', t);
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format(
      'create policy "write for editors" on public.%I for all using (can_edit()) with check (can_edit());', t);
  end loop;
end $$;
