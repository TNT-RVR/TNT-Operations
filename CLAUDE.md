# CLAUDE.md — TNT Operations

Combined web app for a leafcutter-bee pollination operation. Merges two former
Python desktop apps into one React site with separate sections:

- **Shelter Maps** — bee-shelter placement on pollination fields (was `beetent-maps`).
- **Incubation** — incubator tracking, inspections, live sensor readings (was `bee-incubation`).

Stack: **React + TypeScript + Vite + Tailwind + MapLibre**. Deploys to Netlify.
Backend: **Supabase** (Postgres + Auth + RLS) — LIVE since 2026-07-24, holding the
real operational data. Scheduled work runs as **Netlify functions**, not Edge Functions.

> **📖 The authoritative product spec is [`docs/web-rebuild-spec.md`](docs/web-rebuild-spec.md)**
> (copied verbatim from the old app's `WEB_REBUILD_SPEC.md`). It is the *what and
> why of everything*: the business, leafcutter-bee domain model, every field-JSON
> key + default, every placement formula (`maketentgrid.py`), the cost-estimator
> math, the tablet crew app, sync ecosystem, overlay colour palette, and the
> rebuild priorities. When porting a feature, CHECK IT FIRST — it outranks
> guesses from code archaeology. The migration-status list below tracks what's
> done; the spec defines what "done" means.

> This project is **independent** of Grand Forks Concrete/Gravel. The design
> system was seeded from a one-time copy of Concrete's generic UI scaffolding and
> then rebranded — there is NO shared code, repo, or dependency. Keep it that way.

## Architecture (don't break the seam)
- Screens talk ONLY to `useData()` (`src/data/context.ts`) and `useSession()`
  (`src/auth/session.tsx`). Never import a backend directly from a feature.
- Two providers implement `DataContextValue`: `MockProvider` (in `AppData.tsx`,
  seeded from `src/data/seed.ts`) and `SupabaseProvider` (live). Selected by
  `VITE_DATA_SOURCE` (`mock` | `supabase`). Any new context method must be
  implemented in BOTH providers.
- Business/geometry math lives in `src/domain/` as pure, Vitest-tested functions
  — no React, no DB. Add a test alongside any new domain function.

## Hard rules
- Times stored UTC (ISO), displayed `America/Edmonton`.
- **Design system — TNT Pollination (binding).** See `docs/design-system.md` for
  the full spec. Non-negotiables:
  - **Tokens only.** All colour/type/space/radius/shadow live in
    `src/styles/tokens.css` as `--*` custom properties. NEVER hardcode a hex (or
    arbitrary px) in a component — reference a token, a Tailwind utility that maps
    to one (`tailwind.config.js`), or a `.btn/.card/.input/.label/.th` class.
    `npm run lint:tokens` flags raw hex outside the token layer (map files are the
    one allowlisted exception — MapLibre paint needs literal hex; keep it aligned
    to token values).
  - **Dark-first, honey-only.** Dark is the default; `.on-light` on `<html>` flips
    it (toggle in Users → Settings and the header, via `src/styles/theme.tsx`).
    Honey (`--brand`, `#FEB836`) is the ONLY accent — one primary honey element per
    view; everything else neutral ink. Borders are white-alpha hairlines. Field
    green is retired. Status greens/reds/blues are muted, chart-only data palette.
  - **Type.** The SYSTEM font stack — no downloaded webfonts (Montserrat/IBM Plex
    were tried and REVERTED 2026-08-04). `--font-display` and `--font-sans` are
    both `system-ui`; `--font-mono` is the system monospace.
    Eyebrows/labels/badges are UPPERCASE, wide tracking.
    For numbers in a table column, use `tabular-nums` (aligns digits) — NOT
    `font-mono`/`.tabular`, which swap the typeface and make that column the only
    one in a different font. Reserve mono for genuine telemetry readouts.
  - **Primitives.** Use `Button`, `IconButton`, `Input`, `Select`, `Checkbox`,
    `Switch`, `Stat`, `Badge`, `Tag`, `ProgressBar`, `Card`, `Logo`, `Modal`,
    `PageHeader` from `src/components/ui.tsx`. `Stat`/`ProgressBar` are the
    workhorses — TNT is a data-collection company; metric readouts lead.
  - **Icons** Lucide only, 2px stroke, `currentColor`. The bee mark (`/bee.svg`)
    is the one brand glyph — logo/loading/empty only, never a generic UI icon.
  - **Voice.** Confident, technical, plain-spoken; active voice, verbs lead;
    numbers with units in mono. No bee puns, no hype, no emoji (status = colour +
    dot + label). Company is "TNT"; address the grower as "you".
- Gate sections with `s.can('<module>', 'edit')`; route gating is in
  `src/components/Protected.tsx`. Section keys live in `MODULES` (`auth/session.tsx`).
- Secrets never go in the repo or in any `VITE_`-prefixed var except the public
  Supabase URL/anon key. Server secrets (Govee key, service role, SMTP) live in
  Supabase/Netlify env settings. See `docs/developer-onboarding.md`.
- **Shared Supabase project:** by decision (2026-07-24) TNT reuses the existing
  `pmqbkezevsuwkoryxief` project (the old beetent-maps backend) rather than a new
  one. To avoid colliding with that app's `public.fields` (company/year/name +
  jsonb), TNT's fields table is `public.shelter_fields`. All other TNT tables
  don't collide. Never DROP/ALTER the old app's tables (crews/scans/fields/…).

