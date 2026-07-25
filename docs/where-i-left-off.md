# Where I left off — TNT Operations (incubation)

_Last updated 2026-07-24. Everything below is committed and pushed to `main` (deployed via Netlify)._

## The big picture
The incubation data was already live in Supabase but the app wasn't showing most of it.
Over this session I connected it through the app and built out the Incubation section.

## Done this round ✅
1. **Inspections** now use the real checklist (period, thermometer-vs-Govee temp + drift alert,
   heat-pumps/fans/black-lights/bees-emerging/parasites-emerging) instead of a stub health score.
2. **Samples, Trays & Batches** are now surfaced. Left nav → **Incubation** now has subsections:
   **Incubators · Samples · Trays**.
3. **Trays page** (`/incubation/trays`): full list with filters (search, incubator, sample,
   status, **year**), sortable columns, **CSV export**, and pagination (50/page).
4. **Tray history**: click a tray label to see every season that physical tray was used
   (year, sample, incubator, dates). Model: the physical labelled tray is permanent; each row is
   one season's usage; all history is kept.

## Start here when back 👇 (in priority order)
1. **Lock in the tray data rule (DB).** Decide where trays get written (desktop app vs
   `scripts/import_incubation.py` vs both), then:
   - add `unique (sample_id, tray_number)` on `public.trays`, and
   - make the writer **upsert** on `(sample_id, tray_number)` so moving a tray to a new incubator
     UPDATES the row instead of creating a duplicate. (New season + new sample = new row = history.)
2. **#3 — Alerts + performance.** Surface the ~319 alerts in the UI, and paginate the big loads
   (the app currently loads ~16k sensor readings AND ~4.6k trays on mount).
3. **#4 — VOC UI**, then exports/email reports (Phase 6).

## Open questions to resolve
- **Undated trays:** ~57% of trays have no dates, so they show as "Undated" (year is derived from
  out/cool/in dates — there's no season column). Is the real season stored anywhere?
- **xray_live_pct:** stored as a fraction (0.86) or percent (86)? The Samples UI normalizes
  (>1 ⇒ ÷100) but the true convention should be confirmed.

## How to run
- `npm run dev` → mock data, no secrets, http://localhost:5173 (or next free port).
- Keep green before pushing: `npm run typecheck && npm test && npm run build`.
- Live site: https://tntoperations.netlify.app (real Supabase, sign-in required).
