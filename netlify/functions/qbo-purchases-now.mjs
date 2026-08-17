/**
 * Sync bee purchases from QuickBooks RIGHT NOW, on demand.
 *
 *   POST /.netlify/functions/qbo-purchases-now   { "season": 2026 }
 *   Authorization: Bearer <the caller's supabase access token>
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 *
 * `qbo-purchases.mjs` carries the weekly schedule, and Netlify refuses direct
 * HTTP invocation of any function that declares one — it answers 403 by design,
 * before the request reaches a line of our code. A "Sync now" button pointed at
 * that URL therefore cannot work no matter how it is authenticated, and the 403
 * carries no body to explain itself.
 *
 * So the scheduled file keeps the cron and exports the work; this one declares
 * NO schedule, imports `syncSeason`, and returns the result synchronously so the
 * button can say what happened. Exactly the shape of poll-govee / poll-now.
 */
import { activeEnvironment, env, getConnection, logSync } from './lib/qbo.mjs'
import { seasonOf, syncSeason } from './qbo-purchases.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Editors only, verified server-side against `profiles`.
 *
 * This spends QuickBooks API quota and writes rows, so the browser's claim
 * about its own role is not good enough.
 */
async function requireEditor(req) {
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
  if (!['admin', 'developer', 'operator'].includes(prof?.[0]?.role)) return { error: 'Not allowed', status: 403 }

  return { userId: me.id }
}

export default async (req) => {
  const { missing } = env()
  if (missing.length) return json({ error: `Not configured. Missing: ${missing.join(', ')}` }, 501)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const auth = await requireEditor(req)
  if (auth.error) return json({ error: auth.error }, auth.status)

  const conn = await getConnection()
  if (!conn) return json({ error: `QuickBooks is not connected (${activeEnvironment()})` }, 409)
  if (conn.disconnected_at) return json({ error: 'QuickBooks is disconnected — reconnect it' }, 409)

  const body = await req.json().catch(() => ({}))
  const season = Number.isFinite(Number(body?.season))
    ? Number(body.season)
    : seasonOf(new Date().toISOString().slice(0, 10))

  try {
    const result = await syncSeason(conn, season)
    await logSync({
      realmId: conn.realm_id,
      entityType: 'bee-purchases',
      action: 'read',
      ok: true,
      message: `season ${result.season}: ${result.lines} lines, ${result.gallons} gal (by hand)`,
    })
    return json({ ok: true, ...result }, 200)
  } catch (e) {
    await logSync({
      realmId: conn.realm_id,
      entityType: 'bee-purchases',
      action: 'read',
      ok: false,
      message: e.message,
      intuitTid: e.intuitTid,
    })
    return json({ ok: false, error: e.message }, 400)
  }
}
