/**
 * Permanently delete a user (admin only).
 *
 * Deleting the `profiles` row is NOT enough. The login itself lives in
 * `auth.users`, which only the admin API can touch, so the old browser-side
 * delete left the account alive: the person vanished from the Users screen but
 * still held a working password, and every later invite to that address came
 * back "already been registered" — refused on behalf of an account nobody
 * could see.
 *
 * So the delete lands on the auth user and `profiles.id references auth.users
 * on delete cascade` (migration 0001) takes the profile with it. If the auth
 * user is already gone we still clear any profile row left behind, so the two
 * tables cannot disagree in either direction.
 *
 *   POST /.netlify/functions/delete-user
 *   Authorization: Bearer <the admin's supabase access token>
 *   { "id": "<the user's uuid>" }
 *
 * Env (Netlify, server-side only):
 *   SUPABASE_SERVICE_ROLE  — service_role key
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first' }, 401)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const id = String(body?.id ?? '').trim()
  if (!UUID.test(id)) return json({ error: 'Expected a user id' }, 400)

  const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

  // Who is calling? Validated against GoTrue with the service key, so the
  // browser cannot lie about it.
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)
  if (me.id === id) return json({ error: 'You cannot delete your own account.' }, 400)

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  const role = Array.isArray(prof) ? prof[0]?.role : null
  if (role !== 'admin' && role !== 'developer') {
    return json({ error: 'Only an admin can delete an account.' }, 403)
  }

  // 404 means the login is already gone — not a failure, and the profile
  // sweep below is then the whole job.
  const gone = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })
  if (!gone.ok && gone.status !== 404) {
    const text = await gone.text().catch(() => '')
    return json({ error: `Could not delete the login (${gone.status}). ${text.slice(0, 200)}` }, 502)
  }

  const left = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}`, {
    method: 'DELETE',
    headers: { ...admin, Prefer: 'return=minimal' },
  })
  if (!left.ok) {
    const text = await left.text().catch(() => '')
    return json({ error: `Login deleted, but the profile row remains (${left.status}). ${text.slice(0, 200)}` }, 502)
  }

  console.info(`[delete-user] ${me.id} deleted ${id}`)
  return json({ ok: true }, 200)
}
