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

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
export const MINOR_VERSION = 70

// ── OAuth endpoints, from Intuit's discovery document ────────────────────────

/**
 * Intuit publishes its OAuth endpoints so that apps do not hardcode them, and
 * can follow a change without a redeploy. We read them from there.
 *
 * The values below are what discovery returns TODAY, and they are the fallback
 * rather than the source. Discovery is one more network call in the path of
 * connecting, and if it is down, refusing to talk to Intuit at all would be a
 * worse outcome than using the endpoints that have not moved in years. So a
 * failed lookup logs and falls back; it never throws.
 *
 * Sandbox and production differ only in `userinfo_endpoint`, which we do not
 * use — but they are fetched per environment anyway, because the day that
 * stops being true should not be a day we find out the hard way.
 */
const DISCOVERY_URL = {
  production: 'https://developer.api.intuit.com/.well-known/openid_configuration',
  sandbox: 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration',
}

const FALLBACK_ENDPOINTS = {
  auth: 'https://appcenter.intuit.com/connect/oauth2',
  token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  revoke: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
}

/** Cached per warm container. Endpoints change on the order of never. */
const DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000
let discovered = null

/**
 * Drop the cache. Only the tests need this — in a function the cache is exactly
 * what we want, and a cold start clears it anyway. Without it, the first test
 * to look up endpoints decides the answer for every test after it.
 */
export function resetDiscoveryCache() {
  discovered = null
}

export async function endpoints() {
  const environment = activeEnvironment()
  if (discovered && discovered.environment === environment && Date.now() - discovered.at < DISCOVERY_TTL_MS) {
    return discovered.value
  }

  let value = FALLBACK_ENDPOINTS
  try {
    const r = await fetch(DISCOVERY_URL[environment], { headers: { Accept: 'application/json' } })
    if (!r.ok) throw new Error(`${r.status}`)
    const doc = await r.json()
    // Take each endpoint only if discovery actually supplied it — a partial
    // document must not blank out an endpoint we know.
    value = {
      auth: doc.authorization_endpoint || FALLBACK_ENDPOINTS.auth,
      token: doc.token_endpoint || FALLBACK_ENDPOINTS.token,
      revoke: doc.revocation_endpoint || FALLBACK_ENDPOINTS.revoke,
    }
  } catch (e) {
    console.warn(`[qbo] discovery lookup failed (${e.message}); using known endpoints`)
  }

  discovered = { environment, at: Date.now(), value }
  return value
}

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
  // Required, not optional. A missing key must stop the integration, not
  // silently downgrade it to storing tokens in the clear — a security control
  // with a quiet fallback is not a control. Absent it, every entry point
  // answers 501 with this name in the list, which says exactly what to fix.
  if (!process.env.QBO_TOKEN_KEY) missing.push('QBO_TOKEN_KEY')
  return { url, key, clientId, clientSecret, redirectUri, missing }
}

// ── Token encryption ─────────────────────────────────────────────────────────

/**
 * OAuth tokens are encrypted with a key this database never sees.
 *
 * Intuit's guidance is that tokens must be encrypted in storage, behind a key
 * or a secrets vault. Row-level security already makes qbo_connection
 * unreadable through the API by every user including admins, and Supabase
 * encrypts its disks — but both of those are defences the DATABASE holds. A
 * backup, a snapshot, a support export, or anyone who obtains the service-role
 * key gets the plaintext anyway.
 *
 * So the tokens are sealed in the function, with AES-256-GCM under
 * QBO_TOKEN_KEY, which lives only in Netlify's environment. The key and the
 * ciphertext are never in the same place, so a copy of the database is not
 * enough to reach anyone's books. GCM also authenticates: a token altered at
 * rest fails to open rather than being sent to Intuit.
 *
 * Generate the key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
const SEAL_PREFIX = 'qbo1.'

function tokenKey() {
  const raw = process.env.QBO_TOKEN_KEY ?? ''
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('QBO_TOKEN_KEY must be 32 bytes, base64-encoded (see lib/qbo.mjs for how to generate one)')
  }
  return key
}

/** Encrypt one token. Returns a self-describing string. */
export function sealToken(plain) {
  if (!plain) return plain
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', tokenKey(), iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return [SEAL_PREFIX + iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(
    '.',
  )
}

/**
 * Decrypt one token.
 *
 * A value without the marker is passed through unchanged. That is deliberate:
 * connections made before this change are stored in the clear, and refusing
 * them would break a live connection on deploy. They re-seal on the next token
 * refresh, which for an active connection is within the hour.
 */
export function openToken(stored) {
  if (!stored || !String(stored).startsWith(SEAL_PREFIX)) return stored
  // The marker itself ends in a dot, so it comes off BEFORE the split — with
  // it left on, the split yields four parts and the IV reads as empty.
  const [ivPart, tagPart, ctPart] = String(stored).slice(SEAL_PREFIX.length).split('.')
  const d = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(ivPart, 'base64url'))
  d.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ctPart, 'base64url')), d.final()]).toString('utf8')
}

/** Seal the token fields of a row about to be written. */
export const sealTokens = (row) => ({
  ...row,
  ...(row.access_token !== undefined ? { access_token: sealToken(row.access_token) } : {}),
  ...(row.refresh_token !== undefined ? { refresh_token: sealToken(row.refresh_token) } : {}),
})

/** Open the token fields of a row just read. */
export const openTokens = (row) =>
  row && { ...row, access_token: openToken(row.access_token), refresh_token: openToken(row.refresh_token) }

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
  // Opened here, once, so every caller downstream holds usable tokens and no
  // call site has to remember to decrypt.
  return rows[0] ? openTokens(rows[0]) : null
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
  const r = await fetch((await endpoints()).token, {
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
  const r = await fetch((await endpoints()).token, {
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
      // The refresh token is dead — Intuit has told us so. Keeping the text
      // around stores a credential that can no longer be used but can still be
      // stolen, so it goes with the connection. See revoke() for the rule.
      { disconnected_at: new Date().toISOString(), last_error: message, access_token: '', refresh_token: '' },
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

  // Persist BEFORE returning — see the module header. Sealed on the way in;
  // the copy returned to the caller stays plaintext, because it is about to be
  // used to make a call.
  await sb().write(
    'PATCH',
    `qbo_connection?realm_id=eq.${encodeURIComponent(conn.realm_id)}`,
    sealTokens(updated),
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

/**
 * Tell Intuit to forget the refresh token, then mark the row disconnected AND
 * clear the token text.
 *
 * Intuit's guidance is to revoke and then clean up the stored record, and the
 * reason is worth stating: a revoked token is dead to us but is still a
 * credential-shaped secret sitting in a database. It cannot be used, but it can
 * be leaked, and it will outlive everyone's memory of what it was for. Nothing
 * reads these columns after disconnect — reconnecting writes a fresh pair — so
 * there is nothing to lose by emptying them.
 */
export async function revoke(conn) {
  const { clientId, clientSecret } = env()
  try {
    await fetch((await endpoints()).revoke, {
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
    {
      disconnected_at: new Date().toISOString(),
      last_error: 'Disconnected by a user.',
      access_token: '',
      refresh_token: '',
    },
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
