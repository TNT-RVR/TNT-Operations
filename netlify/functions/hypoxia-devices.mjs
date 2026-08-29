/**
 * Find the chambers, and link them — so nobody has to copy a UUID.
 *
 *   POST { "action": "list" }
 *     → the devices this ThingsBoard account can see, with which ones are
 *       already linked to a chamber here.
 *
 *   POST { "action": "link", "deviceId": "…", "name": "…", "location": "…" }
 *     → creates the chamber row, or re-points an existing one at that device.
 *
 * Authorization: Bearer <the caller's supabase access token>. Admin only: this
 * decides which physical box the app will send valve and blast-door commands
 * to, and pointing a chamber at the wrong device is worse than not linking it.
 *
 * ── Why this exists rather than a text box ──────────────────────────────────
 *
 * A ThingsBoard device id is a bare UUID. Typing or pasting one into a form
 * gets it wrong eventually, and the failure is silent and terrible: the app
 * reads someone else's telemetry and sends purge and valve commands to the
 * wrong sealed chamber. Choosing from a list of real names removes the
 * opportunity entirely.
 *
 * `hypoxia_chambers` has no client INSERT policy on purpose, so creation goes
 * through here under the service role after the role check.
 *
 * Env: TB_USERNAME / TB_PASSWORD (+ optional TB_BASE_URL), SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE.
 */
import { tbBase, tbConfigured, tbToken } from './lib/thingsboard.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Devices the account can see. Paged, because the API is. */
async function listDevices() {
  const token = await tbToken()
  const out = []
  let page = 0
  // A guard, not a limit anyone should reach: TNT has a handful of chambers.
  while (page < 10) {
    const res = await fetch(
      `${tbBase()}/api/tenant/devices?pageSize=100&page=${page}&sortProperty=name&sortOrder=ASC`,
      { headers: { 'X-Authorization': `Bearer ${token}` } },
    )
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      // A CUSTOMER user cannot read tenant devices; try the customer endpoint
      // before giving up, since either kind of login is plausible here.
      if (res.status === 403 && page === 0) return listCustomerDevices(token)
      throw new Error(`ThingsBoard devices ${res.status}: ${detail}`)
    }
    const body = await res.json()
    for (const d of body?.data ?? []) {
      out.push({ id: d?.id?.id ?? '', name: d?.name ?? '', type: d?.type ?? '', label: d?.label ?? '' })
    }
    if (!body?.hasNext) break
    page++
  }
  return out.filter((d) => d.id)
}

async function listCustomerDevices(token) {
  const me = await fetch(`${tbBase()}/api/auth/user`, {
    headers: { 'X-Authorization': `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null))
  const customerId = me?.customerId?.id
  if (!customerId) throw new Error('ThingsBoard: this account can see neither tenant nor customer devices.')

  const res = await fetch(
    `${tbBase()}/api/customer/${customerId}/devices?pageSize=100&page=0&sortProperty=name&sortOrder=ASC`,
    { headers: { 'X-Authorization': `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`ThingsBoard customer devices ${res.status}`)
  const body = await res.json()
  return (body?.data ?? [])
    .map((d) => ({ id: d?.id?.id ?? '', name: d?.name ?? '', type: d?.type ?? '', label: d?.label ?? '' }))
    .filter((d) => d.id)
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)
  if (!tbConfigured()) {
    return json(
      { error: 'ThingsBoard is not configured — set TB_USERNAME and TB_PASSWORD in Netlify, then reload.' },
      501,
    )
  }

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
    return json({ error: 'Linking a chamber to a device is admin-only.' }, 403)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  try {
    if (body?.action === 'list') {
      const devices = await listDevices()
      const linked = await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?select=id,name,tb_device_id`, {
        headers: sb,
      }).then((r) => (r.ok ? r.json() : []))
      const byDevice = new Map((linked ?? []).filter((c) => c.tb_device_id).map((c) => [c.tb_device_id, c.name]))
      return json({
        devices: devices.map((d) => ({ ...d, linkedTo: byDevice.get(d.id) ?? null })),
      })
    }

    if (body?.action === 'link') {
      const deviceId = String(body.deviceId ?? '').trim()
      const name = String(body.name ?? '').trim()
      if (!deviceId) return json({ error: 'Pick a device.' }, 400)
      if (!name) return json({ error: 'Give the chamber a name people will recognise.' }, 400)

      // One device, one chamber. Two rows pointing at the same box would each
      // look healthy while duplicating its history and doubling its commands.
      const clash = await fetch(
        `${SB_URL}/rest/v1/hypoxia_chambers?select=id,name&tb_device_id=eq.${encodeURIComponent(deviceId)}`,
        { headers: sb },
      ).then((r) => (r.ok ? r.json() : []))
      if (clash?.[0]) {
        return json({ error: `That device is already linked to "${clash[0].name}".` }, 409)
      }

      const res = await fetch(`${SB_URL}/rest/v1/hypoxia_chambers`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          name,
          location: String(body.location ?? '').trim(),
          tb_device_id: deviceId,
          pod: Number(body.pod) || 1,
        }),
      })
      if (!res.ok) return json({ error: (await res.text()).slice(0, 300) }, 502)
      const [row] = await res.json()
      return json({ ok: true, chamber: row })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: e?.message ?? String(e) }, 502)
  }
}
