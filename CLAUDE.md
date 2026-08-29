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
  - **Light-default, honey-only.** LIGHT is the default as of 2026-08-27;
    dark is fully supported and one toggle away (Users → Settings and the
    header, via `src/styles/theme.tsx`). The base stylesheet is still dark with
    `.on-light` overriding it, so an inline script in `index.html` picks the
    theme BEFORE paint — a React-level flip showed black then snapped to white
    on every cold load. That script repeats the storage key and the default by
    hand (nothing from the bundle exists yet); `themeBoot.test.ts` fails if it
    drifts from the provider. The key is versioned `-v2` because the old
    provider persisted on MOUNT, so everyone had `dark` stored whether they
    chose it or not; persistence is now tied to an actual choice.
    Honey (`--brand`, `#FEB836`) is the ONLY accent — one primary honey element per
    view; everything else neutral ink. Borders are white-alpha hairlines. Field
    green is retired. Status greens/reds/blues are muted, chart-only data palette.
  - **Type.** The SYSTEM font stack — no downloaded webfonts (Montserrat/IBM Plex
    were tried and REVERTED 2026-08-04). `--font-display` and `--font-sans` are
    both `system-ui`; `--font-mono` is the system monospace.
    Eyebrows/labels/badges were UPPERCASE with wide tracking until 2026-08-27;
    they are SENTENCE CASE at `--text-xs` now (caps on every label read as
    instrumentation). Radii moved up a step the same day — buttons and inputs
    sat at 6px against a 48px touch target. Mono is
    for readouts, scanned identifiers, coordinates and credentials only; it was
    on all the chrome until 2026-08-19 and made every screen two typefaces.
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
- **NO `viewport-fit=cover`** in `index.html`, and a test enforces it against
  the iOS status-bar style. Cover lets the page draw UNDER the system bars and
  the app then keeps clear with `env(safe-area-inset-*)`. On Android with
  three-button navigation that bottom inset is commonly 0 while the nav bar
  still overlays the viewport — so `.safe-bottom` added nothing and the app's
  OWN bottom bar rendered underneath the system one. Invisible, and
  intermittent (the inset moves with gesture-vs-button nav, rotation, the
  keyboard). Cover only existed for `black-translucent`, which went away when
  the app went light on 2026-08-27. Turn cover back on only with a real reason
  AND a check on an Android phone in three-button mode.
- **A new view is offered as a phone shortcut, or is deliberately not.** When
  you add a route, add it to `HOME_TILES` (`src/domain/homeTiles.ts`) so it can
  be put on someone's home screen, or list it in `NOT_A_SHORTCUT` in
  `homeTilesCoverage.test.ts` with the reason. That test FAILS on a route that
  does neither — a note here would have held for about two features, which is
  what happened to "never fetch a scheduled function" before it became a test
  too. Tiles are per person, permission-filtered, and ordered by their owner;
  the settings panel is Users & Settings → Account.
- Gate sections with `s.can('<module>', 'edit')`; route gating is in
  `src/components/Protected.tsx`. Section keys live in `MODULES` (`auth/session.tsx`).
- **Supabase auth settings live in the dashboard, not the repo.** Access-token
  expiry was changed from the default 3600s to **604800s (7 days)** on
  2026-08-26. That is a deliberate trade: a stolen access token stays valid for
  a week and cannot be revoked (JWTs are stateless — signing out does not
  invalidate one already issued). Weigh that against crew tablets that go
  offline for hours; if the reason was staying signed in offline, the refresh
  token already handles that and a shorter access token would be safer.
- Secrets never go in the repo or in any `VITE_`-prefixed var except the public
  Supabase URL/anon key. Server secrets (Govee key, service role, SMTP) live in
  Supabase/Netlify env settings. See `docs/developer-onboarding.md`.