## Migration status (porting the two Python apps)
_Last reviewed 2026-08-03._

- [x] Phase 1 — scaffold, auth/roles, data seam, section shells. (The original
      light honey/green design system was REPLACED by the dark-first, token-driven
      TNT Pollination system — see the Hard rules above + `docs/design-system.md`.)
- [x] Phase 2 — math ported to `src/domain/`:
      - `get_tent_positions` → `tentGrid.ts` (+ UTM/ENU in `geo.ts`), locked by
        golden-file tests over all 15 real `fields/*.json` (exact pin count, row
        index, ≤1 m/pin). Manual + synthetic-grid paths ported; PASS-FOLLOWING
        (imported JD planter passes) is deferred — throws `NotPortedError` if a
        field ever hits it. Regenerate fixtures: `scripts/gen_tentgrid_golden.py`.
      - `incubation_calc.py` → `incubation.ts` (weight/tray calcs, temp modes +
        threshold checks, event extraction, unit conv), locked against Python
        reference values. `incubationProgress` is an app-only helper (no Python
        counterpart) and is NOT the authority for timing.
- [x] Phase 3 — Supabase backend for the data seam:
      - `supabase/migrations/0001_init.sql` — `profiles`(role) + `fields`,
        `incubators`, `inspections`, `sensor_readings` (columns match
        `types.ts`); role-based RLS mirroring the `MODULES` matrix via
        SECURITY DEFINER helpers; realtime on `sensor_readings`/`inspections`.
        `0002_seed.sql` = demo data matching `seed.ts`.
      - `SupabaseProvider` implements `DataContextValue` 1:1 with `MockProvider`
        (pure row↔type mappers in `data/mappers.ts`, tested). `DataProvider`
        selects it when `VITE_DATA_SOURCE=supabase` AND configured, else warns +
        falls back to mock.
      - **Auth:** `useSession()` splits the same way — `SupabaseSessionProvider`
        (real Supabase Auth: `LoginScreen` gate, profile role from `profiles`,
        sign-out) vs the mock user switcher, selected identically so a real
        session always pairs with the RLS-guarded data. Permission matrix locked
        by `auth/session.test.ts`. First admin: set your `profiles.role` to
        `admin` directly after first sign-in (see `supabase/README.md`).
