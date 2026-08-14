/**
 * Shared QuickBooks Online plumbing: token storage, refresh, and the API call
 * wrapper. Imported by qbo-auth.mjs and qbo-sync.mjs.
 *
 * ── The one thing that must not go wrong ─────────────────────────────────────
 *
 * Intuit ROTATES the refresh token on most refreshes and invalidates the old
 * one immediately. If we fetch a new pair and fail to persist it, the
 * connection is dead at the next refresh and the failure looks like a config
 * error rather than what it is. So `refreshTokens` writes the new pair BEFORE
 * returning, and a write failure is treated as a hard error rather than being
 * logged and swallowed.
 */

const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'
export const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
export const MINOR_VERSION = 70

/** Refresh this early, so a call never starts with a nearly-dead token. */
const REFRESH_SKEW_MS = 5 * 60 * 1000

export function env() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const redirectUri = process.env.QBO_REDIRECT_URI
  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!key) missing.push('SUPABASE_SERVICE_ROLE')
  if (!clientId) missing.push('QBO_CLIENT_ID')
  if (!clientSecret) missing.push('QBO_CLIENT_SECRET')
  if (!redirectUri) missing.push('QBO_REDIRECT_URI')
  return { url, key, clientId, clientSecret, redirectUri, missing }
}

/** API host for a connection's environment. */
export const apiBase = (environment) =>
  environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'

// ── Supabase (service role — bypasses RLS, which is how it reads the tokens) ──

function sb() {
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
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`supabase ${method} ${path}: ${r.status} ${await r.text()}`)
      const text = await r.text()
      return text ? JSON.parse(text) : null
    },
  }
}

export const db = sb

/** Which books this deploy is pointed at. The deploy config is the authority. */
export const activeEnvironment = () =>
  process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox'

/**
 * The stored connection for THIS deploy's environment, or null.
 *
 * ── Why this filters on environment ──────────────────────────────────────────
 *
 * `qbo_connection` is keyed by realm_id, and a sandbox company and the real one
 * are different realms — so going live ADDS a row rather than replacing the
 * sandbox one, and both sit there indefinitely.
 *
 * Picking the most recent row alone is not safe. Reconnect the sandbox once,
 * for ten minutes, to try something out, and it becomes the newest row: every
 * live invoice then posts to the sandbox, reports success, and never reaches
 * the real books. That failure is silent and it is the expensive one.
 *
 * So the row must match QBO_ENVIRONMENT. A deploy configured for production
 * cannot reach a sandbox company however the rows are ordered, and a
 * mismatch surfaces as "not connected" — which is true, and which the connect
 * button fixes — rather than as a push to the wrong company.
 */
export async function getConnection() {
  const rows = await sb().get(
    `qbo_connection?environment=eq.${activeEnvironment()}&select=*&order=connected_at.desc&limit=1`,
  )
  return rows[0] ?? null
}

export async function logSync({ realmId, entityType, localId, action, ok, message }) {
  try {
    await sb().write('POST', 'qbo_sync_log', {
      realm_id: realmId ?? null,
      entity_type: entityType,
      local_id: localId ?? null,
      action,
      ok,
      // Trim: Intuit errors can be enormous and the bell shows this verbatim.
      message: String(message ?? '').slice(0, 500),
    })
  } catch (e) {
    // Never let logging failure mask the original error.
    console.error('[qbo] could not write sync log:', e.message)
  }
}

// ── Tokens ──

const basicAuth = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`

/** Exchange an authorization code for the first token pair. */
export async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = env()
  const r = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${JSON.stringify(body)}`)
  return body
}

/**
 * Refresh, persisting the ROTATED pair before returning.
 *
 * On a 400 the refresh token is dead — usually because it went unused past its
 * ~101-day window, or because a newer one superseded it. That is not
 * retryable, so the connection is marked disconnected, which fires the
 * re-authorise notification rather than leaving every later push to fail with
 * the same opaque error.
 */
