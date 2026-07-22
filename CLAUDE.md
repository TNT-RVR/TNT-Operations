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
- [ ] Phase 2 — port math to `src/domain/`: `get_tent_positions` (from
      `beetent-maps/maketentgrid.py`) → `tentGrid.ts` with golden-file tests from
      real `fields/*.json`; reconcile `incubation.ts` with `incubation_calc.py`.
- [ ] Phase 3 — Supabase schema + migrations + RLS + `SupabaseProvider`.
- [ ] Phase 4/5 — full Incubation & Shelter Maps UIs (field editor, inspections).
- [ ] Phase 6 — integrations: Govee poller + ESP32 endpoint (Edge Functions),
      email reports, PDF/KML/shapefile export.
- [ ] Phase 7 — data import from old SQLite / `fields/*.json` / Firebase.

## Dev
- `npm run dev` — runs on mock data, no backend needed.
- `npm run typecheck && npm test && npm run build` — keep this green before pushing.
- `npm test` — Vitest (domain functions).
