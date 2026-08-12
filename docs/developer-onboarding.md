# Onboarding — New Developer

Everything a new developer needs to get access, run TNT Operations locally, and
ship changes to it using Claude Code the way the rest of the team does.

Work top to bottom. Sections 1–2 get you running in about 15 minutes **without
any production credentials**. Sections 3–5 are how you actually ship.

Replace `<NAME>` / `<EMAIL>` below with the new developer's details.

---

## 0. What this app is (read first, 10 minutes)

TNT Operations is field-ops software for a **commercial leafcutter-bee
pollination business** — not honey bees, and the difference drives the whole
data model. Before writing code, read in this order:

1. **`CLAUDE.md`** — architecture, the hard rules, current migration status.
   This is the file Claude Code loads automatically; treat it as binding.
2. **`docs/web-rebuild-spec.md`** — the authoritative product spec: the
   business, every field-JSON key, every placement formula, the cost math.
   When porting or changing behaviour, this outranks guesses from the code.
3. **`docs/design-system.md`** — the visual rules (dark-first, honey-only,
   tokens only).

The three rules that get violated most often, so know them now:

- **Screens talk ONLY to `useData()` and `useSession()`** — never import a
  backend directly from a feature. Two providers implement the same contract
  (mock + Supabase); **any new context method must be added to BOTH**.
- **Business/geometry math lives in `src/domain/`** as pure, tested functions —
  no React, no DB. Add a test alongside any new domain function.