- [~] Phase 4/5 — feature UIs (largely built; polish + gaps remain):
      - **Shelter Maps** (`/maps`) — satellite basemap (Esri, `basemap.ts`), live
        `getTentPositions` pins, and the full overlay set at spec Part 13 colours.
        `FieldEditor` exposes the FULL engine parameter set with live recompute +
        `saveField`. Boundary authoring: freehand draw + KML/KMZ/shapefile import
        (`importBoundary.ts`, computes acreage). Manual per-shelter editing with
        overrides scoped per combo (`shelterOverrides.ts`), crew route
        (`crewRoute.ts`), and save-time validation (`fieldWarnings.ts`).
        - **Authoring surface** (spec Part 6) — `MapToolbar.tsx` renders the
          LAYERS / TOOL / ACTIONS rows and the dynamic legend over six tool
          layers (`layers.ts`, device-persisted visibility). Tools: set pivot /
          2nd pivot, add+delete pivot tracks, draw boundary AND inner / access-
          road / wet-zone rings (one shared draw machine), entrance + parking
          pins, crew-route edit/reset, measure, and whole-field undo/redo.
        - **Overlay geometry is derived, never re-derived.** `fieldFrame.ts` is
          the ONE shared projection/rotation/bay-tiling frame — the engine's own
          math, so bays line up with the pins it placed. `bayOverlays.ts` (male
          bays, numbered planter passes, alignment mesh) and `sprayOverlays.ts`
          (sprayer passes, outer sprayer limit inset, tire + edge zones, shelter
          buffer squares) build on it. NOTE sprayer geometry uses `sprayAngle`,
          which may differ from the planting angle — see the doc comments.
          Regression tests: `bayOverlays.test.ts` locks the §5.3 band-width
          invariant (a `bay_gap_in` must go BETWEEN bays, never shrink the male
          band — the Wordmans/Carrots bug), `overlayIntegration.test.ts` runs
          every generator over the real seeded fields.
        - **The perimeter pass has zones too** — the sprayer's lap around the
          outside (boundary → inset one sprayer width, the ring
          `outerSprayerLimit` draws the inner edge of) gets a tire band on its
          centre and an edge band on each seam. They carry `perimeter: true`
          and a null `index`, and are ANNULI (a polygon with a hole), not
          rectangles. Two rules, both applied in `tireAndEdgeZones` rather than
          in the map layer so Field Mode cannot diverge from the office map:
          interior bands are CLIPPED to the limit ring (they stop where the
          outside pass begins), and the tire band is SUBTRACTED from any edge
          band it overlaps (a shelter may legally sit in an edge zone, so an
          edge zone over a wheel track invites driving on one). Because the
          clip reshapes interior bands, band width is now measured in the tests
          by lateral extent, not by `dist(ring[0], ring[1])` — a clipped band
          is no longer a 4-corner rectangle.
        - **Inner-boundary clipping** — bays are clipped at inner/access rings
          unless `bays_through_inner`; sprayer pass lines break at them unless
          `sprayer_routes_around_inner` is off (turf `difference`/`lineSplit`,
          union built once per call). With no inner rings the output is
          byte-identical to the unclipped path — a locked no-regression test.
        - **Imports** (`importPaths.ts`) — planter/sprayer GPS polylines from
          GeoJSON/KML/KMZ/zipped-shapefile, and actual (scanned) shelter pins
          from CSV. The CSV reader is deliberately forgiving: header or
          headerless, any column order, BOM/CRLF/quotes, `49.83°N`-style
          coordinates; out-of-range rows are counted as skipped, never guessed.
        - Also: ring vertex drag/delete, bay + sprayer shift nudges, test
          shelter pins, planned-vs-actual view, pin number modes (shelter # /
          tray count from the Part 7.2 bee math), and field search by
          name/company/year/LLD.
        - **LLD lookup** (`domain/ats.ts`) — typing ANY legal land description
          in the field search boxes that parcel on the map, in or out of the
          system (the scouting case). TWO TIERS: the real Alberta survey
          (median 7 m), else a computed grid (~300 m). The grid alone is NOT
          good enough and cannot be — the survey re-sets its ranges at
          correction lines, so two fields either side of one are wrong in
          OPPOSITE directions; no single offset fixes both.
          `scripts/build_ats_townships.py` collapses the old app's 255k
          surveyed sections (5.1 MB) to 7,196 townships (141 KiB) by storing an
          origin + section pitch each — the jogs are between townships, inside
          one the 6×6 grid is regular. Pitch ≠ section size (road allowances go
          between sections); conflating them quadrupled the error once already,
          and a test now pins pitch > size. `public/ats-townships.bin` is a
          static asset fetched on first use, NOT seam data — it is government
          survey data, identical everywhere, so it has no business in Supabase.
          Rebuild: `python scripts/build_ats_townships.py`.
        - **Reverse LLD on pivot drop** (`reverseLld`) — moving the pivot fills
          the field's `lld` in, so the description is captured as a by-product
          of dropping the pin. Fills only an EMPTY box (a contract's LLD is the
          legal one; a pin dropped by eye is not) and only when the pivot MOVES
          (so clearing the box by hand leaves it cleared). Where a typed LLD
          and the pivot disagree, `sameParcel` raises a save-time warning
          instead — lenient about what the typed one OMITS (`35-8-21` is less
          precise than `SW-35-8-21-W4`, not a contradiction), strict about what
          it states. Round-trip is locked over all 36 sections × 4 quarters and
          over the 15 real fields, whose recorded LLDs it recovers exactly.
      - **Costs** (`/maps/costs`) — the Financial View (spec Part 8) on the exact
        `cost.ts` port: per-field cost, profitability, season totals, pricing
        inputs stored PER YEAR (missing years carry forward). Prefs in
        `0007_cost_prefs.sql`.
      - **Field Mode** (`/field`) — the crew surface (spec Part 10). Touch-first,
        GPS-locked, one field at a time: scan-pins (filled = placed), mark-placed
        at the crew's position, live progress, and a crew-position broadcast the
        office map listens to. Installable PWA (`manifest.webmanifest` + `sw.js`)
        with tiles/shell cached offline.
      - **Incubation** (`/incubation`) — subsections: Incubators / Samples /
        Trays / Lineage. (The separate **Sensors** view was REMOVED 2026-08-13
        — a flat table of every reading, superseded by the per-incubator chart
        and the export below. `sensors` is gone from `MODULES` too.)
        - **Per-incubator export** (`domain/incubatorReport.ts` +
          `features/incubation/incubatorPdf.ts`) — any window (a week, a
          season, 2024), as a PDF summary or a readings CSV. The domain module
          builds ONE structure and the PDF and CSV are two renderings of it, so
          a number in both came from one computation. The PDF carries the logo
          (`bee-light.png`, downscaled through a canvas — the source is
          3000 px), vector charts drawn with jsPDF primitives, highs/lows with
          timestamps, settings, trays in, key dates and inspections.
        - **Setting history** (`0025_temp_mode_history.sql`) —
          `incubator_mode_events`, written by a TRIGGER on
          `incubators.temp_mode` so a change made anywhere is caught, not only
          the ones an app path remembered to log. Client-insertable is revoked:
          the SECURITY DEFINER trigger is the only writer, so nobody can invent
          or erase history. The seed row per incubator carries
          `backfilled = true` — its `changed_at` is when logging began, NOT
          when the mode was set, and the UI/PDF say so. Shown in the modal
          (`ModeHistory.tsx`) and as the PDF's "Setting changes" section.
        - **The derived timeline stays**, and is now titled "Settings held" when
          a log exists — the two answer different questions. The log says when
          someone CHANGED it (including a change that never moved the
          temperature, e.g. off → cool storage on an already-cold chamber); the
          derived timeline says what the chamber HELD, and is the only thing
          that reaches back before logging began.
        - **The derived timeline is read from measured temperature**, not from
          a log — `incubators.temp_mode` stores only the CURRENT setting, so
          this is the only thing that works retroactively.
          `classifyDay` maps a day's mean into a `TEMP_MODES` band; a
          between-bands day is `transition`, never rounded to the nearest. A
          gap in the readings ENDS a period rather than bridging it.
        - `fetchReadings(id, from, to)` is a seam method distinct from
          `loadReadings`: bounded at BOTH ends and RETURNED, so a three-year
          report neither leaves years of readings in global state nor reads a
          stale closure after awaiting.
        - Trays with a null `in_date` (legal in the live data) are counted as
          currently held and surfaced as `totals.undated`, so the total can be
          explained rather than silently undercounting.
        - Incubators: `IncubatorDetail` modal (progress + `getIncubationDay`,
          latest reading vs target, threshold alerts, SVG `ReadingsChart`),
          plus the REAL inspection checklist (period, thermometer-vs-Govee temp
          diff + drift alert, heat-pumps/fans/black-lights/bees-emerging/
          parasites-emerging) matching the old app's schema.
        - Samples: x-ray grading + derived tray math (`calcSampleSummary`).
        - Trays: full filterable list (search / incubator / sample / status /
          year), sortable columns, CSV export, 50-per-page paging, and a
          per-tray HISTORY modal (see the tray identity rule below).
        - Lineage (`0008_lineage.sql`): sample → batch → incubator → tray →
          shelter → field (+ nesting blocks) — spec Part 1.3's "biggest new
          value". Schema + browser exist; the field-side links (`placed_shelters`,
          `shelter_tray_links`) are populated by crews in Field Mode.
