/**
 * Shared Google Calendar plumbing: OAuth, token refresh, and the API wrapper.
 *
 * ── Google differs from Intuit in two ways that matter ───────────────────────
 *
 * 1. A refresh token is issued ONCE — on the first consent — and is NOT
 *    returned on subsequent grants. If it is lost, the user must re-consent
 *    with `prompt=consent` to get another. So the token exchange must never
 *    overwrite a stored refresh token with an absent one.
 * 2. Refresh tokens do NOT rotate, unlike Intuit's. They stay valid until the
 *    user revokes access, the app is unverified and 7 days pass, or six months
 *    of disuse. Nothing here needs to persist a new one on every refresh.
 *
 * Both of those are the opposite of qbo.mjs, which is why this is a separate
 * file rather than a shared OAuth helper — the "same" flow diverges exactly
 * where getting it wrong is silent.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const API = 'https://www.googleapis.com/calendar/v3'

/** Only calendars this app created. Cannot see anyone's personal calendar. */
export const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created openid email'

/** Refresh this early so a call never starts with a nearly-dead token. */
const SKEW_MS = 5 * 60 * 1000

export function env() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!key) missing.push('SUPABASE_SERVICE_ROLE')
  if (!clientId) missing.push('GOOGLE_CLIENT_ID')
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET')
  if (!redirectUri) missing.push('GOOGLE_REDIRECT_URI')
  return { url, key, clientId, clientSecret, redirectUri, missing }
}

export function db() {
  const { url, key } = env()
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    async get(path) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers })
      if (!r.ok) throw new Error(`supabase GET ${path}: ${r.status} ${await r.text()}`)
      return r.json()
    },
    async write(method, path, body, prefer = 'return=representation') {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: { ...headers, Prefer: prefer },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`supabase ${method} ${path}: ${r.status} ${await r.text()}`)
      const text = await r.text()
      return text ? JSON.parse(text) : null
    },
  }
}

export async function getConnection(userId) {
  const rows = await db().get(`gcal_connection?user_id=eq.${userId}&select=*&limit=1`)
  return rows[0] ?? null
}

/** Every connection due for a scheduled sync. */
export async function enabledConnections() {
  return db().get('gcal_connection?sync_enabled=is.true&disconnected_at=is.null&calendar_id=not.is.null&select=*')
}

// ── OAuth ──

/** Exchange the authorization code for tokens. */
export async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = env()
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`token exchange failed: ${body.error_description || body.error || r.status}`)
  return body
}

/**
 * Refresh the access token.
 *
 * Google does NOT return a new refresh token here, so the stored one is left
 * alone — see the module header. A 400 means the grant is gone for good
 * (revoked, expired, or the app is unverified and the 7-day testing window
 * lapsed), which is not retryable, so the connection is marked disconnected and
 * the notification fires once instead of every sync failing identically.
 */
export async function refreshTokens(conn) {
  const { clientId, clientSecret } = env()
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const body = await r.json().catch(() => ({}))

  if (!r.ok) {
    const message =
      body.error === 'invalid_grant'
        ? 'Google access was revoked or expired. Reconnect to resume syncing.'
        : `refresh failed (${r.status}): ${body.error_description || body.error || 'unknown'}`
    await db().write(
      'PATCH',
      `gcal_connection?user_id=eq.${conn.user_id}`,
      { disconnected_at: new Date().toISOString(), last_error: message },
      'return=minimal',
    )
    throw new Error(message)
  }

  const updated = {
    access_token: body.access_token,
    access_token_expires_at: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    disconnected_at: null,
    last_error: '',
  }
  await db().write('PATCH', `gcal_connection?user_id=eq.${conn.user_id}`, updated, 'return=minimal')
  return { ...conn, ...updated }
}

export async function ensureFresh(conn) {
  if (!conn) throw new Error('Google Calendar is not connected')
  if (conn.disconnected_at) throw new Error('Google Calendar is disconnected — reconnect it')
  const expires = new Date(conn.access_token_expires_at).getTime()
  if (Number.isFinite(expires) && expires - SKEW_MS > Date.now()) return conn
  return refreshTokens(conn)
}

// ── API ──

/**
 * Call the Calendar API.
 *
 * A 404 on an event DELETE is treated as success: the goal is "this event is
 * not on the calendar", and someone having already removed it by hand satisfies
 * that. Treating it as an error would wedge every later sync behind it.
 */
export async function gcalFetch(conn, path, { method = 'GET', body, retry = true } = {}) {
  const fresh = await ensureFresh(conn)
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${fresh.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (r.status === 401 && retry) {
    return gcalFetch(await refreshTokens(fresh), path, { method, body, retry: false })
  }
  if (r.status === 404 && method === 'DELETE') return { data: null, conn: fresh }
  // 410 Gone means already deleted — same reasoning.
  if (r.status === 410 && method === 'DELETE') return { data: null, conn: fresh }

  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) {
    const detail = data?.error?.message ?? text.slice(0, 300)
    throw new Error(`Google Calendar ${r.status}: ${detail}`)
  }
  return { data, conn: fresh }
}

/**
 * The app's own calendar, creating it if needed.
 *
 * Under `calendar.app.created` this is the only calendar we can reach, so
 * losing the id would orphan the events rather than let us clean them up —
 * which is why it is stored on the connection rather than looked up each time.
 */
export async function ensureCalendar(conn, summary, description) {
  if (conn.calendar_id) {
    // Confirm it still exists — a user can delete it from Google's UI, and
    // every later write would 404 with a message that says nothing useful.
    try {
      await gcalFetch(conn, `/calendars/${encodeURIComponent(conn.calendar_id)}`)
      return conn
    } catch {
      // Fall through and make a new one; the old events are gone with it, so
      // clear our record of them too.
      await db().write('DELETE', `gcal_synced_events?user_id=eq.${conn.user_id}`, undefined, 'return=minimal')
    }
  }

  const { data } = await gcalFetch(conn, '/calendars', {
    method: 'POST',
    body: { summary, description, timeZone: 'America/Edmonton' },
  })
  const calendarId = data.id
  await db().write(
    'PATCH',
    `gcal_connection?user_id=eq.${conn.user_id}`,
    { calendar_id: calendarId },
    'return=minimal',
  )
  return { ...conn, calendar_id: calendarId }
}

/** Tell Google to forget the grant, then clear our side. */
export async function revoke(conn) {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: conn.refresh_token }),
    })
  } catch (e) {
    // Best effort — deleting our row is what actually stops us using it.
    console.warn('[gcal] revoke failed:', e.message)
  }
  await db().write('DELETE', `gcal_connection?user_id=eq.${conn.user_id}`, undefined, 'return=minimal')
  await db().write('DELETE', `gcal_synced_events?user_id=eq.${conn.user_id}`, undefined, 'return=minimal')
}

/** Verify a caller's Supabase token and return their user id. */
export async function callerId(req) {
  const { url, key } = env()
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  return me?.id ?? null
}