- **Shared Supabase project:** by decision (2026-07-24) TNT reuses the existing
  `pmqbkezevsuwkoryxief` project (the old beetent-maps backend) rather than a new
  one. To avoid colliding with that app's `public.fields` (company/year/name +
  jsonb), TNT's fields table is `public.shelter_fields`. All other TNT tables
  don't collide. Never DROP/ALTER the old app's tables (crews/scans/fields/…).
  **Use plain `create table`, never `create table if not exists`, for a new
  table here.** `if not exists` turns a name collision into SILENCE: a
  migration adding `public.fields` (2026-08-24) no-oped on the old app's table
  of that name and then aimed its RLS policies, trigger and foreign keys at
  THEIR table. Only the Management API running the file in one transaction —
  and a later statement failing — prevented it. TNT's own is
  `public.pollination_fields`.

## Migration status (porting the two Python apps)
_Last reviewed 2026-08-17._

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
          bays, numbered planter passes, alignment mesh — one line across each ROW
          plus the DIAGONAL strips; each feature carries
          `axis: 'row' | 'diagonal'` so a caller can style one family without
          inferring it from the vertex count. NO column guides: a column runs
          the way the planter does, and the crop rows already are that guide.
          One line per diagonal STRIP, fitted to its own pins; near-parallel
          guides then merge into the line between them, at a threshold derived
          from the spacing of the guides PARALLEL TO EACH ONE — not a flat
          distance, and not one figure for the whole drawing: rows and
          diagonals are spaced by different amounts (300 m vs tens of metres on
          an open pivot) and a pooled figure swallowed real diagonals. The
          spacing is read at the 90th percentile of nearest-neighbour gaps,
          NOT the median: a duplicate's nearest neighbour is its own twin, so
          doubles sit in the low tail and a middle reading is itself a
          duplicate once a third of the guides are doubled. Half of that is
          the merge distance — calibrated against a real field measured at
          50 ft doubles against 180 ft real spacing). Each guide is a straight
          LINE spanning the field extent, not a polyline visiting the pins — it
          carries through gaps, reaches past the last shelter, and cannot kink;
          the map trims it with `clipToField`. Collinear guides dedupe by
          endpoint, and the axis is deliberately NOT in that key, so an
          unstaggered grid's "diagonals" collapse into its row lines instead of
          being drawn twice) and `sprayOverlays.ts`
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
          interior EDGE bands are CLIPPED to the limit ring (past it the seams
          are the perimeter pass's own), interior TIRE bands carry ON to the
          perimeter wheel track at inset `W/2 + tireW/2` (the sprayer drives in
          across the lap to start a pass, so those wheels really do run over
          that ground — and the two tracks meet with no gap), and the tire band
          is SUBTRACTED from any edge band it overlaps (a shelter may legally sit in an edge zone, so an
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
      - **Costs** (`/finances/costs`, moved there 2026-08-28; `/maps/costs`
        redirects) — the Financial View (spec Part 8) on the exact
        `cost.ts` port: per-field cost, profitability, season totals, pricing
        inputs stored PER YEAR (missing years carry forward). Prefs in
        `0007_cost_prefs.sql`.
        **The §8.2 math was always complete; the travel INPUTS were not.**
        `fieldCost` reads `home_to_parking_km`/`_min` and until 2026-08-28
        nothing ever wrote them — the old app's Google Distance Matrix button
        was never ported — so 12 of 15 real fields costed with a $0 paid round
        trip and most of the fuel missing. On one measured field that gap is
        $278 on 152 acres ($1.82/ac), with profit/acre reading correspondingly
        well. `netlify/functions/travel-times.mjs` fills it from
        **Google Distance Matrix** — chosen over a free keyless router because
        the three fields that ALREADY have travel times were measured by Google
        in the old app, and mixing sources leaves one season half-measured two
        ways. ONE call covers the season (15 billable elements, far inside the
        free allowance). Needs `GOOGLE_MAPS_API_KEY` in Netlify or it no-ops
        with 501. NOTE Google calls Distance Matrix legacy now and points new
        work at the Routes API; the parsing is confined to
        `readDistanceMatrix` if that has to change.
        Distance Matrix answers HTTP 200 even when it refuses — the real
        verdict is the body's `status`, and treating 200 as success is how a
        key problem becomes "0 fields updated" with no explanation.
        Routes to the parking pin, else the PIVOT, and says which it used. An
        unroutable field is left BLANK rather than written as 0 — zero is what
        the estimator already wrongly believes, so writing it would make the
        gap permanent and invisible. The Costs screen names every field with no
        travel and says its total is understated.
        The geometry is duplicated in `src/domain/travelTimes.ts` (app) and the
        function (Netlify bundles separately); `travelTimesParity.test.ts` runs
        BOTH over the same inputs and fails if they disagree.
      - **Field Mode** (`/field`) — the crew surface (spec Part 10). Touch-first,
        GPS-locked, one field at a time: scan-pins (filled = placed), mark-placed
        at the crew's position, live progress, and a crew-position broadcast the
        office map listens to. Installable PWA (`manifest.webmanifest` + `sw.js`)
        with tiles/shell cached offline.
      - **Incubation** (`/incubation`) — subsections: Incubators / Samples /
        Trays / Lineage. (The separate **Sensors** view was REMOVED 2026-08-13
        — a flat table of every reading, superseded by the per-incubator chart
        and the export below. `sensors` is gone from `MODULES` too.)
        - **Hypoxia** (`/incubation/hypoxia`, `0048_hypoxia.sql`) —
        controlled-atmosphere storage: a chamber holds O2 near 10% with
        nitrogen purges. Hardware is an Arduino Nano per chamber bridged to
        **ThingsBoard** by an ESP32-C3 (student build, 2026-08).
        **ThingsBoard stays the device gateway** — no firmware change, nothing
        reflashed. `poll-hypoxia.mjs` (every 5 min) copies telemetry into
        `hypoxia_readings` so the app has history and alerting, exactly the
        Govee poller's shape; `hypoxia-command.mjs` sends RPC back.
        `domain/hypoxia.ts` is the device contract, ported from
        `TNT2_NANO.ino`. TWO traps live there: **`SP=`/`DB=` are TENTHS**
        (`SP=100` is 10.0%, so sending "10" would set 1.0% O2 and the firmware
        would accept it), and a missing O2 figure returns NULL rather than a
        partial reading — 0% is a readable number and a catastrophic one.
        `chamberVerdict` puts fault and maintenance ABOVE the band: at setpoint
        while faulting is not "holding", and in maintenance the loop is not
        running so being at target is a coincidence.
        The command whitelist exists in BOTH the domain and the function (a
        Netlify function cannot import from `src`); `hypoxiaCommandParity.test.ts`
        fails if they drift, including on risk level. Manual/calibration
        commands are admin-only and enforced IN THE FUNCTION — a disabled
        button is a UI state, not a gate — because a valve or blast door left
        open means the chamber stops holding its atmosphere and nothing in the
        firmware closes it. Every attempt, including refusals, is written to
        `hypoxia_commands`.
        Alerts: `hypoxia_silent` / `hypoxia_fault` / `hypoxia_out_of_band`.
        Purging and maintenance are deliberately NOT alerted — both leave the
        band on purpose.
        Needs `TB_USERNAME` / `TB_PASSWORD` (+ optional `TB_BASE_URL`) in
        Netlify, and each chamber row needs its `tb_device_id`; unconfigured,
        both functions no-op with 501.
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
      - [~] **Branded auth email** — the app never sends mail itself; Supabase
        does (invites, resets, the Users-screen "link to the app"). The six
        templates are written and version-controlled — `scripts/build_email_templates.py`
        generates `supabase/email-templates/*.html` from one shell, plus
        `public/email/logo.png` — but custom SMTP is NOT configured yet, so
        they are unused and mail still goes out on Supabase's shared sender at
        a couple of messages an hour. Runbook: `docs/email-setup.md`.
        Templates are pushed with `npm run email:push` (Supabase Management
        API, needs a personal access token in `.env.local`) rather than pasted.
        Sender is **SendGrid**, not Resend: DNS for `tntpollination.com` is at
        Wix, which cannot make an MX record on a subdomain, and Resend requires
        one for its return path. SendGrid's Automated Security authenticates
        with three CNAMEs and no MX. Don't re-try Resend without moving DNS.
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
- [x] Shipping paperwork (beyond the original port):
      - `salesDocs.ts` builds the four customs/carrier documents; `packing.ts`
        does the pallet math; `freightClass.ts` computes class from density;
        `freightQuote.ts` composes the three into the Cole International
        quote request, which `FreightQuoteView.tsx` renders as an editable form.
        `docHelp.ts` holds the plain-words explanation behind every info button
        — a test enforces that each note says what goes WRONG, not just what
        the field is.
      - **Pallet height is derived, and stacks are asked.** Items-per-stack ×
        nested height + the pallet deck (`DEFAULT_PALLET_DECK_IN`, 5.5 in).
        Stacks per pallet is per-SHIPMENT (`shipping_logistics.perItem`), not a
        property of the item. Checked against the real Estes BOL: 125 tops in 4
        stacks computes to 83 in against the 82 written; the deck is the
        unknown and the test says so rather than tuning the constant to match
        one document.
      - **Class: computed, overridable, explained.** The density scale is the
        starting point and `sales_order_lines.freight_class` is the override;
        NULL is NOT the same as typing the computed number (null keeps
        following the load when it is packed differently). Estes bills TNT 175
        on a 4.7 PCF load the scale calls 200, so the override is the normal
        case, not the exception. `sales_item_specs.freight_class` is the
        item-level default for a class a carrier has settled.
      - The BOL prints class/NMFC/dimensions ONLY when a freight table is
        supplied (`DocContext.freight`). With none it is unchanged — the rule
        was always that a GUESSED class is worse than none, and that still
        holds; what changed is that this one is computed from real specs.
      - **Printing** is `.print-target` / `.print-hide` in `index.css`, NOT
        `visibility: hidden` (hidden elements keep their space, which printed
        four blank pages before the document). `:has()` unclips the scrolling
        modal around the sheet, and the dark theme is forced to ink.
      - **Shipping specs have an editor** (`/finances/sales/shipping`,
        `ShippingSpecs.tsx` + `domain/itemSpecs.ts`). It leads with the GAP,
        not the list: `missingSpecs` names every active product whose
        `shipItem` has no spec, because such a product looks healthy right up
        until a freight quote leaves it off the table. `specProblems` splits
        `blocking` (the figures `packLine` cannot make a pallet without — zero
        is treated as unmeasured, not as a measurement) from `check` (numbers
        that work but look wrong). The editor shows ONE FULL PALLET live as
        the figures change — seven boxes cannot be checked, "125 tops, 4
        stacks, 83 in, 425 lb" can be walked out to and measured.
        Deliberately NO even-stacks rule: 125 tops in 4 stacks is 31.25 a
        stack and the real Estes BOL agrees with the averaged height, so a
        rule firing on the primary item would be noise. There IS a loaded-
        height check at `SANE_PALLET_HEIGHT_IN` (96), which is what catches a
        spec whose boxes are each plausible — 300 anchors, one stack, 1.5 in
        each, and a 456 in pallet.
        **The item name is the join** and nothing matches loosely, so renaming
        writes a NEW row and the editor says so rather than silently orphaning
        the products pointing at the old one.
      - **"Ships as" is a picker, not a text box** (`ShipsAsPicker` in
        `SalesCatalogue.tsx`) — the name must match a spec EXACTLY, so a typo
        used to produce a product that looked configured and fell off every
        freight document. Blank is a legitimate answer ("nothing on a pallet")
        and A SET IS QUOTED AS ITS TWO ITEMS ON THEIR OWN LINES: one product
        maps to one shipping item on purpose, and `Tray Set (top + bottom)`
        cannot be expressed as one. An existing value with no spec is kept in
        the list and labelled rather than dropped.
      - **Not everything stacks** (`packMode`, migration `0046`). The spec model
        assumed every shippable thing nests into itself — pallet height came
        from stacks x the height each ADDITIONAL item adds. Anchors do not
        stack; they go loose in tubs, and there is no per-item nested height to
        measure. A figure invented to fill that box becomes a made-up pallet
        height, then a made-up density, then a made-up freight class on a
        document a carrier bills against. So `packMode: 'loose'` STATES the
        loaded pallet height (`looseHeightIn`, measured off a real pallet) and
        carries `containerTareLbs` for the empty tubs, counted pro rata on a
        part-full pallet. A loose line reports `stacksPerPallet: 0` — not 1 —
        so the freight quote shows "loose" rather than a box that looks like it
        would move the height. NULL `pack_mode` means stacked, so every
        existing row is untouched.
      - **Blocking is measured against what `packLine` USES**, and the item's
        own length/width/height are not in that set: every freight number comes
        off the PALLET (48x40 by the computed height), and the item dimensions
        feed only the metric view and the specs list. They were blocking at
        first, which refused a spec over figures that change no output — that
        is how a rule stops being believed. They are `check` now.
      - **`lineFreightGap` tells the three causes apart** — the product names
        no shipping item / it names one nothing has measured / the spec exists
        but is unfinished — because they have three different fixes.
        `packShipment` cannot: by the time it runs, the fallback from
        `shipItem` to the line DESCRIPTION has already happened, so every gap
        looks like a missing spec for an item name nobody meant to create.
        Surfaced per line in the order editor (a "No freight" badge with the
        specific advice) and as a warning on the order.
- [x] Phase 8 — beyond the original port (new modules):
      - **Season field list** (`0041_field_seasons.sql`, applied 2026-08-24) —
        `pollination_fields` (the place: name is identity, carries the BOUNDARY,
        which does not change year to year), `field_seasons` (the plan for one
        year: company, crop, acres, and the placement geometry, which DOES),
        and `field_aliases` (what other systems call it — the checklist import
        matched 0 of 14 sheet names against the map, so this is data rather
        than a fuzzy rule that guesses). Backfilled: 18 fields, 18 seasons
        (2026), 14 aliases. NOTHING reads it yet — `shelter_fields` is still
        the live source and keeps its foreign keys (1,747 block placements).
        Consumers move over one at a time, each falling back to
        `shelter_fields` when a season has NOT been set up — so 2027 reads the
        new model while 2026 carries on unchanged. Moved so far: the **Overall
        Checklist** (rows + sheet-name resolution via `field_aliases`) and
        **Field Mode**'s three crew pickers (`useSeasonFields`).
        `domain/seasonFields.ts` rebuilds the `Field` those screens expect —
        boundary from the field, layout from the season, and the FIELD's
        boundary winning, matching `layoutDict` so the layout preview and the
        crew map cannot draw different shapes.
        Crew tables still key on `shelter_fields.id`, so creating a season also
        creates a map row (`ensureMapRow`) and copy-forward reuses last
        season's — two seasons of one field share that row. `0042` is what
        makes that safe: `block_placements`, `placed_shelters`,
        `calendar_events` and `experiment_notes` each gained
        `field_season_id`, backfilled (2,035 placements: 1,777 attributed, 258
        scanned outside any boundary so they have no field at all) and kept
        filled by a TRIGGER per table rather than by app code. The trigger is
        deliberate: a write path that got missed would produce rows with no
        season and nobody would notice until a report came up short.
        `fn_season_for(field_id, when)` resolves the field's season for the
        year the work happened, Edmonton time, and returns NULL rather than
        guessing at the nearest season — work attributed to the wrong year is
        worse than work attributed to none, because it gets counted.
        **So: scan a field in a season that has not been set up yet and the row
        gets no season.** Re-running 0042's four UPDATE statements is idempotent
        and repairs them once the season exists.
      - **Overall Checklist** (`/tasks/overall`, `0039_field_checklist.sql`) —
        the field × season-step grid ported from the "Checklist" spreadsheet
        (one sheet per year since 2023). ROWS ARE NOT STORED: they are the
        season's fields straight from `shelter_fields`, so the list cannot
        drift from the map. Only marks are stored, keyed `(year, field_name,
        step)` — name-keyed because the sheet is, and its older names were
        never mapped fields. Planned and completed are SEPARATE dates: the
        sheet keeps both in one cell distinguished by a blue fill, so the plan
        is destroyed the moment the work happens and "were we late" cannot be
        asked. Steps in `domain/fieldChecklist.ts`.
        **Google Sheets two-way sync is BUILT**, and generalised: `sheet-sync.mjs`
        (every 30 min, runs every REGISTERED sync) + `sheet-sync-now.mjs` (the
        button, takes a sync name). A new sheet is an adapter in
        `lib/<thing>Sync.mjs` registered in `lib/sheetSyncs.mjs` — one service
        account serves all of them. A new season's tab is CREATED from last
        year's header, and missing field rows are appended. Service-account
        auth, `0040` adds the agreement snapshot). App wins a true conflict, but
        only when BOTH sides moved since the last sync — the snapshot is what
        lets a sheet-only edit still flow in. A blue fill IS the "done" flag,
        read and written. Needs `GOOGLE_SERVICE_ACCOUNT` + `CHECKLIST_SHEET_ID`
        in Netlify and the sheet shared with the service account, or it no-ops
        with 501. Setup + how it decides:
        `docs/checklist-sheet-sync.md`.
      - **Finances** (renamed from Sales, 2026-08-27) — the section is
        `/finances`, with TWO children in the nav: **Sales**
        (`/finances/sales`, whose own six tabs live in the page via
        `SalesChrome`, NOT in the menu — repeating them in the sidebar put the
        same list twice on one screen) and **Bee purchases**
        (`/finances/bees`), which moved OUT of the Sales tabs because buying
        bees is not a sale and shares no data with one. `SalesChrome` takes a
        `tabs` prop for that; Bee purchases passes `null` and still gets the
        `loadSales()` the slice needs.
        Every old `/sales/*` path REDIRECTS rather than 404s — home tiles store
        a route, so a rename without them silently empties someone's phone
        screen. The tile KEYS are unchanged for the same reason.
        The MODULES permission key is still `sales`: it is an identity in the
        role matrix, not a label, and renaming it buys nothing.
      - **Notifications** (`0006_notifications.sql`) — in-app alert system: bell
        with unread dot, list/mark-read/delete, per-type preferences
        (`app_notifications`, `app_notification_prefs`). Table is named
        `app_notifications` to avoid a collision in the shared project.
        - **Web push** is BUILT: `push_subscriptions`, the `push`/
          `notificationclick`/`pushsubscriptionchange` handlers in
          `public/sw.js`, `usePush.ts` for the client subscribe, and
          `netlify/functions/lib/push.mjs` for delivery. Push is strictly
          OPT-IN per type (`app_notification_prefs.push`, default false) —
          silence is never consent for something interruptive. Needs
          `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` in Netlify
          and `VITE_VAPID_PUBLIC_KEY` at build; unconfigured, alerting still
          logs to the inbox and simply does not push.
          NOTE this is a NODE runtime (Netlify), so the ordinary `web-push`
          npm package is correct here. The Deno/JSR workaround that a Supabase
          Edge Function needs does NOT apply.
        - **Icon badge** (`domain/appBadge.ts` + `useAppBadge`, mounted in
          `Layout`) — the red count on an installed app's icon, via the
          Badging API. A separate feature from push with none of its cost: no
          keys, no server, no prompt, and a silent no-op in a browser tab.
          The badge on a CLOSED app is not this hook — it is `sw.js` calling
          the same API from the push handler, with the count carried in the
          payload by `sendToAll` (put there centrally, since a producer that
          forgot it would still deliver the banner and only the number would
          be wrong, which nobody reports).
          The inbox is SHARED (`read_at` is on the row, not per person), so
          the badge is the crew's count and one person reading clears it for
          all. `BADGE_SCAN_LIMIT` is duplicated in `push.mjs` because a
          Netlify function cannot import from `src`; `appBadgeParity.test.ts`
          fails if the two drift, and if the provider stops fetching that many.
        - **Nothing is delivered by remembering to deliver it.** The alert
          producers (poll-govee, watchdog, notify-milestones, tasks-tick) push
          instantly and stamp `app_notifications.pushed_at` as they insert.
          Anything left NULL is swept by `push-pending.mjs` (every 5 min,
          `0047`) — which is how the QuickBooks alerts finally reach a phone:
          `qbo_sync_failed` / `qbo_auth_expired` are raised by TRIGGERS in
          0017, inside the database, where there was no sender to call, so
          seven of them went out to nobody in three weeks while the preference
          toggle sat there looking functional.
          A trigger calling out via `pg_net` would need a shared secret stored
          IN the database, which a migration in this repo cannot carry — hence
          a sweep, at the cost of minutes of latency on the alerts that do not
          need to be instant.
          `pushed_at` means "delivery has been dealt with", NOT "a push was
          sent": a row nobody opted into is stamped too. The sweeper caps at
          `WINDOW_HOURS` and stamps anything older WITHOUT sending — after an
          outage the crew should not get a day's alerts at once.
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
  (1300 tests green as of 2026-08-17.)
- `npm test` — Vitest: domain math (`tentGrid`, `geo`, `incubation`, `cost`,
  `crewRoute`, `shelterOverrides`, `fieldWarnings`, `grants`, `stats`,
  `weather`, `analysisImport`, `analysisRelations`), row mappers, the
  permission matrix, and the maps helpers (`overlays`, `exports`, `importBoundary`).
- `npm run lint:tokens` — fails on raw hex outside the token layer (see Hard rules).

## Known gaps / next up
- ~~**Perf:** `SupabaseProvider` hydrates ~16k readings and ~4.6k trays on
  mount~~ — FIXED, and the note was stale enough to send someone optimising
  finished work. Readings are fetched PER INCUBATOR at `limit 20` (a single
  global "recent" query only covers whichever incubators logged last, so every
  card would not get its latest reading); trays load lazily via `loadTrays()`,
  guarded by a promise ref, and only from screens that need them.
- **Google Calendar two-way sync is half-built:** migration `0024` is NOT
  applied (`gcal_connection` / `gcal_synced_events` do not exist), and there is
  no UI to connect an account. `gcal-sync` was scheduled hourly against those
  tables and 500ed every hour in silence; its schedule is now REMOVED and the
  function returns 501 rather than throwing. The read-only ICS feed
  (`calendar-feed`) is a different thing, is applied, and works.
- **react-router has two moderate advisories** that need a v7 major upgrade.
  The issue is SSR hydration (`deserializeErrors()`) and this app is
  client-only with no SSR, so the real exposure is nil — deliberately deferred
  rather than forced.
- The `alerts` table (from the old app) is populated but not surfaced in the UI —
  distinct from the new `app_notifications` system.
- VOC subsystem (`voc_runs` / `voc_readings` / `voc_alert_events`) has data and
  schema but no UI.
- PASS-FOLLOWING placement mode is still unported (`NotPortedError`) — see Phase 2.
- `xray_live_pct` may be stored as a fraction (0.86) or a percent (86); the
  Samples UI normalises (>1 ⇒ ÷100), but the true convention is unconfirmed.
  (`field_analysis` has no such ambiguity — percent columns are 0–100 by CHECK.)
- ~~**Analysis migration 0014 is written but NOT yet applied**~~ — applied, and
  the real rows ARE imported (confirmed 2026-08-19: the Analysis screens render
  live data from `field_analysis`). `weather-fetch` still needs
  `SUPABASE_SERVICE_ROLE` in Netlify env, and `analysis-ai` needs
  `ANTHROPIC_API_KEY` (already set if grants-pull works).
- `field_analysis.shelter_field_id` is never populated — the link to
  `shelter_fields` exists in the schema but nothing matches names to fields yet.
