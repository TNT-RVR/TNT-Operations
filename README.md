# TNT Operations

Web app for a leafcutter-bee pollination operation — combining **Shelter Maps**
(bee-shelter placement on pollination fields) and **Incubation** (incubator
tracking, inspections, live sensor readings) into a single app with separate
sections.

Replaces two former Python/Tkinter desktop apps (`beetent-maps`, `bee-incubation`).

## Stack
React + TypeScript + Vite + Tailwind CSS + MapLibre GL. Deploys to Netlify.
Planned backend: Supabase (Postgres + Auth + Edge Functions).

## Quick start (no secrets needed)
```bash
npm install
npm run dev        # opens on http://localhost:5173, runs on seeded mock data
```
The app runs entirely on in-browser mock data by default (`VITE_DATA_SOURCE=mock`),
so you can build features without any backend credentials.

Copy `.env.example` → `.env` and adjust only when you need the live backend.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (mock data) |
| `npm run build` | Type-check + production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest (pure domain functions) |
| `npm run preview` | Preview a production build |

## Layout
```
src/
  components/   ui.tsx (design system), Layout, Protected
  auth/         session.tsx — users, roles, can(module, action)
  data/         useData() seam: context.ts, AppData.tsx (mock), seed.ts, types.ts
  domain/       pure tested math: incubation, geo, tentGrid (port targets)
  features/     dashboard, maps, incubation, sensors, users
```

## Onboarding a developer/admin
See [docs/darren-onboarding.md](docs/darren-onboarding.md).

## Design note
The visual system was seeded from a one-time, rebranded copy of generic UI
scaffolding. This project shares **no code, repo, or dependency** with any other
app and can be transferred/owned entirely on its own.
