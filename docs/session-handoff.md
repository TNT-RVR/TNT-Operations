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

## Left off — Phases 1–3 COMPLETE ✅ + Auth wired; Phase 4/5 STARTED
`npm run typecheck && npm test && npm run build` green — **49/49 tests**.

**Phase 4/5 (Shelter Maps slice) — done + verified in-browser:**
- `Field.geometry` (the raw `getTentPositions` dict) now flows through the data
  seam; Supabase maps it from `fields.data` jsonb; `seed.ts` has 2 synthetic
  demo fields with geometry (pivot 24 / polygon 16) + 1 without.
- `MapsHome`: pick a field → live shelter pins + boundary + pivot on MapLibre
  (`@turf/turf` for the pivot circle + fit-bounds), detail overlay, graceful
  "no geometry" state.
- `FieldEditor` panel: edit placement params (count/spacing, sprayer width,
  angle, radius, bays, outside-pass, track exclusion) with LIVE preview; save
  persists via `saveField` (added to BOTH providers — MockProvider now holds
  `fields` in state); click map to move the pivot; "Add pivot geometry"
  bootstraps a geometry-less field. Gated by `can('maps','edit')`.
  Verified in-browser: live recompute, save persists, SPA remount — 0 errors.
- **Incubation slice — done + verified:** incubator cards open an
  `IncubatorDetail` modal (progress + `getIncubationDay`, latest reading +
  threshold alerts, dependency-free SVG `ReadingsChart`, inspection history, and
  an add-inspection form via `addInspection` gated by `can('incubation','edit')`).
- **Robustness:** `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps the
  whole app (main.tsx) AND the routed `<Outlet>` in Layout, keyed by pathname so
  a crashed screen shows a recoverable fallback while the nav stays usable and
  navigating away resets it. Verified with a temporary throw.
- **Incubation DB port (Phase 7 start):** the full old bee-incubation schema is
  ported into the SAME Supabase project (`0003_incubation_full.sql`) — batches,
  samples, trays, rich inspections, alerts, settings, VOC. 0001's incubators/
  inspections were widened to supersets so the current app keeps working.
  `scripts/import_incubation.py` → paste-able SQL (int ids → UUIDs).
  **Finding:** the live `incubation.db` (My Drive) has NO operational data (only
  default presets/settings) — nothing to import yet; confirm if real data is on
  another machine.
- **Blocked on you (go live):** create the Supabase project → paste the Project
  URL + anon key so I can wire `.env` and apply `0001`→`0003` + smoke-test login.
- **Next:** app data-model + Incubation UI to adopt the full model
  (batches/samples/trays); Maps boundary DRAWING + export; Phase 6 integrations.

### Earlier — Phase 3 + Auth
Supabase backend + real-auth session built for both seams (mock mode unchanged).
- **`supabase/migrations/0001_init.sql`** — `profiles`(role) + `fields`,
  `incubators`, `inspections`, `sensor_readings`; role-based RLS mirroring the
  `MODULES` matrix (SECURITY DEFINER `app_role()`/`can_edit()`/`is_admin()`);
  realtime on `sensor_readings`/`inspections`. `0002_seed.sql` = demo rows.
  Apply via SQL editor or `supabase db push` (see `supabase/README.md`).
- **`SupabaseProvider`** implements `DataContextValue` identically to
  `MockProvider` (mappers in `data/mappers.ts`, tested). `DataProvider` picks it
  when `VITE_DATA_SOURCE=supabase` and configured, else warns + mock fallback.
- **Auth wired:** `useSession()` splits like the data seam —
  `SupabaseSessionProvider` (real Supabase Auth via `LoginScreen`, role from
  `profiles`, sign-out in the header) vs the mock user switcher, selected the
  same way. So `supabase` mode now pairs a real session with the RLS-guarded
  data. Permission matrix locked by `auth/session.test.ts`. **First run:** after
  the first admin signs in, set their `profiles.role = 'admin'` directly (the
  signup trigger defaults new users to `viewer`).

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
1. **Smoke-test `supabase` mode end to end:** create a real Supabase project,
   apply `supabase/migrations/*`, set `VITE_SUPABASE_URL`/`ANON_KEY` +
   `VITE_DATA_SOURCE=supabase`, sign in, promote your `profiles.role` to `admin`.
   (Only the pure pieces are unit-tested; the live auth/query path is untested.)
2. Phases 4/5 = full Incubation & Shelter Maps UIs (field editor, inspections,
   rendering `getTentPositions` on the map) — consume the locked `src/domain/`
   functions + the data seam.
3. When a real field with imported planter passes appears, port PASS-FOLLOWING
   (see `NotPortedError` note above) and add its golden fixtures.

## Not yet done
- No GitHub remote / push yet (needed to hand to Darren — see
  `docs/darren-onboarding.md`).
- No Supabase project, no live sensor polling, no exports.