export async function refreshTokens(conn) {
  const { clientId, clientSecret } = env()
  const r = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  const body = await r.json().catch(() => ({}))

  if (!r.ok) {
    const message = `refresh failed (${r.status}): ${body.error_description || body.error || 'unknown'}`
    await sb().write(
      'PATCH',
      `qbo_connection?realm_id=eq.${encodeURIComponent(conn.realm_id)}`,
      { disconnected_at: new Date().toISOString(), last_error: message },
      'return=minimal',
    )
    throw new Error(message)
  }

  const now = Date.now()
  const updated = {
    access_token: body.access_token,
    // Intuit usually returns a NEW refresh token. Keep the old one only if it
    // genuinely didn't.
    refresh_token: body.refresh_token || conn.refresh_token,
    access_token_expires_at: new Date(now + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token_expires_at: new Date(
      now + Number(body.x_refresh_token_expires_in ?? 8726400) * 1000,
    ).toISOString(),
    disconnected_at: null,
    last_error: '',
  }

  // Persist BEFORE returning — see the module header.
  await sb().write(
    'PATCH',
    `qbo_connection?realm_id=eq.${encodeURIComponent(conn.realm_id)}`,
    updated,
    'return=minimal',
  )

  return { ...conn, ...updated }
}

/** A connection with a usable access token, refreshing if needed. */
export async function ensureFreshToken(conn) {
  if (!conn) throw new Error('QuickBooks is not connected')
  if (conn.disconnected_at) throw new Error('QuickBooks is disconnected — reconnect it in Settings')

  const expiresAt = new Date(conn.access_token_expires_at).getTime()
  if (Number.isFinite(expiresAt) && expiresAt - REFRESH_SKEW_MS > Date.now()) return conn
  return refreshTokens(conn)
}

// ── API ──

/**
 * Call the QuickBooks API.
 *
 * A 401 means the token died between the freshness check and the call — rare
 * but real. That is retried ONCE with a forced refresh; a second 401 is a genuine
 * auth failure and is raised.
 */
export async function qboFetch(conn, path, { method = 'GET', body, retry = true } = {}) {
  const fresh = await ensureFreshToken(conn)
  const sep = path.includes('?') ? '&' : '?'
  const url = `${apiBase(fresh.environment)}/v3/company/${fresh.realm_id}/${path}${sep}minorversion=${MINOR_VERSION}`

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${fresh.access_token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (r.status === 401 && retry) {
    const refreshed = await refreshTokens(fresh)
    return qboFetch(refreshed, path, { method, body, retry: false })
  }

  const text = await r.text()
  const json = text ? JSON.parse(text) : null

  if (!r.ok) {
    // Intuit nests the useful part several levels down and returns 200-shaped
    // errors in some cases. Dig out something a human can act on.
    const fault = json?.Fault?.Error?.[0]
    const detail = fault ? `${fault.Message}${fault.Detail ? ` — ${fault.Detail}` : ''}` : text.slice(0, 300)
    throw new Error(`QuickBooks ${r.status}: ${detail}`)
  }

  return { data: json, conn: fresh }
}

/** Run a QBO SQL-ish query. */
export async function qboQuery(conn, query) {
  return qboFetch(conn, `query?query=${encodeURIComponent(query)}`)
}

/** Tell Intuit to forget the refresh token, then mark the row disconnected. */
export async function revoke(conn) {
  const { clientId, clientSecret } = env()
  try {
    await fetch(INTUIT_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(clientId, clientSecret),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token: conn.refresh_token }),
    })
  } catch (e) {
    // Revocation is best-effort: the local row is what stops us using it.
    console.warn('[qbo] revoke call failed:', e.message)
  }
  await sb().write(
    'PATCH',
    `qbo_connection?realm_id=eq.${encodeURIComponent(conn.realm_id)}`,
    { disconnected_at: new Date().toISOString(), last_error: 'Disconnected by a user.' },
    'return=minimal',
  )
}

// ── Links ──

export async function getLink(realmId, entityType, localId) {
  const rows = await sb().get(
    `qbo_links?realm_id=eq.${encodeURIComponent(realmId)}&entity_type=eq.${entityType}&local_id=eq.${localId}&select=*&limit=1`,
  )
  return rows[0] ?? null
}

export async function upsertLink({ realmId, entityType, localId, qboId, syncToken, error = '' }) {
  return sb().write(
    'POST',
    'qbo_links?on_conflict=realm_id,entity_type,local_id',
    {
      realm_id: realmId,
      entity_type: entityType,
      local_id: localId,
      qbo_id: qboId,
      sync_token: syncToken ?? null,
      last_synced_at: new Date().toISOString(),
      last_error: error,
    },
    'resolution=merge-duplicates,return=minimal',
  )
}
