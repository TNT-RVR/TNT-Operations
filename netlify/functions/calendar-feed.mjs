/**
 * A subscribable .ics feed of incubation milestones.
 *
 *   GET /.netlify/functions/calendar-feed?token=…
 *
 * Subscribe to it once in Google Calendar and it stays current on its own. No
 * OAuth, no data sent back, nothing to reconnect.
 *
 * ── This endpoint is deliberately UNAUTHENTICATED ────────────────────────────
 *
 * Google fetches a subscribed feed from its own servers with no session, so
 * there is nothing to authenticate against. The unguessable token in the query
 * string is the whole access control, which is the standard shape for a
 * calendar feed and the reason the token is rotatable — revoking access means
 * issuing a new link.
 *
 * What that buys is the ability to give an external grower a calendar with no
 * account at all. What it costs is that anyone holding the link can read the
 * milestones, so the feed carries ONLY incubation dates: no prices, no
 * customers, no personal data.
 *
 * ── Refresh cadence is Google's to decide ────────────────────────────────────
 *
 * Subscribed calendars are polled on Google's schedule — commonly every few
 * hours, sometimes up to a day. There is no way to make it faster from this
 * side. For milestones measured in days that is fine; it is the main thing the
 * OAuth integration would improve, and the reason that one still exists in the
 * codebase.
 */
import { MILESTONES, addDays, incubationStartFor, syncWindow } from './lib/gcalConstants.mjs'

const TZ = 'America/Edmonton'

const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })

/** Fold a line to 75 octets, as iCalendar requires. */
function fold(line) {
  if (line.length <= 75) return line
  const out = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    out.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest) out.push(' ' + rest)
  return out.join('\r\n')
}

/** Escape the characters iCalendar treats as structure. */
const esc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

export default async (req) => {
  const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!URL_ || !KEY) return text('Not configured', 501)

  const token = new URL(req.url).searchParams.get('token')
  if (!token) return text('Missing token', 401)

  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
  const get = async (path) => {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H })
    if (!r.ok) throw new Error(`${path}: ${r.status}`)
    return r.json()
  }

  let feed
  try {
    const rows = await get('calendar_feed?select=token,enabled&limit=1')
    feed = rows[0]
  } catch {
    return text('Feed unavailable', 503)
  }

  // Same response for a wrong token and a disabled feed: distinguishing them
  // would tell someone probing that they had guessed a real link.
  if (!feed || !feed.enabled || feed.token !== token) return text('Not found', 404)

  let incubators = []
  let trays = []
  try {
    ;[incubators, trays] = await Promise.all([
      get('incubators?select=id,name,incubation_start,temp_mode&order=name'),
      get('trays?status=eq.active&select=incubator_id,status,in_date'),
    ])
  } catch (e) {
    return text(`Could not read the schedule: ${e.message}`, 503)
  }

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const events = []
  for (const inc of incubators) {
    if (inc.temp_mode === 'off') continue
    const start = incubationStartFor(inc, trays)
    if (!start) continue
    for (const m of MILESTONES) {
      events.push({
        date: addDays(start, m.day - 1),
        day: m.day,
        label: m.label,
        incubatorId: inc.id,
        incubatorName: inc.name ?? 'Incubator',
      })
    }
  }
  const inWindow = syncWindow(events, today)

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TNT Operations//Incubation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TNT Operations — Incubation',
    'X-WR-TIMEZONE:America/Edmonton',
    // A hint to clients about polling frequency. Google largely ignores it,
    // but Apple and Outlook honour it.
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ]

  for (const e of inWindow) {
    const d0 = e.date.replace(/-/g, '')
    // All-day DTEND is EXCLUSIVE — same-day start and end renders a zero-length
    // event that some clients hide entirely.
    const d1 = addDays(e.date, 1).replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      // Stable per incubator+milestone, so a re-poll updates rather than
      // duplicating, and a milestone that disappears is dropped by the client.
      `UID:${e.incubatorId}-${e.day}@tnt-operations`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d0}`,
      `DTEND;VALUE=DATE:${d1}`,
      fold(`SUMMARY:${esc(`${e.incubatorName} — ${e.label} (Day ${e.day})`)}`),
      fold('DESCRIPTION:From TNT Operations. This calendar is read-only.'),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')

  // Best-effort usage stamp, so the UI can say whether anything is subscribed.
  // A failure here must not break the feed.
  fetch(`${URL_}/rest/v1/rpc/touch_calendar_feed`, { method: 'POST', headers: H, body: '{}' }).catch(() => {})

  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="tnt-incubation.ics"',
      // Let Google cache briefly but not stale-serve for long.
      'cache-control': 'public, max-age=900',
    },
  })
}
