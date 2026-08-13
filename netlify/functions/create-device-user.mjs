/**
 * Create a DEVICE account — a shared iPad — with a username and password, no
 * email (admin only).
 *
 * The crews' iPads belong to nobody, so they need accounts of their own. Going
 * through the normal invite flow would mean inventing a mailbox per device and
 * clicking a confirmation link on a tablet in a truck, which is the sort of
 * setup step that gets done wrong at 6am.
 *
 * Supabase identifies users by email, so one is SYNTHESISED from the username
 * (`ipad-a` → `ipad-a@devices.invalid`) and the account is created already
 * confirmed. `.invalid` is reserved by RFC 2606 and can never be a real domain,
 * so these addresses cannot collide with a person's and no mail can ever be
 * sent to one by accident.
 *
 * The role is always `device`: maps-view and nothing else. This endpoint
 * cannot mint an admin, whatever it is asked for — an account-creation route
 * that can escalate is worth more to an attacker than the iPad ever was.
 *
 *   POST /.netlify/functions/create-device-user
 *   Authorization: Bearer <the admin's supabase access token>
 *   { "username": "ipad-a", "password": "…", "name": "iPad A" }
 *
 * Env (server-side only): SUPABASE_SERVICE_ROLE, SUPABASE_URL.
 */

/** Reserved by RFC 2606 — guaranteed never to resolve or receive mail. */
const DEVICE_DOMAIN = 'devices.invalid'

/** Long enough that a shoulder-surfed iPad isn't a guessable account. */
const MIN_PASSWORD = 10

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** `iPad A!` → `ipad-a`. Rejects anything that would make an odd address. */
export const usernameToSlug = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

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

  const slug = usernameToSlug(body?.username)
  const password = String(body?.password ?? '')
  const name = String(body?.name ?? '').trim() || slug
  if (!slug) return json({ error: 'Enter a username — letters and numbers.' }, 400)
  if (password.length < MIN_PASSWORD) {
    return json({ error: `Use a password of at least ${MIN_PASSWORD} characters.` }, 400)
  }

  const admin = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

  // Who is calling, and are they an admin? Checked server-side with the
  // service key so the browser cannot lie about it.
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  const role = Array.isArray(prof) ? prof[0]?.role : null
  if (role !== 'admin' && role !== 'developer') {
    return json({ error: 'Only an admin can create device accounts.' }, 403)
  }

  const email = `${slug}@${DEVICE_DOMAIN}`

  // Create it already confirmed: there is no mailbox to confirm from, and an
  // unconfirmed account cannot sign in.
  const created = await fetch(`${SB_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      // handle_new_user (migration 0011) reads these onto the profile.
      user_metadata: { name, role: 'device' },
    }),
  })
  if (!created.ok) {
    const text = await created.text().catch(() => '')
    // The common one by far: two iPads given the same name.
    if (created.status === 422 || /already/i.test(text)) {
      return json({ error: `A device called "${slug}" already exists.` }, 409)
    }
    return json({ error: `Could not create the device (${created.status}). ${text.slice(0, 200)}` }, 502)
  }
  const user = await created.json()

  // Belt and braces on the role. The trigger normally sets it from metadata,
  // but a device account that silently landed as `pending` would look like a
  // broken login on a tablet in a field, which is a bad place to debug.
  await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...admin, Prefer: 'return=minimal' },
    body: JSON.stringify({ role: 'device', name }),
  })

  console.info(`[create-device-user] ${me.id} created device ${slug}`)
  return json({ ok: true, id: user.id, username: slug, email, name })
}