- [~] Phase 6 — integrations:
      - [x] **Govee poller** — `netlify/functions/poll-govee.mjs`, scheduled every
        15 min. A running incubator polls every cycle; an idle one gets a
        heartbeat poll every 6 h, throttled per incubator on `temp_mode` (which
        the app now writes, so it can be trusted). Raises temperature alerts
        against the mode's band, with an all-clear on recovery.
      - [x] **Monitoring watchdog** — `netlify/functions/watchdog.mjs`, hourly.
        Asks when each incubator last reported ANYTHING (60 min running, 24 h
        idle) and alerts as `sensor_offline`, with an all-clear. Its own
        schedule on purpose: this check used to live inside the poller, which
        is the one place it cannot work — it died with the thing it watched.
        `health.mjs` plus `.github/workflows/monitor-heartbeat.yml` sit outside
        Netlify entirely and catch scheduled functions not running at all.
      - [x] **Exports** (`exports.ts`, unit-tested) — shelter-pin KML, GeoJSON
        bundle, coordinate CSV, field PDF (jspdf), and shapefile (shp-write).
      - [ ] **ESP32 endpoint** — not built. `'esp32'` exists only as a
        `SensorSource` enum value / seed row; nothing ingests it yet.
      - [ ] **Email reports** — not built. The notification prefs grid has an
        `email` toggle, but there is no sender (no SMTP/Resend wiring).
