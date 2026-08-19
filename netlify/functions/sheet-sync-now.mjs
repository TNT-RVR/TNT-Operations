/**
 * Run one Google Sheet sync RIGHT NOW, on demand.
 *
 * The schedule keeps things roughly level; this is for someone who has just
 * typed into a sheet and wants it in the app. Takes the sync's registered name,
 * so a newly registered sheet gets a working button with no change here.
 *
 * A separate file with NO schedule: Netlify answers a bodiless 403 to any HTTP
 * call at a scheduled function, so a button pointed there could only ever report
 * "403" with nothing to act on.
 *
 *   POST /.netlify/functions/sheet-sync-now   { "sync": "checklist", "year": "2026" }
 *   Authorization: Bearer <the caller's supabase access token>
 */
import { getSync } from './lib/sheetSyncs.mjs'

/** Roles that may edit tasks, and so may push rows into a shared spreadsheet. */
const MAY_SYNC = new Set(['admin', 'developer', 'operator'])

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first' }, 401)

  let body = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    body = {}
  }
  const year = String(body.year ?? new Date().getFullYear())
  if (!/^\d{4}$/.test(year)) return json({ error: 'Expected a four-digit season' }, 400)

  const sync = getSync(body.sync ?? 'checklist')
  if (!sync) return json({ error: `No sync called "${body.sync}"` }, 404)
  if (!process.env[sync.sheetIdEnv]) return json({ error: `Not configured (${sync.sheetIdEnv})` }, 501)

  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  const role = Array.isArray(prof) ? prof[0]?.role : null
  if (!MAY_SYNC.has(role)) return json({ error: 'You do not have permission to sync.' }, 403)

  try {
    console.info(`[sheet-sync-now] ${me.id} asked for ${sync.name} ${year}`)
    return json(await sync.run({ year }), 200)
  } catch (e) {
    const status = e?.status ?? 500
    if (status === 403) {
      return json({ error: 'The service account cannot open that sheet — share it with its email as an Editor.' }, 403)
    }
    return json({ error: e instanceof Error ? e.message : 'Sync failed' }, status)
  }
}
