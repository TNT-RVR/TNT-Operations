-- Tray identity: one row per (sample, tray label).
--
-- A tray is a PHYSICAL object with a permanent label (`tray_number`). It is
-- reused every season with a different sample and incubator, and every season's
-- usage is kept as its own row — that history is the point, not a duplicate.
--
-- So the label alone is NOT the identity. The unit that must never repeat is
-- (sample_id, tray_number):
--
--   Tray0017 in sample 26-102  +  Tray0017 in sample #4 Sanfoin   → OK (history)
--   Tray0017 in sample 26-102 moved to another incubator          → UPDATE the row
--   Tray0017 in sample 26-102 twice                               → REJECTED (this)
--
-- Reassigning a tray mid-season must UPDATE `incubator_id` on the existing row.
-- This constraint makes an accidental second INSERT fail loudly instead of
-- silently creating the duplicate records that prompted it.
--
-- Verified before writing: 4,643 tray rows, 0 violations — applies cleanly.
--
-- CAVEAT: Postgres treats NULLs as distinct, so rows with `sample_id IS NULL`
-- (11 of them today) are NOT covered and could still duplicate each other.
-- Deliberately left alone rather than inventing a sample for them.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'trays_sample_traynum_unique'
      and conrelid = 'public.trays'::regclass
  ) then
    raise notice 'trays_sample_traynum_unique already present — nothing to do';
    return;
  end if;

  -- Refuse to add it silently if the data ever stops complying.
  if exists (
    select 1 from public.trays
    where sample_id is not null
    group by sample_id, tray_number
    having count(*) > 1
  ) then
    raise exception
      'Cannot add trays_sample_traynum_unique: duplicate (sample_id, tray_number) rows exist. '
      'Inspect them first: select sample_id, tray_number, count(*) from public.trays '
      'where sample_id is not null group by 1,2 having count(*) > 1;';
  end if;

  alter table public.trays
    add constraint trays_sample_traynum_unique unique (sample_id, tray_number);

  raise notice 'added trays_sample_traynum_unique on public.trays';
end $$;

-- Verify: expect one row, contype = 'u'.
select conname, contype
from pg_constraint
where conrelid = 'public.trays'::regclass
  and conname = 'trays_sample_traynum_unique';
