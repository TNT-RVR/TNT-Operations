/**
 * Google access tokens from a SERVICE ACCOUNT.
 *
 * Deliberately not the OAuth flow in `gcal.mjs`. That one acts as a person: it
 * needs a browser consent screen, a refresh token issued once, and somewhere to
 * store it — and in this repo it is half-built and disabled. A service account
 * is a robot with its own identity: you share the one spreadsheet with its
 * email address, and it can reach that and nothing else. No consent screen, no
 * refresh token to lose, and no access to the rest of Tyler's Drive.
 *
 * Auth is a signed JWT exchanged for an access token — RS256 with Node's own
 * crypto, so no dependency for one signature.
 *
 * Env (Netlify, server-side only):
 *   GOOGLE_SERVICE_ACCOUNT — the whole downloaded key JSON, pasted as-is
 */
import { createSign } from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Refresh a little early so a call never starts with a nearly-dead token. */
const LIFETIME_S = 3600
const EARLY_S = 60

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Parse the key JSON, tolerating the newline mangling env vars are prone to. */
export function readServiceAccount(raw = process.env.GOOGLE_SERVICE_ACCOUNT) {
  if (!raw) return null
  let key
  try {
    key = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (!key?.client_email || !key?.private_key) return null
  // Pasting the JSON into a dashboard field commonly turns the PEM's real
  // newlines into the two characters \ and n. Signing then fails with an
  // unhelpful error, so fix it here rather than in a runbook.
  const private_key = String(key.private_key).includes('\\n')
    ? String(key.private_key).replace(/\\n/g, '\n')
    : String(key.private_key)
  return { client_email: key.client_email, private_key }
}

let cached = { token: null, expiresAt: 0, scope: '' }

/**
 * An access token for `scope`. Cached in module scope for the life of the
 * function instance — a sync that touches four sheets should not mint four
 * tokens.
 */
export async function getAccessToken(scope = 'https://www.googleapis.com/auth/spreadsheets', now = Date.now()) {
  if (cached.token && cached.scope === scope && now < cached.expiresAt) return cached.token

  const account = readServiceAccount()
  if (!account) throw new Error('GOOGLE_SERVICE_ACCOUNT is not set or is not valid key JSON')

  const iat = Math.floor(now / 1000)
  const claims = {
    iss: account.client_email,
    scope,
    aud: TOKEN_URL,
    iat,
    exp: iat + LIFETIME_S,
  }
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const jwt = `${signingInput}.${b64url(signer.sign(account.private_key))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || !out.access_token) {
    // The overwhelmingly common cause is the sheet not being shared with the
    // service account, which surfaces later as a 403 — but a bad key fails here.
    throw new Error(`Google refused the service account (${res.status}): ${out.error_description || out.error || ''}`)
  }

  cached = {
    token: out.access_token,
    scope,
    expiresAt: now + (Number(out.expires_in ?? LIFETIME_S) - EARLY_S) * 1000,
  }
  return cached.token
}

/** For tests: forget the cached token. */
export function resetTokenCache() {
  cached = { token: null, expiresAt: 0, scope: '' }
}
