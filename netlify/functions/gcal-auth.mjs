/**
 * Google Calendar OAuth: connect, callback, disconnect.
 *
 *   GET  /.netlify/functions/gcal-auth?action=start   → { url } to navigate to
 *   GET  /.netlify/functions/gcal-auth?action=callback&code=…&state=…
 *   POST /.netlify/functions/gcal-auth  { action: 'disconnect' }
 *
 * Any signed-in user may connect — this is their own calendar, not a company
 * resource, so unlike the QuickBooks flow it is not admin-only.
 *
 * ── access_type=offline and prompt=consent ───────────────────────────────────
 *
 * Google only returns a refresh token when BOTH are set, and only on the first
 * consent for that app/account pair. Without `prompt=consent`, a user who has
 * connected before gets an access token and no refresh token, and the sync
 * silently stops working an hour later. Forcing the consent screen every time
 * is a small annoyance that prevents a confusing failure.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { CALENDAR_DESCRIPTION_TEXT, CALENDAR_SUMMARY_TEXT } from './lib/gcalConstants.mjs'
import { AUTH_URL, SCOPE, callerId, db, ensureCalendar, env, exchangeCode, getConnection, revoke } from './lib/gcal.mjs'

const STATE_TTL_MS = 10 * 60 * 1000

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Sign the state so the callback can trust which user began the flow.
 *
 * The callback arrives as a plain browser redirect from Google with no app
 * session attached, so without this anyone who found the URL could bind their
 * own Google account to someone else's profile.
 */
function makeState(userId) {
  const secret = process.env.GOOGLE_CLIENT_SECRET
  const payload = `${userId}.${Date.now() + STATE_TTL_MS}`
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

function verifyState(state) {
  const secret = process.env.GOOGLE_CLIENT_SECRET
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

/** The Google account's email, from the id_token. Display only. */
function emailFromIdToken(idToken) {
  try {
    const payload = String(idToken).split('.')[1]
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).email ?? ''
  } catch {
    return ''
  }
}

export default async (req) => {
  const { missing, clientId, redirectUri } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? (req.method === 'POST' ? 'disconnect' : '')

  // ── Start ──
  if (action === 'start') {
    const userId = await callerId(req)
    if (!userId) return json({ error: 'Sign in first' }, 401)

    const target = new URL(AUTH_URL)
    target.searchParams.set('client_id', clientId)
    target.searchParams.set('redirect_uri', redirectUri)
    target.searchParams.set('response_type', 'code')
    target.searchParams.set('scope', SCOPE)
    // Both required to get a refresh token — see the module header.
    target.searchParams.set('access_type', 'offline')
    target.searchParams.set('prompt', 'consent')
    target.searchParams.set('include_granted_scopes', 'true')
    target.searchParams.set('state', makeState(userId))

    // JSON, not a 302: the caller is fetch(), which would follow the redirect
    // and try to render Google's consent screen inside an XHR.
    return json({ url: target.toString() }, 200)
  }

  // ── Callback ──
  if (action === 'callback') {
    const site = process.env.URL || 'https://tntoperations.netlify.app'
    const back = (status, detail = '') =>
      Response.redirect(
        `${site}/users/integrations?gcal=${status}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
        302,
      )

    if (url.searchParams.get('error')) {
      return back('denied', url.searchParams.get('error_description') ?? 'Access was declined.')
    }
    const code = url.searchParams.get('code')
    if (!code) return back('error', 'Google did not return a code.')

    const userId = verifyState(url.searchParams.get('state'))
    if (!userId) return back('error', 'That connect link expired. Start again from the app.')

    try {
      const tokens = await exchangeCode(code)
      if (!tokens.refresh_token) {
        // Only happens if prompt=consent was dropped. Say what it means rather
        // than storing a connection that dies in an hour.
        return back('error', 'Google did not return a refresh token. Remove the app under your Google account permissions, then reconnect.')
      }

      await db().write(
        'POST',
        'gcal_connection?on_conflict=user_id',
        {
          user_id: userId,
          google_email: emailFromIdToken(tokens.id_token),
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          access_token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
          disconnected_at: null,
          last_error: '',
        },
        'resolution=merge-duplicates,return=minimal',
      )

      // Make the calendar now, so "connected" means there is somewhere to write.
      const conn = await getConnection(userId)
      await ensureCalendar(conn, CALENDAR_SUMMARY_TEXT, CALENDAR_DESCRIPTION_TEXT)

      return back('connected')
    } catch (e) {
      return back('error', e.message)
    }
  }

  // ── Disconnect ──
  if (action === 'disconnect') {
    const userId = await callerId(req)
    if (!userId) return json({ error: 'Sign in first' }, 401)
    const conn = await getConnection(userId)
    if (!conn) return json({ ok: true, note: 'Nothing was connected.' }, 200)
    await revoke(conn)
    return json({ ok: true }, 200)
  }

  return json({ error: 'Unknown action. Use start, callback or disconnect.' }, 400)
}
