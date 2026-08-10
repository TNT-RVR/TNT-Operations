# Google Calendar sync

Incubation milestones appear on each person's own Google Calendar, updated
hourly. **One-way** — the app owns the schedule.

## What it does

Each user connects their own Google account under **Users & Settings →
Integrations**. The app creates a calendar called **"TNT Operations —
Incubation"** in that account and keeps it in step with the milestones for every
running incubator: Incubation Start, Vapona In, Vapona Out, Earliest We Can
Cool, 10% Male Emergence, Expected Release, Latest Release.

Per user, not per company. One person disconnecting cannot take the calendar
away from anyone else.

**Edits made in Google are overwritten.** Milestones are *computed* from a run's
start date, so there is no coherent meaning to dragging "Earliest We Can Cool"
two days later. Events say so in their description.

**Stale events are deleted.** When a run's start date moves, every milestone
moves with it and the old events are removed. Without that you'd see two
"Vapona Out" dates and no way to tell which is real — that's the failure this
was built to avoid, and it's the reason there's a bookkeeping table.

The window is 30 days back and a year forward. A calendar holding every
milestone since installation is unreadable.

---

## 1. Create the Google Cloud project (20 minutes)

1. **https://console.cloud.google.com** → new project, e.g. `TNT Operations`.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → **External**.
   - App name, support email, developer contact.
   - **Authorised domain:** `tntoperations.netlify.app` (or your own once you
     have one pointed at the app).
   - Links to a homepage and a privacy policy. Both are required to publish.
4. **Scopes** → add **`.../auth/calendar.app.created`** only.

   That scope reaches **only calendars this app created**. It cannot see or
   touch anyone's personal calendar — which is both the right security posture
   and a materially smaller ask in Google's review than full calendar access.
   Do not add `auth/calendar`.

5. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorised redirect URI**, matched exactly:
     ```
     https://tntoperations.netlify.app/.netlify/functions/gcal-auth?action=callback
     ```

## 2. Netlify environment variables

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from the OAuth client |
| `GOOGLE_CLIENT_SECRET` | from the OAuth client |
| `GOOGLE_REDIRECT_URI` | the exact URI above |

No `VITE_` prefix — that would compile the client secret into the browser
bundle. **Redeploy afterwards**, or the functions won't see them.

## 3. Run the migration

`supabase/migrations/0022_google_calendar.sql`.

```sql
select (select count(*) from gcal_connection) as connections,
       (select count(*) from gcal_synced_events) as events;
```

Both **0** until someone connects.

## 4. Connect

**Users & Settings → Integrations → Google Calendar → Connect.**

Then **Sync now** — it reports how many events were added, updated and removed.
After that it runs hourly on its own.

---

## The two things that will surprise you

**Until the app is verified, connections die after 7 days.**

An unverified External app sits in **Testing** mode. Add each person under
**OAuth consent screen → Test users** (up to 100), and every one of them has to
reconnect weekly. That's workable for you and Darren while testing. It is not
something to hand a grower.

**Publishing needs Google's verification review.**

Calendar is a *sensitive* scope, so **Publish app** triggers a review: verified
domain ownership, a live privacy policy, a homepage, and usually a short demo
video showing what you do with the data. Days to a few weeks. `calendar.app.created`
is the narrowest Calendar scope there is, which makes this review as easy as it
can be — but there's no way to skip it for Gmail users.

If the domain move to `tntpollination.com` happens first, verify against that
rather than the Netlify subdomain — it's a stronger application and you won't
have to redo it.

---

## Things worth knowing

**Google issues a refresh token only once**, on first consent. The connect flow
therefore forces the consent screen every time (`prompt=consent`); without it,
reconnecting yields an access token with no refresh token and the sync dies
quietly an hour later. If you ever see "Google did not return a refresh token",
remove the app at **myaccount.google.com → Security → Third-party apps** and
connect again.

**Deleting the calendar in Google is safe.** The next sync notices it's gone,
creates a new one and repopulates it.

**Turning sync off** keeps the connection but stops writing — useful for
pausing without re-authorising.

To trigger a sync for everyone by hand:

```bash
curl "https://tntoperations.netlify.app/.netlify/functions/run?fn=gcal-sync&token=$FN_RUN_TOKEN"
```

---

## Where the code lives

| Piece | File |
|---|---|
| Event shape, ids, diffing, window | `src/domain/calendarSync.ts` |
| OAuth start/callback/disconnect | `netlify/functions/gcal-auth.mjs` |
| Push and delete | `netlify/functions/gcal-sync.mjs` |
| Tokens, refresh, API wrapper | `netlify/functions/lib/gcal.mjs` |
| Milestone mirror | `netlify/functions/lib/gcalConstants.mjs` |
| Schema | `supabase/migrations/0022_google_calendar.sql` |

A Netlify function can't import from `src/`, so the milestone table, the
day→date offset and the event-id derivation exist **twice**. That duplication is
only safe because `src/domain/calendarSync.test.ts` imports the mirror and
asserts it still matches the domain — change a milestone in
`src/domain/incubation.ts` and that test fails. Don't delete it.
