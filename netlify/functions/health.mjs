/**
 * Is the monitoring alive? Answers in an HTTP status code.
 *
 * The watchdog (watchdog.mjs) catches a sensor going quiet. It cannot catch
 * Netlify not running scheduled functions at all — a check that stops when the
 * platform stops proves nothing. So this endpoint states the freshness of the
 * data and lets something OUTSIDE Netlify do the judging:
 *
 *   200 — a reading arrived recently enough
 *   503 — the newest reading is older than the threshold, or there are none
 *
 * .github/workflows/monitor-heartbeat.yml calls it on a schedule and fails the
 * workflow on anything other than 200, which mails whoever owns the repo. Two
 * different providers have to be broken at once for silence to look healthy.
 *
 * Token-gated and fails closed: it reports on equipment and shouldn't be
 * readable by anyone who finds the URL.
 *
 * Reads HEALTH_TOKEN, falling back to FN_RUN_TOKEN. Its own variable because
 * Netlify hides a secret's value once saved, so reusing the existing one would
 * have meant REPLACING a working token just to learn what it is — changing
 * something that works in order to add something new.
 *
 *   GET /.netlify/functions/health?token=…
 *   GET /.netlify/functions/health?token=…&staleMinutes=120
 */

import { timingSafeEqual } from 'node:crypto'

/**
 * The staleness bar depends on what the incubators are DOING.
 *
 * A running incubator is polled every 15 minutes, so an hour is four missed
 * cycles. But an idle one is only polled every 6 hours by design, and with
 * every incubator off — which is the case out of season — the newest reading
 * in the whole system is legitimately hours old. Judging that against an hour
 * would fail the heartbeat every 30 minutes all winter, and an alarm that is
 * always ringing is one nobody hears.
 */
const STALE_RUNNING_MIN = 60
const STALE_IDLE_MIN = 7 * 60

const json = (body, status) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export default async (req) => {
  const expected = process.env.HEALTH_TOKEN || process.env.FN_RUN_TOKEN
  if (!expected) {
    return json({ error: 'Health checks are disabled (set HEALTH_TOKEN in the Netlify environment).' }, 503)
  }

  const url = new URL(req.url)
  if (!tokenMatches(url.searchParams.get('token') ?? '', expected)) {
    return json({ error: 'Bad token' }, 401)
  }

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return json({ ok: false, error: 'Not configured (Supabase)' }, 503)
  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  // Is anything actually being held at a temperature right now?
  const modes = await fetch(
    `${SB_URL}/rest/v1/incubators?select=temp_mode&govee_device_id=not.is.null`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  const anyRunning =
    Array.isArray(modes) && modes.some((m) => m.temp_mode && m.temp_mode !== 'off')

  const staleMin =
    Number(url.searchParams.get('staleMinutes')) ||
    (anyRunning ? STALE_RUNNING_MIN : STALE_IDLE_MIN)

  // The newest reading from ANY incubator. One row: this is a liveness probe,
  // not a report — per-incubator detail is the watchdog's job.
  const rows = await fetch(
    `${SB_URL}/rest/v1/sensor_readings?select=at,incubator_id&order=at.desc&limit=1`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

  if (!Array.isArray(rows)) {
    // Couldn't even ask. That is itself a failure worth waking on: it means
    // the functions can't reach the database.
    return json({ ok: false, error: 'Could not read sensor_readings' }, 503)
  }

  const latest = rows[0]?.at ?? null
  const ageMin = latest ? (Date.now() - new Date(latest).getTime()) / 60_000 : null
  const ok = ageMin != null && ageMin <= staleMin

  return json(
    {
      ok,
      latestReadingAt: latest,
      ageMinutes: ageMin == null ? null : Math.round(ageMin),
      staleAfterMinutes: staleMin,
      anyIncubatorRunning: anyRunning,
      checkedAt: new Date().toISOString(),
    },
    ok ? 200 : 503,
  )
}
