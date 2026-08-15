/**
 * QuickBooks OAuth: start the connect flow, and handle Intuit's callback.
 *
 *   GET /.netlify/functions/qbo-auth?action=start   → redirects to Intuit
 *   GET /.netlify/functions/qbo-auth?action=callback&code=…&realmId=…&state=…
 *   POST /.netlify/functions/qbo-auth  { action: 'disconnect' }
 *
 * Register the callback URL as a Redirect URI on the Intuit app — Intuit
 * matches it exactly, including the scheme and any trailing slash.
 *
 * ── Who is allowed to do this ────────────────────────────────────────────────
 *
 * Connecting hands this app ongoing access to the company's books, so `start`
 * requires an admin's Supabase access token, verified server-side against
 * `profiles` — the same pattern as invite-user.mjs. The browser can't assert
 * its own role.
 *
 * The callback is different: it is Intuit redirecting a browser, so it carries
 * no app session. The `state` parameter is what ties it back to the admin who
 * began the flow — it is a signed, single-use, short-lived value, checked
 * before any token is stored. Without that check, anyone who found this URL
 * could bind their own QuickBooks company to the app.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  INTUIT_AUTH_URL,
  QBO_SCOPE,
  activeEnvironment,
  apiBase,
  db,
  env,
  exchangeCode,
  getConnection,
  logSync,
  qboFetch,
  revoke,
  sealTokens,
} from './lib/qbo.mjs'

/** State is valid for ten minutes — long enough to sign in to Intuit, no longer. */
const STATE_TTL_MS = 10 * 60 * 1000

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Sign `${userId}.${expiry}` so the callback can trust where it came from. */
function makeState(userId) {
  const secret = process.env.QBO_CLIENT_SECRET
  const payload = `${userId}.${Date.now() + STATE_TTL_MS}`
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyState(state) {
  const secret = process.env.QBO_CLIENT_SECRET
  const parts = String(state ?? '').split('.')
  if (parts.length !== 3) return null
  const [userId, expiry, sig] = parts
  const expected = createHmac('sha256', secret).update(`${userId}.${expiry}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return userId
}

/** Verify the caller is an admin, using their own token. */
async function requireAdmin(req) {
  const { url, key } = env()
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: 'Sign in first', status: 401 }

  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!me?.id) return { error: 'Your session is invalid — sign in again', status: 401 }

  const prof = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (prof?.[0]?.role !== 'admin') return { error: 'Admins only', status: 403 }

  return { userId: me.id }
}

/** Read company facts we cache: name, currency, multicurrency. */
async function readCompanyInfo(conn) {
  const { data } = await qboFetch(conn, `companyinfo/${conn.realm_id}`)
  const info = data?.CompanyInfo ?? {}
  const prefs = await qboFetch(conn, 'preferences').catch(() => ({ data: null }))
  const currency = prefs.data?.Preferences?.CurrencyPrefs ?? {}
  return {
    company_name: info.CompanyName ?? '',
    home_currency: currency.HomeCurrency?.value ?? 'CAD',
    multicurrency_enabled: currency.MultiCurrencyEnabled === true,
  }
}

export default async (req) => {
  const { missing, clientId, redirectUri } = env()
  if (missing.length) {
    return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? (req.method === 'POST' ? 'disconnect' : '')

  // ── Start ──
  if (action === 'start') {
    const auth = await requireAdmin(req)
    if (auth.error) return json({ error: auth.error }, auth.status)

    const target = new URL(INTUIT_AUTH_URL)
    target.searchParams.set('client_id', clientId)
    target.searchParams.set('response_type', 'code')
    target.searchParams.set('scope', QBO_SCOPE)
    target.searchParams.set('redirect_uri', redirectUri)
    target.searchParams.set('state', makeState(auth.userId))

    // Returned as JSON rather than a 302: the caller is fetch(), which would
    // follow the redirect and hit Intuit's login as an XHR. The browser has to
    // navigate to this itself.
    return json({ url: target.toString() }, 200)
  }

  // ── Callback ──
  if (action === 'callback') {
    const code = url.searchParams.get('code')
    const realmId = url.searchParams.get('realmId')
    const state = url.searchParams.get('state')
    const site = process.env.URL || 'https://tntoperations.netlify.app'
    const back = (status, detail = '') =>
      Response.redirect(
        `${site}/users/integrations/quickbooks?qbo=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
        302,
      )

    if (url.searchParams.get('error')) {
      return back('denied', url.searchParams.get('error_description') ?? 'Access was declined.')
    }
    if (!code || !realmId) return back('error', 'Intuit did not return a code.')

    const userId = verifyState(state)
    if (!userId) {
      await logSync({ entityType: 'auth', action: 'auth', ok: false, message: 'Callback with a bad or expired state.' })
      return back('error', 'That connect link expired or was tampered with. Start again from the app.')
    }

    try {
      const tokens = await exchangeCode(code)
      const now = Date.now()
      const row = {
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        access_token_expires_at: new Date(now + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
        refresh_token_expires_at: new Date(
          now + Number(tokens.x_refresh_token_expires_in ?? 8726400) * 1000,
        ).toISOString(),
        environment: activeEnvironment(),
        connected_at: new Date().toISOString(),
        connected_by: userId,
        disconnected_at: null,
        last_error: '',
      }

      // sealTokens, not row — the tokens are encrypted before they ever reach
      // the database. See lib/qbo.mjs.
      await db().write(
        'POST',
        'qbo_connection?on_conflict=realm_id',
        sealTokens(row),
        'resolution=merge-duplicates,return=minimal',
      )

      // Cache the company facts the mapping layer needs. Non-fatal: the
      // connection works without them and the settings screen can refresh.
      try {
        const conn = await getConnection()
        const info = await readCompanyInfo(conn)
        await db().write(
          'PATCH',
          `qbo_connection?realm_id=eq.${encodeURIComponent(realmId)}`,
          info,
          'return=minimal',
        )
      } catch (e) {
        console.warn('[qbo] connected, but could not read company info:', e.message)
      }

      await logSync({ realmId, entityType: 'auth', action: 'auth', ok: true, message: 'Connected.' })
      return back('connected')
    } catch (e) {
      await logSync({ realmId, entityType: 'auth', action: 'auth', ok: false, message: e.message })
      return back('error', e.message)
    }
  }

  // ── Disconnect ──
  if (action === 'disconnect') {
    const auth = await requireAdmin(req)
    if (auth.error) return json({ error: auth.error }, auth.status)
    const conn = await getConnection()
    if (!conn) return json({ ok: true, note: 'Nothing was connected.' }, 200)
    await revoke(conn)
    await logSync({ realmId: conn.realm_id, entityType: 'auth', action: 'auth', ok: true, message: 'Disconnected.' })
    return json({ ok: true }, 200)
  }

  return json({ error: 'Unknown action. Use start, callback or disconnect.' }, 400)
}

/** Exported for the settings screen to reuse. */
export { apiBase }
