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

## Left off (2026-07-22) — Phase 1 COMPLETE ✅
Scaffolded the combined app: React + TS + Vite + Tailwind + MapLibre. Verified in
browser (dashboard + live MapLibre map render, 0 console errors), typecheck clean,
7/7 tests pass, build succeeds, first git commit made.
- Design system rebranded (honey-amber `brand` + field-green `field`).
- `useData()` seam with `MockProvider`; Supabase provider still a TODO.
- Role auth (`admin`/`developer`/`operator`/`viewer`) + route gating.
- Sections: dashboard, maps, incubation, sensors, users (shells).
- Tested domain fns: `incubation.ts`, `geo.ts`. `tentGrid.ts` = stub/port target.

## Next — Phase 2 (recommended)
1. **Port `get_tent_positions()`** → `src/domain/tentGrid.ts` as pure functions.
   Build **golden-file tests**: run 5–10 real `fields/*.json` through the OLD
   Python to capture expected pin coords, then assert the TS matches (~1 m).
2. **Reconcile `incubation.ts`** stage boundaries against `incubation_calc.py`;
   lock with test cases.
3. Then Phase 3 = Supabase schema + `SupabaseProvider` (see `CLAUDE.md` checklist).

## Not yet done
- No GitHub remote / push yet (needed to hand to Darren — see
  `docs/darren-onboarding.md`).
- No Supabase project, no live sensor polling, no exports.
