/**
 * Push incubation milestones to each connected user's Google Calendar.
 *
 *   POST /.netlify/functions/gcal-sync            (signed in) → sync just me
 *   scheduled, hourly                             → sync everyone connected
 *
 * One-way: the app owns the calendar. Anything edited in Google is overwritten.
 *
 * ── Milestones are recomputed here, not read from a table ────────────────────
 *
 * They are DERIVED from each incubator's start date (or, absent one, the date
 * most of its active trays went in), so there is no stored list to read. That
 * logic lives in `lib/gcalConstants.mjs` because a Netlify function cannot
 * import from `src/` — and `src/domain/calendarSync.test.ts` asserts the mirror
 * still agrees with the domain, so it cannot drift unnoticed.
 */
import {
  CALENDAR_DESCRIPTION_TEXT,
  CALENDAR_SUMMARY_TEXT,
  addDays,
  eventIdFor,
  milestoneEvents,
  syncWindow,
} from './lib/gcalConstants.mjs'
import {
  callerId,
  db,
  enabledConnections,
  ensureCalendar,
  env,
  gcalFetch,
  getConnection,
} from './lib/gcal.mjs'

/**
 * NOT SCHEDULED, deliberately.
 *
 * This ran hourly ('17 * * * *') against `gcal_connection` — a table migration
 * 0024 creates and which was never applied. `enabledConnections()` therefore
 * threw, outside any try, so the function 500ed every hour of every day. A
 * failed scheduled function is silent: nothing alerts, and the only trace is in
 * Netlify's logs.
 *
 * The two-way sync also has no UI — Settings offers the read-only ICS feed
 * (`calendar-feed`, which works and is unaffected) and no way to connect a
 * Google account at all. So the schedule was burning a slot for a feature
 * nobody could reach.
 *
 * The function still works when POSTed to, so finishing the feature means
 * applying 0024, building the connect flow, and restoring this line:
 *
 *   export const config = { schedule: '17 * * * *' }
 */

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const TZ = 'America/Edmonton'

const todayInTz = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  )

/** Every milestone currently in the sync window, across all incubators. */
async function currentMilestones() {
  // Trays are only needed for incubators with no explicit start date, but
  // fetching the active ones is one small request either way.
  const [incubators, trays] = await Promise.all([
    db().get('incubators?select=id,name,incubation_start,temp_mode&order=name'),
    db().get('trays?status=eq.active&select=incubator_id,status,in_date'),
  ])

  return syncWindow(milestoneEvents(incubators, trays), todayInTz()).map((m) => ({
    ...m,
    eventId: eventIdFor(m.incubatorId, m.day, m.label),
    summary: `${m.incubatorName} — ${m.label} (Day ${m.day})`,
  }))
}

/** Push one user's calendar into line. Returns a small summary. */
async function syncOne(conn, milestones) {
  const result = { userId: conn.user_id, created: 0, updated: 0, removed: 0, unchanged: 0, errors: [] }

  const withCal = await ensureCalendar(conn, CALENDAR_SUMMARY_TEXT, CALENDAR_DESCRIPTION_TEXT)
  const cal = encodeURIComponent(withCal.calendar_id)

  const synced = await db().get(`gcal_synced_events?user_id=eq.${conn.user_id}&select=event_id,event_date,summary`)
  const bySynced = new Map(synced.map((s) => [s.event_id, s]))
  const wanted = new Set(milestones.map((m) => m.eventId))

  for (const m of milestones) {
    const prev = bySynced.get(m.eventId)
    // Skip unchanged: a full re-push rewrites every `updated` timestamp, which
    // makes every event look freshly changed in someone's notification feed.
    if (prev && prev.event_date === m.date && prev.summary === m.summary) {
      result.unchanged++
      continue
    }

    const body = {
      id: m.eventId,
      summary: m.summary,
      description: 'From TNT Operations. Edits here are overwritten on the next sync.',
      start: { date: m.date },
      // Google's all-day end is EXCLUSIVE.
      end: { date: addDays(m.date, 1) },
      status: 'confirmed',
    }

    try {
      if (prev) {
        await gcalFetch(withCal, `/calendars/${cal}/events/${m.eventId}`, { method: 'PUT', body })
        result.updated++
      } else {
        // Insert with our own id. A 409 means it is already there — which
        // happens when our bookkeeping was lost but the calendar was not, so
        // fall back to overwriting rather than failing.
        try {
          await gcalFetch(withCal, `/calendars/${cal}/events`, { method: 'POST', body })
          result.created++
        } catch (e) {
          if (!/409|duplicate|already exists/i.test(e.message)) throw e
          await gcalFetch(withCal, `/calendars/${cal}/events/${m.eventId}`, { method: 'PUT', body })
          result.updated++
        }
      }
      await db().write(
        'POST',
        'gcal_synced_events?on_conflict=user_id,event_id',
        {
          user_id: conn.user_id,
          event_id: m.eventId,
          event_date: m.date,
          summary: m.summary,
          synced_at: new Date().toISOString(),
        },
        'resolution=merge-duplicates,return=minimal',
      )
    } catch (e) {
      result.errors.push(`${m.summary}: ${e.message}`)
    }
  }

  // Removals. Without this a run whose start date moves leaves its old
  // milestones behind, and a crew sees two "Vapona out" dates.
  for (const s of synced) {
    if (wanted.has(s.event_id)) continue
    try {
      await gcalFetch(withCal, `/calendars/${cal}/events/${s.event_id}`, { method: 'DELETE' })
      await db().write(
        'DELETE',
        `gcal_synced_events?user_id=eq.${conn.user_id}&event_id=eq.${s.event_id}`,
        undefined,
        'return=minimal',
      )
      result.removed++
    } catch (e) {
      result.errors.push(`delete ${s.event_id}: ${e.message}`)
    }
  }

  await db().write(
    'PATCH',
    `gcal_connection?user_id=eq.${conn.user_id}`,
    {
      last_synced_at: new Date().toISOString(),
      last_error: result.errors.length ? result.errors[0].slice(0, 300) : '',
    },
    'return=minimal',
  )

  return result
}

export default async (req) => {
  const { missing } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)

  const milestones = await currentMilestones()

  // A signed-in caller syncs only themselves; the scheduled run has no caller
  // and does everyone. Same code path, so the manual button proves the cron.
  const userId = req.method === 'POST' ? await callerId(req) : null

  if (userId) {
    const conn = await getConnection(userId)
    if (!conn) return json({ error: 'Google Calendar is not connected' }, 409)
    if (conn.disconnected_at) return json({ error: 'Google Calendar is disconnected — reconnect it' }, 409)
    try {
      return json({ ok: true, ...(await syncOne(conn, milestones)) }, 200)
    } catch (e) {
      return json({ ok: false, error: e.message }, 400)
    }
  }

  // Tolerated rather than thrown: if 0024 has not been applied this table does
  // not exist, and an unhandled throw here is what made the old schedule fail
  // silently every hour instead of saying anything useful.
  let conns = []
  try {
    conns = await enabledConnections()
  } catch (e) {
    console.warn('[gcal-sync] could not read connections:', e.message)
    return json({ ok: false, error: `Google Calendar is not set up: ${e.message}` }, 501)
  }
  const results = []
  for (const conn of conns) {
    try {
      results.push(await syncOne(conn, milestones))
    } catch (e) {
      // One dead connection must not stop the rest.
      results.push({ userId: conn.user_id, errors: [e.message] })
    }
  }

  const summary = { connections: conns.length, milestones: milestones.length, results }
  console.log('[gcal-sync]', JSON.stringify(summary))
  return json(summary, 200)
}
