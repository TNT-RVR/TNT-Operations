-- ─────────────────────────────────────────────────────────────────────────────
-- TNT Operations — let a crew iPad record the work it was bought to record.
--
-- ── The bug ──────────────────────────────────────────────────────────────────
--
-- A crew scanning a block on the iPad got "new row violates row-level security
-- policy" and could not scan at all.
--
-- 0028 added the `device` role to has_access() so a tablet could READ, and
-- deliberately left it out of can_edit(): a shared device parked in a truck has
-- no business editing invoices, products or incubation records. That reasoning
-- is still right.
--
-- But the field tables are guarded by can_edit() too, and those are the ONLY
-- tables a device exists to write. Scanning a block upserts `blocks` and then
-- writes `block_placements`; placing shelters and linking trays write the
-- lineage tables. Every one of them refused the device.
--
-- ── The fix, and its shape ───────────────────────────────────────────────────
--
-- NOT `device` into can_edit() — that would hand a shared tablet write access
-- to sales, incubation, grants and settings in one line, which is exactly what
-- 0028 was avoiding.
--
-- Instead a second predicate, `can_record_field_work()`, applied only to the
-- five tables a crew fills in. An editor can still do everything; a device can
-- do these and nothing else.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.can_record_field_work()
returns boolean
language sql
stable
as $$
  -- Anyone who can edit, plus a device. Archived accounts are excluded by
  -- has_access(), which both branches ultimately depend on.
  select public.can_edit() or (public.app_role() = 'device' and public.has_access());
$$;

do $$
declare t text;
begin
  -- The tables a crew fills in from a tablet, and only those.
  --   blocks / block_placements  — scanning a block into a field
  --   placed_shelters
  --   shelter_tray_links         — which trays went into which shelter
  --   nesting_blocks
  foreach t in array array[
    'blocks', 'block_placements', 'placed_shelters', 'shelter_tray_links', 'nesting_blocks'
  ] loop
    -- Replaces the can_edit() policy from 0012/0008. Editors keep every right
    -- they had; the predicate only widens.
    execute format('drop policy if exists "write for editors" on public.%I;', t);
    execute format('drop policy if exists "write for field work" on public.%I;', t);
    execute format(
      'create policy "write for field work" on public.%I for all '
      || 'using (can_record_field_work()) with check (can_record_field_work());', t);
  end loop;
end $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Five rows, each named "write for field work".
--
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('blocks','block_placements','placed_shelters',
--                       'shelter_tray_links','nesting_blocks')
--     and cmd = 'ALL'
--   order by tablename;
