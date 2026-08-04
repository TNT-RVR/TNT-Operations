/**
 * Invite a user by email (admin only).
 *
 * Sending an invite requires Supabase's ADMIN API, which needs the service_role
 * key — so this can only run server-side, never in the browser. The caller
 * proves who they are with their own Supabase access token; we look their role
 * up with the service key and refuse anyone who isn't an admin.
 *
 * The chosen role rides along in the auth user's metadata, and the
 * `handle_new_user` trigger (migration 0011) turns it into the profile's role —
 * so an invited person skips the pending queue and can work immediately.
 *
 *   POST /.netlify/functions/invite-user
 *   Authorization: Bearer <the admin's supabase access token>
 *   { "email": "someone@example.com", "name": "Someone", "role": "operator" }
 *
 * Env (Netlify, server-side only):
 *   SUPABASE_SERVICE_ROLE  — service_role key
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 *   URL                    — Netlify's site URL, used as the invite redirect
 */

const ASSIGNABLE = new Set(['admin', 'developer', 'operator', 'viewer'])

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
  const email = String(body?.email ?? '').trim().toLowerCase()
  const name = String(body?.name ?? '').trim()
  const role = String(body?.role ?? 'viewer').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400)
  if (!ASSIGNABLE.has(role)) return json({ error: `Invalid role "${role}"` }, 400)

  const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

  // 1. Who is calling? Validate their token against GoTrue.
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  // 2. Are they an admin? Checked server-side with the service key, so the
  //    browser can't lie about it.
  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!Array.isArray(prof) || prof[0]?.role !== 'admin') {
    return json({ error: 'Admins only' }, 403)
  }

  // 3. Send the invite. Supabase emails a link; accepting it sets their
  //    password and fires handle_new_user with the role below.
  const site = process.env.URL || 'https://tntoperations.netlify.app'
  const res = await fetch(`${SB_URL}/auth/v1/invite`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email, data: { name, role }, redirect_to: site }),
  })
  const out = await res.json().catch(() => ({}))

  if (!res.ok) {
    // The most common real-world failures, in plain language.
    const msg = String(out?.msg || out?.error_description || out?.message || `Supabase ${res.status}`)
    if (/already been registered|already exists/i.test(msg)) {
      return json({ error: 'That email already has an account — set their role in the table instead.' }, 409)
    }
    if (/rate limit|too many/i.test(msg)) {
      return json(
        { error: 'Supabase email rate limit hit. Configure custom SMTP in Supabase → Authentication → Emails to send real invites.' },
        429,
      )
    }
    return json({ error: msg }, res.status)
  }

  return json({ ok: true, email, role }, 200)
}