- [x] Phase 7 — data import (done):
      - Full incubation schema in the shared project (`0003_incubation_full.sql`):
        batches, samples, trays, rich inspections, alerts, settings + VOC; 0001's
        incubators/inspections widened to supersets. `scripts/import_incubation.py`
        turns a populated `incubation.db` into paste-able SQL (int ids → UUIDs).
      - The REAL data is imported and live (~22k rows: 8 incubators, 61 samples,
        4.6k trays, ~16k sensor readings, inspections, alerts, VOC). The earlier
        "incubation.db has no operational data" note is OBSOLETE.
      - Real fields imported too via `scripts/import_fields.py` (`shelter_fields`).
      - **Tray identity rule (confirmed with Darren 2026-07-24):** a tray is a
        PHYSICAL object with a permanent label (`tray_number`), reused each season
        with a different sample/incubator, and ALL history is kept. So each row =
        one season's usage, and the no-duplicate unit is `(sample_id,
        tray_number)` — already unique in the data. Moving a tray to another
        incubator WITHIN a season must UPDATE that row; reuse NEXT season inserts
        a NEW row. Repeated `tray_number`s are history, NOT duplicates.
        Enforced in the DB by `0010_tray_unique.sql`
        (`unique (sample_id, tray_number)`), so an accidental duplicate INSERT
        now fails loudly. Rows with `sample_id IS NULL` (11 today) are NOT
        covered — Postgres treats NULLs as distinct.
        TODO: whatever WRITES trays should upsert on that key
        (`on conflict (sample_id, tray_number) do update set incubator_id = …`)
        so a mid-season move updates the row. `scripts/import_incubation.py`
        still emits `on conflict (id) do nothing`, which is fine for a normal
        re-import (ids are deterministic) but would ERROR if a tray were
        re-keyed while keeping the same sample + label.
      - "Year" has NO column: it's derived in-app from tray `out_date` →
        `cool_date` → `in_date`. `samples.import_date` is the import timestamp,
        NOT the season — never use it for year.
- [x] Phase 8 — beyond the original port (new modules):
      - **Notifications** (`0006_notifications.sql`) — in-app alert system: bell
        with unread dot, list/mark-read/delete, per-type preferences
        (`app_notifications`, `app_notification_prefs`). Table is named
        `app_notifications` to avoid a collision in the shared project.
      - **Grants** (`/grants`, `0009_grants.sql`) — funding pipeline ported from
        the RVR Management App: status/amount/eligibility/closes table, detail
        sheet with notes + assignment + subtasks, and a one-click Claude prompt
        for drafting. Rows arrive from `netlify/functions/grants-pull.mjs`
        (scheduled Mondays 14:00 UTC; asks Claude with web search for currently
        OPEN Alberta/Canada ag + small-business programs, upserts, and fires a
        "New grant" notification). Needs `ANTHROPIC_API_KEY` in Netlify env or it
        no-ops with 501. Manual first pull: `scripts/grants_pull_manual.sql`.
      - `grants` is a new `MODULES` key, so it carries its own role permissions.
      - **Analysis** (`/analysis`, `0014_field_analysis.sql`) — season analysis
        ported from the "Leaf Bee Insights" Base44 app (source zip exported
        2026-08-05). One row per field per season, natural key
        `(field_name, year)`; 157 real rows, 2020–2025. New `analysis` MODULES
        key. Subsections: Overview / Fields / Correlations / Weather / Growers /
        Map / Upload.
        - **`FieldAnalysis` keeps snake_case**, unlike every other type — the
          screens address metrics dynamically as `row[metric.key]` off the
          registry in `domain/analysisMetrics.ts`, so renaming would need a
          40-entry translation table across the registry, SQL and CSV headers.
        - **Numerics are numeric.** Base44 typed almost every metric `string`
          (the sheet carries "69.52%", "-", and Excel's `'-`) and re-parsed on
          every render. `scripts/import_field_analysis.py` cleans once on the
          way in; the migration CHECKs percent columns to 0–100.
        - **The screening is the point.** Over the real data, 473 testable pairs
          yield only ~25 real leads: 76 are definitional (the 11 x-ray grading
          shares sum to 100, so they MUST trade against each other;
          `percent_return` is computed from its own numerator) and ~49 rest on
          one outlier or a two-valued column. `domain/stats.ts` returns n, a
          Fisher-z p-value, a leave-one-out fragility flag and a Holm cutoff;
          `domain/analysisRelations.ts` names the arithmetic pairs. Ranking by
          |r| alone — all the original did — puts artifacts on top.
        - **Yield is not a usable outcome**: recorded on 33/157 rows (12 after
          default exclusions), and every yield correlation is fragile. Fixing
          that means recording more yield, not more analysis.
        - Dropped from the port: cocoon/x-ray images and the AI colour analysis
          (`cocoon_image_url`, `xray_image_url`, `xray_results_url_*`,
          `color_analysis*` are empty on all 157 rows).
        - Weather is Open-Meteo archive (Apr 1–Sep 30), fetched by
          `netlify/functions/weather-fetch.mjs` and cached in `weather_cache` —
          the original refetched it per field PER PANEL, inside render.
        - `netlify/functions/analysis-ai.mjs` replaces the 8 `InvokeLLM` sites;
          it is passed the computed verdict so it explains a result rather than
          judging one. Needs `ANTHROPIC_API_KEY` or it no-ops with 501.
        - No alerts: this is after-season analysis (confirmed 2026-08-05).
        - Charts use **recharts**, themed in `features/analysis/chartTheme.ts`.
          The categorical series order there is NOT the token declaration order:
          used as declared, violet↔sky measure ΔE 2.1 under deuteranopia.
          Reordering (honey, teal, coral, sky, lime, violet) lifts the worst
          adjacent pair to ΔE 11.0. Token VALUES are untouched.

