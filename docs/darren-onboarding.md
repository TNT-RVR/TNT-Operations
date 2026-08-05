# Onboarding — Darren (Admin / Developer)

> **⚠️ Superseded — use [`developer-onboarding.md`](developer-onboarding.md)
> for anyone new.** This file predates the in-app invite flow and still
> describes secrets living in Supabase Edge Function env (they're in Netlify).
> Kept only as the record of how Darren was set up.

This is the checklist to give Darren everything he needs to develop TNT
Operations and act as an app admin. Two separate things:

1. **Developer** = repo + infrastructure access (GitHub, Netlify, Supabase).
2. **App admin** = a user account inside the app with the `admin`/`developer` role.

He needs both. Work top to bottom.

---

## 1. Local development (needs NO secrets)

Send Darren these steps. He'll be running the app in ~10 minutes with zero
production credentials, because the app defaults to seeded mock data.

1. Install **Node 20+** and **git**.
2. Clone the repo and install:
   ```bash
   git clone <REPO_URL> tnt-operations
   cd tnt-operations
   npm install
   cp .env.example .env      # leave VITE_DATA_SOURCE=mock
   npm run dev
   ```
3. Read `CLAUDE.md` (architecture + hard rules) and this file.
4. Keep the tree green before pushing:
   ```bash
   npm run typecheck && npm test && npm run build
   ```

> The **key point:** mock mode means Darren develops features without ever
> touching a real secret. Only the live backend + integrations need the items
> in section 3.

---

## 2. Access to grant (invite through each service — never paste keys)

Grant each of these from the service's own dashboard so Darren gets his own
login. **Do not send raw keys for these** — membership is the access.

- [ ] **GitHub** — add Darren as a collaborator on the repo (or to the org/team).
- [ ] **Netlify** — add him as a team member on the TNT Operations site.
- [ ] **Supabase** — invite him as a member of the Supabase project (once it
      exists, Phase 3). He reads project keys from the dashboard; he does not
      need them emailed.

---

## 3. Secrets that genuinely must be shared

These are the only values that can't be handled by "invite to dashboard." They
are **server-side** secrets — they must NOT go in the repo and must NOT be
`VITE_`-prefixed (that would ship them to the browser). They live in Supabase
Edge Function / Netlify environment settings.

| Secret | Used for | Where it lives |
|---|---|---|
| `GOVEE_API_KEY` | Sensor polling (Phase 6) | Supabase Edge Function env |
| `SUPABASE_SERVICE_ROLE` | Server writes / import scripts | Supabase / local script env |
| `RESEND_API_KEY` (or `SMTP_*`) | Email reports (Phase 6) | Supabase Edge Function env |
| `VITE_MAP_TILE_KEY` | Satellite basemap (optional) | Netlify env + local `.env` |

### How to share them safely
- **Preferred:** store them only in the Supabase/Netlify dashboards. As a project
  member, Darren reads/sets them there and they never travel over chat or email.
- **If he needs one locally** (e.g. `SUPABASE_SERVICE_ROLE` for a one-off import
  script): send via a **shared password-manager vault** (1Password / Bitwarden)
  or a one-time secret link. **Never** paste secrets into email, Slack, or a
  commit.

---

## 4. Make Darren an app admin

- **Mock mode:** he's already seeded as "Darren (Developer)" with the `developer`
  role (full access) in `src/auth/session.tsx` — pick him in the user switcher.
- **Live (Supabase) mode:** after he signs in once, an existing admin sets his
  role to `admin` or `developer` in Users & Settings.

Roles: `admin` and `developer` = full access; `operator` = run maps/incubation/
sensors but not user admin; `viewer` = read-only.

---

## 5. Repository handoff note

This project is fully self-contained — its own repo, Netlify site, and Supabase
project, with no shared code or dependency on any other app. If ownership ever
changes hands, transfer those three and nothing else is entangled.