- **Tokens only.** No raw hex or arbitrary px in a component. `npm run
  lint:tokens` enforces it (map files are the one allow-listed exception,
  because MapLibre paint can't read CSS variables).

---

## 1. Local development — needs NO secrets

The app defaults to seeded mock data, so you can build features without ever
touching a real credential.

1. Install **Node 20+** and **git**.
2. Clone and run:

```bash
git clone https://github.com/TNT-RVR/TNT-Operations.git tnt-operations
cd tnt-operations
npm install
cp .env.example .env      # leave VITE_DATA_SOURCE=mock
npm run dev
```

3. Open the local URL Vite prints. You get the full app on demo data: fields,
   incubators, grants, the lot.

**Mock mode is the default for a reason** — develop against it. You only need
section 3's access to see real data or touch the live backend.

### The quality gate — keep this green before every push

```bash
npm run typecheck && npm test && npm run lint:tokens && npm run build
```

All four must pass. Tests are Vitest and fast (a couple of seconds); there are
300+ and they exist because this app's geometry has a history of subtle,
expensive bugs. **Do not "fix" a failing test by weakening it** — if a change
makes the §5.3 band-width test fail, the change is wrong, not the test.

---

## 2. App access (what `<NAME>` needs from Tyler)

An **admin** invites them from inside the app — no Supabase dashboard needed:

1. Tyler opens https://tntoperations.netlify.app → **Users** → **Invite user**.
2. Enter `<EMAIL>`, name, role **developer**.
3. They get an email, click the link, and choose their own password. Nobody else
   ever handles it.

Roles: `admin` and `developer` = full access · `operator` = run maps/incubation/
sensors but not user admin · `viewer` = read-only · `pending` = no access.

---

## 3. Infrastructure access (invite, never paste keys)

Grant each from the service's own dashboard so they get their own login.
Membership *is* the access — these keys should never travel over chat or email.

- [ ] **GitHub** — collaborator on `TNT-RVR/TNT-Operations`.
- [ ] **Netlify** — team member on the `tntoperations` site.
- [ ] **Supabase** — member of project `pmqbkezevsuwkoryxief`.

> ⚠️ **The Supabase project is SHARED with the older beetent-maps app.** TNT's
> field table is `public.shelter_fields`, not `public.fields`, and notifications
> are `app_notifications`. **Never DROP or ALTER the old app's tables**
> (`fields`, `crews`, `scans`, …).

### Server-side secrets

These live in **Netlify → Site configuration → Environment variables** (the
functions read them) and must never be committed or `VITE_`-prefixed — a
`VITE_` prefix ships the value to the browser.

| Variable | Used by |
|---|---|
| `SUPABASE_SERVICE_ROLE` | all functions; bypasses RLS — treat as root |
| `GOVEE_API_KEY` | `poll-govee.mjs` — sensor polling |
| `ANTHROPIC_API_KEY` | `grants-pull.mjs` — weekly grant discovery |
| `FN_RUN_TOKEN` | `run.mjs` — manual trigger for the scheduled jobs |
| `HEALTH_TOKEN` | `health.mjs` — the monitoring heartbeat (falls back to `FN_RUN_TOKEN`) |
| `SENSIBO_API_KEY` | `sensibo.mjs` — incubator heat-pump control |

The only browser-safe values are `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (the anon key is public by design; RLS is what protects
the data).

If someone genuinely needs a secret locally, send it via a **shared password
manager**, not chat.

---

## 4. Working with Claude Code

This is how the app has been built, and it's the workflow to keep.

### Setup

1. Install Claude Code (`claude.ai/code` or the desktop app).
2. Open it **with the repo as the working directory** — this matters, because
   Claude auto-loads `CLAUDE.md` from the project root and follows it.
3. That's it. No extra config; the repo carries its own rules.

### What makes it work well here

- **`CLAUDE.md` is the contract.** It encodes the data seam, the design tokens,
  the tray-identity rule, and the shared-Supabase warnings. When you learn
  something the hard way, **add it to `CLAUDE.md`** so the next session doesn't
  repeat it. Several sections exist precisely because a bug happened once.
- **Point it at the spec.** For anything touching fields, placement, or costs,
  say "follow `docs/web-rebuild-spec.md` §X". The spec is authoritative and
  Claude will follow it over inventing behaviour.
- **Ask for tests with domain logic.** "Add it to `src/domain/` with a Vitest
  file" gets pure, tested code instead of logic buried in a component.
- **Make it verify, not just claim.** Ask it to run
  `npm run typecheck && npm test && npm run build` and to check the result in a
  browser before saying something works. It can drive a browser and read the
  DOM, console and network.
- **Small, reviewable commits** with a message that says *why*, not just what.

### Things to be careful about

- **Another session may be editing the same files.** More than one Claude
  session has worked in this repo simultaneously. `git pull` before you start
  and before you push; expect merges.
- **Migrations are numbered and sequential** (`supabase/migrations/NNNN_*.sql`).
  Take the next free number, and check nobody else has claimed it. Claude
  cannot run them for you — **an admin pastes the SQL into the Supabase SQL
  editor**, so a change isn't live until that happens.
- **Claude can't see images you paste** into chat as files on disk. If it needs
  an asset, save it into the repo and tell it the path.
- **Verify visual claims yourself.** Screenshots don't work in every Claude
  environment. If it says "looks right", ask how it knows.

### A good first task

Pick something small and end-to-end so you touch every layer: a new read-only
column in an existing table view, or a new field on the cost estimator. That
exercises the data seam, the design tokens, and the quality gate in one go.

---

## 5. How a change ships

1. Branch from `main` (or work on `main` for small changes — the team does both;
   ask Tyler which he prefers for anything large).
2. Make the change; keep the quality gate green.
3. Commit and push. **Netlify auto-deploys `main`** — there is no manual deploy
   step, so a push to `main` is a production release.
4. If it needed a migration, get an admin to run the SQL. **The deploy will be
   live before the migration is** — write code that degrades gracefully when a
   table doesn't exist yet (the providers already log a warning and fall back to
   empty rather than crashing).
5. Check the live site.

### Scheduled jobs

Several functions run on cron in Netlify — `poll-govee` (sensor polling, every
15 min), `watchdog` (hourly), `grants-pull` (Mondays), `tasks-tick`,
`notify-milestones`, `gcal-sync`. Netlify **refuses direct HTTP invocation of
scheduled functions** (403). To run one manually:

```bash
curl "https://tntoperations.netlify.app/.netlify/functions/run?fn=grants-pull&token=$FN_RUN_TOKEN"
```

…or use **Run now** on the Netlify Functions page. `run.mjs` is a background
function (15-minute limit) because some jobs exceed the ~10 s synchronous cap.

### How the incubator monitoring fails safe

Worth understanding before changing any of it, because the failure this guards
against is a silent one. Alerts only fire when a reading ARRIVES, so a dead
sensor, a flat battery, a revoked Govee key or a crashed poller all look
identical to "everything is fine". Nothing watched these incubators between
2026-07-23 and 2026-08-05 and nobody noticed.

Three layers, each catching what the one before it cannot:

| Layer | Where | Catches |
|---|---|---|
| Temperature rules | `poll-govee.mjs`, every 15 min | readings outside the mode's band |
| `watchdog.mjs` | its own hourly schedule | an incubator that has gone quiet — 60 min while running, 24 h while idle. Pushes, and posts an all-clear |
| `health.mjs` + GitHub Actions | `.github/workflows/monitor-heartbeat.yml`, every 30 min | Netlify not running scheduled functions AT ALL — the one thing nothing inside Netlify can report |

The watchdog is deliberately NOT inside the poller: a health check that stops
when the thing it checks stops is decoration. Likewise the heartbeat lives on
GitHub, so silence now needs two providers broken at once.

`health.mjs` answers in a status code — 200 healthy, 503 stale — and its
staleness bar follows whether anything is actually running (60 min if so, 7 h
if every incubator is off, since idle ones only poll every 6 hours). Check it
by hand, and check that it can still FAIL:

```bash
curl -sS "https://tntoperations.netlify.app/.netlify/functions/health?token=$HEALTH_TOKEN"
curl -sS "https://tntoperations.netlify.app/.netlify/functions/health?token=$HEALTH_TOKEN&staleMinutes=1"
```

The GitHub side needs two repository secrets — `SITE_URL` and `HEALTH_TOKEN`
(Settings → Secrets and variables → Actions). Without them the workflow skips
rather than failing every 30 minutes, because a permanently red workflow is one
nobody reads.

---

## 6. Known gaps worth knowing before you start

Current at the time of writing — check `CLAUDE.md`'s "Known gaps" for the live
list:

- **PASS-FOLLOWING placement is unported** — `getTentPositions` throws
  `NotPortedError` if a field ever uses it (spec §5.5).
- **Email notification delivery** isn't built; the preference toggles store the
  choice but nothing sends.
- `xray_live_pct` may be stored as a fraction (0.86) or a percent (86); the UI
  normalises but the true convention is unconfirmed.

---

## 7. Repository handoff note

The project is self-contained: its own repo, its own Netlify site, and a
Supabase project it *shares* with the legacy beetent-maps app. It has no shared
code with any other application. Keep it that way.
