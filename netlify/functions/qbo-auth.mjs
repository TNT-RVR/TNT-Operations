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
 * began the flow — signed, short-lived, and single-use, checked before any
 * token is stored. Without that check, anyone who found this URL could bind
 * their own QuickBooks company to the app.
 *
 * Single-use is enforced by SPENDING the state's nonce in qbo_oauth_state, not
 * by the signature. This comment used to claim single-use while the code only
 * checked the signature and the expiry, which left a captured value replayable
 * for its whole ten-minute window — the property the state parameter exists to
 * provide. If you change consumeState, keep that true.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  QBO_SCOPE,
  activeEnvironment,
  apiBase,
  db,
  endpoints,
  env,
  exchangeCode,
  getConnection,
  logSync,
  maskKey,
  qboFetch,
  revoke,
  sealTokens,
} from './lib/qbo.mjs'

/** State is valid for ten minutes — long enough to sign in to Intuit, no longer. */
const STATE_TTL_MS = 10 * 60 * 1000

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Sign `${userId}.${expiry}.${nonce}` so the callback can trust where it came
 * from, and can tell a first use from a replay.
 *
 * The nonce carries no meaning — it exists so that two states issued in the
 * same millisecond by the same admin are still distinguishable, and so that
 * consuming one is a single INSERT against a primary key.
 */
export function makeState(userId) {
  const secret = process.env.QBO_CLIENT_SECRET
  const payload = `${userId}.${Date.now() + STATE_TTL_MS}.${randomBytes(16).toString('base64url')}`
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/**
 * Check the signature and the expiry. Cheap, and no I/O — so a forged or stale
 * state is rejected without touching the database.
 */
export function checkStateSignature(state) {
  const secret = process.env.QBO_CLIENT_SECRET
  const parts = String(state ?? '').split('.')
  if (parts.length !== 4) return null
  const [userId, expiry, nonce, sig] = parts
  const expected = createHmac('sha256', secret).update(`${userId}.${expiry}.${nonce}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so the length is checked first
  // — and a wrong length is already a wrong signature.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return { userId, nonce }
}

/**
 * Verify a state AND spend it. Returns the user id once, then never again.
 *
 * Consuming is an INSERT on a primary key rather than a read-then-write, so two
 * callbacks racing with the same state cannot both pass: one inserts, the other
 * gets a duplicate-key error. Checking "have we seen this?" and then recording
 * it would leave exactly that gap.
 *
 * A storage failure REFUSES the state. If we cannot prove this is the first
 * use, we have not got the property we claim to have, and the cost of being
 * wrong is binding someone else's QuickBooks company to this app. The cost of
 * refusing is that an admin clicks Connect again.
 */
async function consumeState(state) {
  const checked = checkStateSignature(state)
  if (!checked) return null

  try {
    await db().write('POST', 'qbo_oauth_state', { nonce: checked.nonce }, 'return=minimal')
  } catch (e) {
    // 23505 is unique_violation: this state has already been spent.
    const replay = /23505|duplicate key/i.test(e.message)
    console.warn(`[qbo] state refused (${replay ? 'replay' : e.message})`)
    return null
  }

  // Opportunistic sweep. These rows are dead the moment they expire, and the
  // connect flow is rare enough that one extra request costs nothing.
  db()
    .write(
      'DELETE',
      `qbo_oauth_state?used_at=lt.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`,
      undefined,
      'return=minimal',
    )
    .catch(() => {})

  return checked.userId
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

  // ── Config ──
  //
  // What this DEPLOY is pointed at, as opposed to what is stored. The two can
  // differ in one direction that matters: Netlify injects environment variables
  // into functions at DEPLOY time, so changing QBO_CLIENT_ID in the dashboard
  // does nothing until a new deploy runs. Until then the function keeps using
  // the previous app, and the only visible symptom is Intuit offering the wrong
  // company from a screen that explains nothing. This makes it readable before
  // anyone clicks Connect.
  if (action === 'config') {
    const auth = await requireAdmin(req)
    if (auth.error) return json({ error: auth.error }, auth.status)
    return json({ environment: activeEnvironment(), clientId: maskKey(clientId), redirectUri }, 200)
  }

  // ── Start ──
  if (action === 'start') {
    const auth = await requireAdmin(req)
    if (auth.error) return json({ error: auth.error }, auth.status)

    // From discovery, not a constant — see lib/qbo.mjs.
    const target = new URL((await endpoints()).auth)
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

    const userId = await consumeState(state)
    if (!userId) {
      await logSync({
        entityType: 'auth',
        action: 'auth',
        ok: false,
        message: 'Callback with a bad, expired, or already-used state.',
      })
      return back('error', 'That connect link expired, was already used, or was tampered with. Start again from the app.')
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
      await logSync({
        realmId,
        entityType: 'auth',
        action: 'auth',
        ok: false,
        message: e.message,
        intuitTid: e.intuitTid,
      })
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
