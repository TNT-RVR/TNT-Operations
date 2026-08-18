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
 * An address that already has a login cannot be invited again — GoTrue refuses
 * it. `alreadyRegistered` at the bottom decides what that actually means and
 * answers accordingly; for someone who was invited and never signed in it
 * sends a set-password link, and the response says `mode: 'recovery'` so the
 * caller can tell the admin which mail went out.
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
      return await alreadyRegistered(SB_URL, SB_KEY, admin, email, site)
    }
    if (/rate limit|too many/i.test(msg)) {
      return json(
        { error: 'Supabase email rate limit hit. Configure custom SMTP in Supabase → Authentication → Emails to send real invites.' },
        429,
      )
    }
    return json({ error: msg }, res.status)
  }

  return json({ ok: true, email, role, mode: 'invite' }, 200)
}

/**
 * GoTrue refused the invite because the address already has a login. That is
 * not one situation, it is three, and they need different answers.
 *
 * The one that used to be handled wrongly is a RE-SEND: someone was invited,
 * never signed in, and the link expired or went to junk. The Users screen has
 * a "Resend invite" button for exactly them — and it could never work, because
 * re-inviting an existing account is what GoTrue refuses. So for a profile
 * that has never been signed into we send a RECOVERY mail instead: same
 * outcome for the person (a link that lets them set a password and get in),
 * from an endpoint that accepts existing users.
 *
 * An account that HAS signed in is a different thing — an admin typing an
 * address that is already on the roster — and mailing that person a
 * password-reset they did not ask for would be surprising, so it stays an error.
 *
 * A login with NO profile is the orphan case: mail would not help, because
 * signing in leaves them on the approval gate. Point at the fix instead.
 */
async function alreadyRegistered(SB_URL, SB_KEY, admin, email, site) {
  const rows = await fetch(
    `${SB_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,role,last_sign_in_at,archived_at`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
  )
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const prof = Array.isArray(rows) ? rows[0] : null

  if (!prof) {
    return json(
      {
        error:
          'That email has a login but no TNT profile — it will not work until the profile is restored. See "Logins with no profile" on the Users screen.',
      },
      409,
    )
  }
  if (prof.archived_at) {
    return json({ error: 'That person is archived. Restore them under Settings → Archive.' }, 409)
  }
  if (prof.last_sign_in_at) {
    return json({ error: 'That email already has an account — set their role in the table instead.' }, 409)
  }

  // Never signed in: send them a fresh link. `/recover` answers 200 for an
  // address it does not know, so a failure here is a real one.
  const sent = await fetch(`${SB_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(site)}`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email }),
  })
  if (!sent.ok) {
    const text = await sent.text().catch(() => '')
    if (/rate limit|too many/i.test(text)) {
      return json({ error: 'Supabase email rate limit hit — wait an hour, or configure custom SMTP.' }, 429)
    }
    return json({ error: `Could not send the link (${sent.status}). ${text.slice(0, 200)}` }, 502)
  }
  return json({ ok: true, email, mode: 'recovery' }, 200)
}
