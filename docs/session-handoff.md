# Session handoff — TNT Operations

One-glance starting point for the next Claude Code session. Update the "Left off"
and "Next" sections as work progresses.

## How to resume
- Open the session with **`C:\Users\tyler\tnt-operations`** as the working
  directory (so *this* repo's `CLAUDE.md` loads — NOT Concrete's).
- `npm install` (first time), then `npm run dev` (runs on mock data, no secrets).
- Keep green before committing: `npm run typecheck && npm test && npm run build`.

## Source material (read-only — we port FROM these)
- Shelter maps engine: `C:\Users\tyler\beetent-maps\maketentgrid.py`
  (`get_tent_positions()`), plus real fields in `C:\Users\tyler\beetent-maps\fields\*.json`
  and coord math in `C:\Users\tyler\beetent-maps\utmish.py`.
- Incubation math: `C:\Users\tyler\bee-incubation\incubation_calc.py`.
- Read these by absolute path; do not build in those folders.

## Left off (2026-07-22) — Phase 3 COMPLETE ✅ (Phases 1–2 also complete)
Supabase backend built for the data seam. `npm run typecheck && npm test &&
npm run build` all green — **44/44 tests**; app verified still rendering in mock
mode (dashboard live, 0 console errors).
- **`supabase/migrations/0001_init.sql`** — `profiles`(role) + `fields`,
  `incubators`, `inspections`, `sensor_readings`; role-based RLS mirroring the
  `MODULES` matrix (SECURITY DEFINER `app_role()`/`can_edit()`/`is_admin()`);
  realtime on `sensor_readings`/`inspections`. `0002_seed.sql` = demo rows.
  Apply via SQL editor or `supabase db push` (see `supabase/README.md`).
- **`SupabaseProvider`** implements `DataContextValue` identically to
  `MockProvider` (mappers in `data/mappers.ts`, tested). `DataProvider` picks it
  when `VITE_DATA_SOURCE=supabase` and configured, else warns + mock fallback.
- **Auth follow-up (do before supabase mode is usable):** RLS is keyed to
  `auth.uid()`, so a signed-in Supabase Auth user is required. `useSession()` is
  still the mock user switcher — wire Supabase Auth into it next.

### Earlier — Phase 2 (math port)
Ported the two apps' math into `src/domain/` as pure, tested functions.
- **`geo.ts`** — ported `utmish.py`: `fromLonLat`/`toLonLat` (UTM-ish TM
  projection) + `latlonListToEnu`. Matches Python to ~1e-9 m.
- **`tentGrid.ts`** — faithful port of `get_tent_positions` (`maketentgrid.py`).
  MANUAL + SYNTHETIC-GRID paths (bay laterals, pivot/track/corner/inner
  exclusions, outside-pass kill zones, count-targeting binary search, snap,
  symmetry + radius trim, round-trip filter). Locked by golden tests over ALL 15
  real fields: exact pin count, exact NW-snake row index, ≤1 m/pin.
  - **Deferred:** PASS-FOLLOWING mode (imported JD `planter_passes`). No field
    exercises it today; `getTentPositions` throws `NotPortedError` if one does.
    Port from `maketentgrid.py` ~lines 2148–2546 when a field needs it.
  - Fixtures: `src/domain/__fixtures__/tentGrid.golden.json`; regenerate with
    `python scripts/gen_tentgrid_golden.py` (reads beetent-maps by abs path).
- **`incubation.ts`** — ported `incubation_calc.py`: weight/tray calcs, TEMP_MODES
  + `checkTempHumidity`, event extraction (`getUpcomingEvents`/`getAllEvents`/
  `getIncubationDay`), unit conversion. Locked against Python reference values.
  Date helpers take an explicit `now: Date` (UTC calendar-day math) instead of a
  hidden local clock. `incubationProgress` kept as an app-only UI helper.

## Next
1. **Wire Supabase Auth into `useSession()`** (replace the mock user switcher):
   sign-in, read role/name from `profiles`, expose the same `SessionValue`. This
   is the prerequisite that makes `supabase` mode actually return rows under RLS.
   Then create a real Supabase project, apply `supabase/migrations/*`, and smoke
   test `VITE_DATA_SOURCE=supabase`.
2. Phases 4/5 = full Incubation & Shelter Maps UIs (field editor, inspections)
   — these consume the now-locked `src/domain/` functions + the data seam.
3. When a real field with imported planter passes appears, port PASS-FOLLOWING
   (see `NotPortedError` note above) and add its golden fixtures.

## Not yet done
- No GitHub remote / push yet (needed to hand to Darren — see
  `docs/darren-onboarding.md`).
- No Supabase project, no live sensor polling, no exports.
