/**
 * Email someone a link back to the app (admin only).
 *
 * The commonest support question is not a password problem — it is "where is
 * the app?". The URL was in an invite mail months ago, on a phone that has
 * since been wiped, and the person has no way back in that does not go through
 * an admin. This is that button.
 *
 * It sends a MAGIC LINK: the mail carries the app's address and clicking it
 * signs them in, so the answer to "where is it" and "I can't get in" is one
 * click either way. TNT has no mailer of its own (no SMTP, no Resend — see the
 * migration notes), so this rides Supabase's, the same sender as invites and
 * password resets. Single-use, and it expires the way Supabase's links do.
 *
 * `create_user: false` matters: signups are invitation-only, and an OTP call
 * that could create an account would be a way around that.
 *
 *   POST /.netlify/functions/send-app-link
 *   Authorization: Bearer <the admin's supabase access token>
 *   { "id": "<the user's uuid>" }
 *
 * Env (Netlify, server-side only):
 *   SUPABASE_SERVICE_ROLE  — service_role key
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 *   URL                    — Netlify's site URL; where the link lands
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
  const service = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  const mine = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, { headers: service }).then((r) =>
    r.ok ? r.json() : null,
  )
  const callerRole = Array.isArray(mine) ? mine[0]?.role : null
  if (callerRole !== 'admin' && callerRole !== 'developer') {
    return json({ error: 'Admins only' }, 403)
  }

  // The address comes from the profile, never from the browser: this endpoint
  // mails whoever it is told to, so who it can mail must be the roster.
  const rows = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=email,name,role,archived_at`, {
    headers: service,
  }).then((r) => (r.ok ? r.json() : null))
  const target = Array.isArray(rows) ? rows[0] : null
  if (!target) return json({ error: 'That person is not on the roster.' }, 404)
  if (target.archived_at) return json({ error: 'That person is archived — restore them first.' }, 409)
  // A crew iPad's address is synthetic (`…@devices.invalid`) and can never
  // receive mail. Sending would fail somewhere less obvious than here.
  if (target.role === 'device' || /@devices\.invalid$/i.test(target.email ?? '')) {
    return json({ error: 'A device account has no mailbox — sign the iPad in with its username.' }, 400)
  }
  if (!target.email) return json({ error: 'That person has no email address on file.' }, 400)

  const site = process.env.URL || 'https://tntoperations.netlify.app'
  const sent = await fetch(`${SB_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(site)}`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email: target.email, create_user: false }),
  })
  if (!sent.ok) {
    const text = await sent.text().catch(() => '')
    if (/rate limit|too many/i.test(text)) {
      return json({ error: 'Supabase email rate limit hit — wait an hour, or configure custom SMTP.' }, 429)
    }
    return json({ error: `Could not send the link (${sent.status}). ${text.slice(0, 200)}` }, 502)
  }

  console.info(`[send-app-link] ${me.id} sent an app link to ${target.email}`)
  return json({ ok: true, email: target.email }, 200)
}
