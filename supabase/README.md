# Supabase — TNT Operations backend

Postgres schema, roles, and Row-Level Security for the `supabase` data source.
The app runs fully on **mock** data without any of this; you only need Supabase
to run the live backend (`VITE_DATA_SOURCE=supabase`).

## Apply the migrations

**Option A — SQL editor (quickest):** open the Supabase dashboard → SQL editor,
paste `migrations/0001_init.sql`, run it, then `migrations/0002_seed.sql`. Both
are re-runnable.

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies everything in migrations/
```

## What it creates

- `profiles` — one row per Supabase Auth user, carrying their app role
  (`admin` | `developer` | `operator` | `viewer`). A trigger auto-creates a
  profile (default `viewer`) on signup; an admin promotes users afterward.
- `fields`, `incubators`, `inspections`, `sensor_readings` — columns match
  `src/data/types.ts`. `fields.data` (jsonb) holds the full field-authoring
  payload the shelter-grid engine consumes.
- **RLS** mirroring `src/auth/session.tsx`: any signed-in user may read; only
  `admin`/`developer`/`operator` may write operational data; only
  `admin`/`developer` manage users. Role checks use SECURITY DEFINER helpers
  (`app_role()`, `can_edit()`, `is_admin()`) so they don't recurse through RLS.
- **Realtime** on `sensor_readings` and `inspections`.

## Auth requirement

RLS is keyed to `auth.uid()`, so **`supabase` mode needs a signed-in user** —
the browser anon key alone (no session) is denied by RLS, which is intended.
Wiring Supabase Auth into `useSession()` (replacing the mock user switcher) is
the natural follow-up; the schema + policies here are already built for it.

Server-side writers (the Phase 6 Govee poller / ESP32 endpoint) use the
`service_role` key inside Edge Functions, which bypasses RLS. That key is a
full-access secret — it lives only in Supabase/Netlify env settings, never in
this repo or any `VITE_`-prefixed variable. See `docs/darren-onboarding.md`.
