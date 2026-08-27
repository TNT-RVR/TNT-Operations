/**
 * Raise an alert when the Anthropic API rejects us.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 *
 * A MISSING key was always handled well: both callers return 501 and the
 * Settings screen says the key is not set. A REJECTED key is the dangerous one
 * — everything looks configured, the call goes out, and 401 comes back. In
 * `grants-pull` that becomes a 502 nobody ever reads, because the function is
 * scheduled: it would fail every Monday at 14:00 and the only symptom would be
 * grants quietly not appearing.
 *
 * API keys expire. TNT's is set to, which is what prompted this.
 *
 * So a non-2xx writes a row to the bell, and `push-pending.mjs` delivers it to
 * whoever opted in. The row is left UNSTAMPED (`deferPush`) precisely so the
 * sweeper handles it: these two functions have no push wiring of their own and
 * should not grow any — one delivery path is the point.
 *
 * ── Which failures are worth waking someone for ──────────────────────────────
 *
 * 401 and 403 mean the key is wrong, expired or revoked: nothing works until a
 * person does something, so that is a `critical` and it is what the dedup key
 * is built around. 429 and 5xx are the model service having a bad hour and
 * usually fix themselves, so they are a `warning` — still recorded, because a
 * rate limit that persists for a week is worth seeing, but not the same alarm.
 */

/** Is this status a key problem rather than a passing one? */
export function isAuthFailure(status) {
  return status === 401 || status === 403
}

/**
 * Write the alert. Never throws and never blocks the caller's own response —
 * a failure to REPORT a failure must not become the failure.
 *
 * @param {string} source  which function hit it, e.g. 'grants-pull'
 * @param {number} status  the HTTP status Anthropic returned
 * @param {string} detail  response body, trimmed by the caller
 */
export async function reportAnthropicFailure(source, status, detail = '') {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) return false

  const auth = isAuthFailure(status)
  const title = auth
    ? 'Claude API key rejected'
    : `Claude API call failed (${status})`
  const body = auth
    ? `${source} was refused with HTTP ${status}. The key is expired, revoked or wrong — set a new ANTHROPIC_API_KEY in Netlify and redeploy. Until then, grant pulls and analysis notes do nothing.`
    : `${source} got HTTP ${status} from Anthropic. ${detail.slice(0, 200)}`.trim()

  try {
    const res = await fetch(`${SB_URL}/rest/v1/app_notifications`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        category: 'integrations',
        // One type, so a single preference covers both callers.
        type: 'anthropic_key_failed',
        severity: auth ? 'critical' : 'warning',
        title,
        body,
        source,
        /*
         * Keyed on the KIND of failure, not on the caller or the minute. The
         * unique index in 0006 suppresses repeats while one is still unread, so
         * a key that stays expired raises this once and not weekly.
         */
        dedup_key: auth ? 'anthropic_auth' : `anthropic_http_${status}`,
        // Deliberately unstamped: push-pending.mjs owns delivery for anything
        // whose producer has no sender of its own.
        pushed_at: null,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
