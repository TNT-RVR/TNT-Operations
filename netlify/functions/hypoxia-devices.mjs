/**
 * Create a chamber and issue its device key.
 *
 *   POST { "action": "create", "name": "…", "location": "…", "pod": 1 }
 *     → { ok, chamber, deviceKey }   ← the key is returned ONCE, and never again
 *
 *   POST { "action": "rekey", "chamberId": "…" }
 *     → { ok, deviceKey }            ← for a board being reflashed or a leak
 *
 *   POST { "action": "delete", "chamberId": "…", "confirmName": "…" }
 *     → { ok }                       ← readings and commands cascade with it
 *
 * Admin only. This mints the credential that lets a box send readings and
 * collect purge, valve and blast-door commands.
 *
 * ── Why the key is shown once ───────────────────────────────────────────────
 *
 * Only its SHA-256 is stored, so there is nothing to show later — the database
 * cannot reveal it, and neither can a backup or a leaked query result. That is
 * the whole point: the student's firmware carried a ThingsBoard token as a
 * string literal, so anyone who read the source could command the chamber.
 * A key that can be re-read is a key that will be, eventually, by the wrong
 * person.
 *
 * Losing it costs one rekey and one reflash, which is the right price.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE.
 */
import { createHash, randomBytes } from 'node:crypto'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * A key the firmware can carry as a string literal without ambiguity.
 *
 * base64url rather than raw base64: `+` and `/` in a URL or a header are a
 * source of one-character transcription bugs, and this gets typed into an
 * Arduino sketch by hand at least once.
 */
function newDeviceKey() {
  return randomBytes(24).toString('base64url')
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first' }, 401)
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Sign in first' }, 401)

  const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` }
  const role = await fetch(`${SB_URL}/rest/v1/profiles?select=role&id=eq.${me.id}`, { headers: sb })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0]?.role)
  if (!['admin', 'developer'].includes(role)) {
    return json({ error: 'Adding, rekeying and deleting chambers is admin-only.' }, 403)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const deviceKey = newDeviceKey()
  const hash = sha256(deviceKey)
  const hint = deviceKey.slice(-4)

  if (body?.action === 'create') {
    const name = String(body.name ?? '').trim()
    if (!name) return json({ error: 'Give the chamber a name people will recognise.' }, 400)

    const res = await fetch(`${SB_URL}/rest/v1/hypoxia_chambers`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        name,
        location: String(body.location ?? '').trim(),
        pod: Number(body.pod) || 1,
        device_key_hash: hash,
        device_key_hint: hint,
        key_set_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) return json({ error: (await res.text()).slice(0, 300) }, 502)
    const [row] = await res.json()
    return json({ ok: true, chamber: row, deviceKey })
  }

  if (body?.action === 'rekey') {
    const chamberId = String(body.chamberId ?? '')
    if (!chamberId) return json({ error: 'Which chamber?' }, 400)
    const res = await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${chamberId}`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        device_key_hash: hash,
        device_key_hint: hint,
        key_set_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) return json({ error: (await res.text()).slice(0, 300) }, 502)
    /*
     * The old key stops working the moment this returns, so the chamber goes
     * silent until it is reflashed. That is the correct behaviour for a
     * credential you believe is compromised, and the UI says it plainly.
     */
    return json({ ok: true, deviceKey })
  }

  /*
   * Delete a chamber, and with it every reading and command it ever had —
   * hypoxia_readings and hypoxia_commands both cascade on this row.
   *
   * This exists because there is no DELETE policy on hypoxia_chambers and there
   * should not be one: the table is written by the service role precisely so a
   * client cannot mint or destroy the thing that holds a credential. Routing it
   * through here keeps that property and gets an admin check on the way past.
   *
   * DEACTIVATING is the usual answer and the UI offers it first — an inactive
   * chamber stops being watched for silence but keeps its history. Deletion is
   * for a row created by mistake, so the caller must name the chamber exactly.
   * That is not ceremony: the id comes from a button and would delete whatever
   * it pointed at, whereas a typed name cannot be produced by clicking the
   * wrong card.
   */
  if (body?.action === 'delete') {
    const chamberId = String(body.chamberId ?? '')
    if (!chamberId) return json({ error: 'Which chamber?' }, 400)

    const [row] = await fetch(
      `${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${chamberId}&select=name&limit=1`,
      { headers: sb },
    ).then((r) => (r.ok ? r.json() : []))
    if (!row) return json({ error: 'That chamber no longer exists.' }, 404)

    if (String(body.confirmName ?? '').trim() !== row.name) {
      return json({ error: `Type the chamber's name exactly ("${row.name}") to delete it.` }, 400)
    }

    const res = await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${chamberId}`, {
      method: 'DELETE',
      headers: { ...sb, Prefer: 'return=minimal' },
    })
    if (!res.ok) return json({ error: (await res.text()).slice(0, 300) }, 502)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
}
