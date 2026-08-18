/**
 * Logins that have no TNT profile — list them, and adopt one back (admin only).
 *
 * `public.profiles` is what the app can see: the Users screen, the pickers,
 * every role check. `auth.users` is what can actually sign in. They are kept in
 * step by the `on_auth_user_created` trigger (migration 0001) and by the
 * cascade on `profiles.id`, but they CAN drift — the old profile-only delete
 * did it, and a trigger that fails or is dropped would do it again.
 *
 * Drift in that direction is the worst kind, because it is silent from every
 * angle. The person signs in, lands on the approval gate, and waits. The admin
 * looks at Users, cannot see them, and re-invites — which GoTrue refuses,
 * because the login is right there. Nothing in the app showed the account that
 * both statements were about. This endpoint is that missing view.
 *
 * The auth schema is not exposed through PostgREST, so listing it needs the
 * admin API and therefore the service key: server-side only.
 *
 *   POST /.netlify/functions/orphan-logins
 *   Authorization: Bearer <the admin's supabase access token>
 *   {}                                        → { ok, logins: [...] }
 *   { "adopt": { "id": "...", "role": "operator", "name": "..." } }  → { ok }
 *
 * Env (Netlify, server-side only):
 *   SUPABASE_SERVICE_ROLE  — service_role key
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 */

const ASSIGNABLE = new Set(['admin', 'developer', 'operator', 'viewer', 'device'])
const PER_PAGE = 200
const MAX_PAGES = 25 // 5,000 logins; a hard stop, not an expected limit

const json = (body, status) =>
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

  const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
  const service = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, { headers: service }).then((r) =>
    r.ok ? r.json() : null,
  )
  const callerRole = Array.isArray(prof) ? prof[0]?.role : null
  if (callerRole !== 'admin' && callerRole !== 'developer') {
    return json({ error: 'Admins only' }, 403)
  }

  // ── Adopt: give one login the profile it is missing ────────────────────────
  if (body.adopt) {
    const id = String(body.adopt.id ?? '').trim()
    const role = String(body.adopt.role ?? '').trim()
    const name = String(body.adopt.name ?? '').trim()
    if (!id) return json({ error: 'Expected a login id' }, 400)
    if (!ASSIGNABLE.has(role)) return json({ error: `Invalid role "${role}"` }, 400)

    // Read the login rather than trusting the browser for the email: the
    // profile's address is what every later lookup joins on.
    const login = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { headers: service }).then((r) =>
      r.ok ? r.json() : null,
    )
    if (!login?.id) return json({ error: 'That login no longer exists.' }, 404)

    const made = await fetch(`${SB_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...admin, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: login.id,
        email: login.email ?? '',
        name: name || login.user_metadata?.name || login.email || '',
        role,
      }),
    })
    if (!made.ok) {
      const text = await made.text().catch(() => '')
      // 409 = a profile appeared in the meantime, which is the desired state.
      if (made.status === 409) return json({ ok: true, already: true }, 200)
      return json({ error: `Could not restore the profile (${made.status}). ${text.slice(0, 200)}` }, 502)
    }
    console.info(`[orphan-logins] ${me.id} adopted ${login.email} as ${role}`)
    return json({ ok: true }, 200)
  }

  // ── List: every login with no profile row ─────────────────────────────────
  const known = await fetch(`${SB_URL}/rest/v1/profiles?select=id`, { headers: service }).then((r) =>
    r.ok ? r.json() : null,
  )
  if (!Array.isArray(known)) return json({ error: 'Could not read profiles' }, 502)
  const hasProfile = new Set(known.map((r) => r.id))

  const logins = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=${PER_PAGE}`, { headers: service })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return json({ error: `Could not list logins (${res.status}). ${text.slice(0, 200)}` }, 502)
    }
    const out = await res.json()
    const batch = Array.isArray(out?.users) ? out.users : []
    for (const u of batch) {
      if (hasProfile.has(u.id)) continue
      logins.push({
        id: u.id,
        email: u.email ?? '',
        // The role the inviter chose. It survives on the auth user even when
        // the profile that should have carried it never appeared.
        name: u.user_metadata?.name ?? '',
        invitedRole: ASSIGNABLE.has(u.user_metadata?.role) ? u.user_metadata.role : null,
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      })
    }
    if (batch.length < PER_PAGE) break
  }

  return json({ ok: true, logins }, 200)
}