## Dev
- `npm run dev` — runs on mock data, no backend needed.
- `npm run typecheck && npm test && npm run build` — keep this green before pushing.
  (393 tests green as of 2026-08-05.)
- `npm test` — Vitest: domain math (`tentGrid`, `geo`, `incubation`, `cost`,
  `crewRoute`, `shelterOverrides`, `fieldWarnings`, `grants`, `stats`,
  `weather`, `analysisImport`, `analysisRelations`), row mappers, the
  permission matrix, and the maps helpers (`overlays`, `exports`, `importBoundary`).
- `npm run lint:tokens` — fails on raw hex outside the token layer (see Hard rules).

## Known gaps / next up
- **Perf:** `SupabaseProvider` hydrates a lot on mount (~16k sensor readings and
  ~4.6k trays, the latter paged past PostgREST's 1000-row cap). Needs real
  pagination/windowing before it feels right on the live site.
- The `alerts` table (from the old app) is populated but not surfaced in the UI —
  distinct from the new `app_notifications` system.
- VOC subsystem (`voc_runs` / `voc_readings` / `voc_alert_events`) has data and
  schema but no UI.
- PASS-FOLLOWING placement mode is still unported (`NotPortedError`) — see Phase 2.
- `xray_live_pct` may be stored as a fraction (0.86) or a percent (86); the
  Samples UI normalises (>1 ⇒ ÷100), but the true convention is unconfirmed.
  (`field_analysis` has no such ambiguity — percent columns are 0–100 by CHECK.)
- **Analysis migration 0014 is written but NOT yet applied**, and the 157 real
  rows are not imported. Run `0014_field_analysis.sql` in the Supabase SQL
  editor, then `python scripts/import_field_analysis.py <Field_export.csv>` and
  paste `scripts/field_analysis_import.sql`. `weather-fetch` also needs
  `SUPABASE_SERVICE_ROLE` in Netlify env, and `analysis-ai` needs
  `ANTHROPIC_API_KEY` (already set if grants-pull works).
- `field_analysis.shelter_field_id` is never populated — the link to
  `shelter_fields` exists in the schema but nothing matches names to fields yet.
