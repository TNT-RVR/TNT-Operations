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
- Theme: honey-amber (`brand`) + field-green (`field`) on white. **Any `bg-brand`
  or `bg-field` background → white text.** Use `.btn-primary`, `.btn-ghost`,
  `.btn-field`, `.card`, `.input`, `.label`, `.th`, and the `Badge`/`Modal`/
  `Gauge`/`StatTile` helpers in `src/components/ui.tsx`.
- Gate sections with `s.can('<module>', 'edit')`; route gating is in
  `src/components/Protected.tsx`. Section keys live in `MODULES` (`auth/session.tsx`).
- Secrets never go in the repo or in any `VITE_`-prefixed var except the public
  Supabase URL/anon key. Server secrets (Govee key, service role, SMTP) live in
  Supabase/Netlify env settings. See `docs/darren-onboarding.md`.

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
- [ ] Phase 4/5 — full Incubation & Shelter Maps UIs (field editor, inspections).
- [ ] Phase 6 — integrations: Govee poller + ESP32 endpoint (Edge Functions),
      email reports, PDF/KML/shapefile export.
- [ ] Phase 7 — data import from old SQLite / `fields/*.json` / Firebase.

## Dev
- `npm run dev` — runs on mock data, no backend needed.
- `npm run typecheck && npm test && npm run build` — keep this green before pushing.
- `npm test` — Vitest (domain functions).
