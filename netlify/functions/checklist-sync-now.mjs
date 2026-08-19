/**
 * Run the checklist ↔ Google Sheet sync RIGHT NOW, on demand.
 *
 * The schedule in checklist-sheet-sync.mjs runs every half hour, which is fine
 * for keeping two systems roughly level and useless to someone who has just
 * typed a date into the sheet and wants to see it in the app.
 *
 * A separate file with NO schedule, because Netlify refuses direct HTTP
 * invocation of any scheduled function — it answers a bodiless 403 before the
 * request reaches our code, so a button pointed at the scheduled one could only
 * ever report "403" with no explanation. Same shape as poll-govee / poll-now.
 *
 *   POST /.netlify/functions/checklist-sync-now   { "year": "2026" }
 *   Authorization: Bearer <the caller's supabase access token>
 *
 * Env (server-side): as checklist-sheet-sync.mjs.
 */
import { runChecklistSync } from './checklist-sheet-sync.mjs'

/** Roles that may edit tasks, and therefore may push marks into the sheet. */
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

  // Who is calling? Checked with the service key so the browser cannot lie.
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  const role = Array.isArray(prof) ? prof[0]?.role : null
  if (!MAY_SYNC.has(role)) return json({ error: 'You do not have permission to sync the checklist.' }, 403)

  console.info(`[checklist-sync-now] ${me.id} asked for ${year}`)
  return runChecklistSync(year)
}
