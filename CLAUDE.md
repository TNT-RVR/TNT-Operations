# CLAUDE.md — TNT Operations

Combined web app for a leafcutter-bee pollination operation. Merges two former
Python desktop apps into one React site with separate sections:

- **Shelter Maps** — bee-shelter placement on pollination fields (was `beetent-maps`).
- **Incubation** — incubator tracking, inspections, live sensor readings (was `bee-incubation`).

Stack: **React + TypeScript + Vite + Tailwind + MapLibre**. Deploys to Netlify.
Backend (planned): **Supabase** (Postgres + Auth + Edge Functions).

> This project is **independent** of Grand Forks Concrete/Gravel. The design
> system was seeded from a one-time copy of Concrete's generic UI scaffolding and
> then rebranded — there is NO shared code, repo, or dependency. Keep it that way.

## Architecture (don't break the seam)
- Screens talk ONLY to `useData()` (`src/data/context.ts`) and `useSession()`
  (`src/auth/session.tsx`). Never import a backend directly from a feature.
- Two providers implement `DataContextValue`: `MockProvider` (in `AppData.tsx`,
  seeded from `src/data/seed.ts`) and — once built — `SupabaseProvider`. Selected
  by `VITE_DATA_SOURCE` (`mock` | `supabase`). Any new context method must be
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
  - **Type.** Montserrat (`font-display`) for headings; IBM Plex Sans (`font-sans`)
    for body/UI; IBM Plex Mono (`font-mono` + `.tabular`) for ALL numbers, metrics,
    eyebrows, and labels. Eyebrows/labels/badges are UPPERCASE, wide tracking.
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
  Supabase/Netlify env settings. See `docs/darren-onboarding.md`.
- **Shared Supabase project:** by decision (2026-07-24) TNT reuses the existing
  `pmqbkezevsuwkoryxief` project (the old beetent-maps backend) rather than a new
  one. To avoid colliding with that app's `public.fields` (company/year/name +
  jsonb), TNT's fields table is `public.shelter_fields`. All other TNT tables
  don't collide. Never DROP/ALTER the old app's tables (crews/scans/fields/…).

## Migration status (porting the two Python apps)
- [x] Phase 1 — scaffold, design system, auth/roles, data seam, section shells.
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
- [~] Phase 4/5 — feature UIs (in progress):
      - Shelter Maps: field geometry flows through the data seam
        (`Field.geometry`, mapped from Supabase `fields.data`); `MapsHome`
        renders live `getTentPositions` pins + boundary/pivot on MapLibre. A
        `FieldEditor` panel edits placement params with LIVE preview (recompute
        on every change), persists via `saveField` (added to BOTH providers),
        click-to-move pivot, and a create-pivot bootstrap for geometry-less
        fields. Gated by `can('maps','edit')`. Verified in-browser (live
        recompute + save + SPA remount, 0 errors). TODO: freehand boundary
        DRAWING (needs a draw lib), shelter list/export.
      - Incubation: clickable incubator cards open an `IncubatorDetail` modal —
        progress + incubation day (`getIncubationDay`), latest reading + target,
        threshold alerts, a dependency-free SVG `ReadingsChart` (temp vs target),
        inspection history, and an add-inspection form (`addInspection`, inspector
        = session user, gated by `can('incubation','edit')`). Verified in-browser.
- [ ] Phase 6 — integrations: Govee poller + ESP32 endpoint (Edge Functions),
      email reports, PDF/KML/shapefile export.
- [~] Phase 7 — data import (started):
      - Full incubation schema ported into the SAME Supabase project
        (`0003_incubation_full.sql`): batches, samples, trays, rich inspections,
        alerts, settings + VOC subsystem; 0001's incubators/inspections widened
        to supersets so the app keeps working. `scripts/import_incubation.py`
        turns a populated `incubation.db` into paste-able SQL (int ids → UUIDs).
        NOTE: the current `incubation.db` has no operational data (only default
        presets/settings), so nothing to import yet — confirm if real data lives
        elsewhere (shop tablet?).
      - TODO: fields/*.json import; app data-model + Incubation UI to adopt the
        full model (batches/samples/trays); Firebase (if still needed).

## Dev
- `npm run dev` — runs on mock data, no backend needed.
- `npm run typecheck && npm test && npm run build` — keep this green before pushing.
- `npm test` — Vitest (domain functions).
