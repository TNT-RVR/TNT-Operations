import { timingSafeEqual } from 'node:crypto'
import runGrantsPull from './grants-pull.mjs'
import runGoveePoll from './poll-govee.mjs'

/**
 * Manual trigger for the scheduled functions.
 *
 * Netlify refuses direct HTTP invocation of any function that declares a
 * `schedule` (403 by design), so the scheduled handlers can't be hit by URL.
 * This function declares NO schedule — it's a normal HTTP endpoint that imports
 * those handlers and runs them on demand. The scheduled files stay untouched and
 * keep running on their own cron; this is purely an extra door.
 *
 *   GET /.netlify/functions/run?fn=grants-pull&token=…
 *   GET /.netlify/functions/run?fn=poll-govee   -H "Authorization: Bearer …"
 *
 * SECURITY: these jobs spend Anthropic credits and write to the database, so the
 * endpoint is gated by a shared secret and FAILS CLOSED — with no FN_RUN_TOKEN
 * set in the Netlify environment it refuses every request (503). Set
 * FN_RUN_TOKEN to a long random string to enable it; unset it to shut the door
 * again without deploying code.
 */

const JOBS = {
  'grants-pull': runGrantsPull,
  'poll-govee': runGoveePoll,
}

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Constant-time compare so the token can't be guessed a character at a time. */
function tokenMatches(given, expected) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export default async (req) => {
  const expected = process.env.FN_RUN_TOKEN
  if (!expected) {
    // Fail closed: an unset token disables manual runs entirely.
    return json({ error: 'Manual runs are disabled. Set FN_RUN_TOKEN in the Netlify environment to enable.' }, 503)
  }

  const url = new URL(req.url)
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const given = bearer || url.searchParams.get('token') || ''
  if (!tokenMatches(given, expected)) return json({ error: 'Unauthorized' }, 401)

  const name = url.searchParams.get('fn') ?? ''
  const job = JOBS[name]
  if (!job) return json({ error: `Unknown job "${name}"`, available: Object.keys(JOBS) }, 400)

  try {
    // The scheduled handlers return a Response; hand it straight back.
    return await job(req)
  } catch (e) {
    return json({ error: `${name} threw`, detail: e?.message ?? String(e) }, 500)
  }
}
