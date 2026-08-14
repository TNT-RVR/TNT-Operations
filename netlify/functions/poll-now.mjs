/**
 * Read one incubator's Govee sensor RIGHT NOW, on demand.
 *
 * The scheduled poller (poll-govee.mjs) runs every 15 minutes, which is the
 * right cadence for a season of history and the wrong one for someone standing
 * at an incubator wanting to know what it is doing this minute.
 *
 * Deliberately NOT a schedule of its own and deliberately not the same door as
 * run.mjs: this polls a single incubator, returns the reading synchronously so
 * the button can show it, and is gated on a signed-in user rather than a shared
 * token.
 *
 * It stores the reading like any other, so the chart and "latest" line pick it
 * up. It does NOT evaluate alerts — the scheduled poller owns alerting, and a
 * button that could fire pushes would let anyone spam the crew by tapping it.
 *
 *   POST /.netlify/functions/poll-now   { "incubatorId": "…" }
 *   Authorization: Bearer <the caller's supabase access token>
 *
 * Env (server-side): GOVEE_API_KEY, SUPABASE_SERVICE_ROLE, SUPABASE_URL.
 */

import { pollDevice } from './poll-govee.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Any signed-in user may read a sensor — it changes nothing physical. */
async function identify(req, SB_URL, SB_KEY) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  return me?.id ?? null
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const GOVEE = process.env.GOVEE_API_KEY
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!GOVEE || !SB_URL || !SB_KEY) {
    return json({ error: 'Not configured — GOVEE_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE.' }, 500)
  }

  const userId = await identify(req, SB_URL, SB_KEY)
  if (!userId) return json({ error: 'Sign in first' }, 401)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }
  const incubatorId = String(body?.incubatorId ?? '').trim()
  if (!incubatorId) return json({ error: 'No incubator given' }, 400)

  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  const rows = await fetch(
    `${SB_URL}/rest/v1/incubators?id=eq.${encodeURIComponent(incubatorId)}&select=id,name,govee_device_id,govee_sku`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : null))
  const inc = Array.isArray(rows) ? rows[0] : null
  if (!inc) return json({ error: 'No such incubator' }, 404)
  if (!inc.govee_device_id || !inc.govee_sku) {
    return json({ error: `${inc.name} has no Govee sensor linked.` }, 400)
  }

  const rd = await pollDevice(GOVEE, inc.govee_device_id.trim(), inc.govee_sku.trim())
  /**
   * Record what the pull learned about the link, exactly as the scheduled
   * poller does.
   *
   * Without this, "Read now" is the one way to ask a sensor a question and
   * NOT have the answer reach the screen — press it on a dead sensor and the
   * card carries on saying "not checked", which is the state it was in before
   * anybody looked.
   */
  const noteLink = async (online) => {
    if (online == null) return
    const now = new Date().toISOString()
    const patch = { sensor_online: online, sensor_checked_at: now }
    if (online) patch.sensor_seen_at = now
    await fetch(`${SB_URL}/rest/v1/incubators?id=eq.${inc.id}`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    }).catch(() => {
      /* a link note is never worth failing the reading over */
    })
  }

  if (rd && rd.online === false) {
    await noteLink(false)
    // Govee knows the device and says it is off the network — a flat battery or
    // a sensor out of range of its gateway. Worth saying exactly, because it is
    // the one failure the person standing there can actually fix.
    return json(
      { error: `The sensor on ${inc.name} is offline. Check its battery and that it is in range of the gateway.` },
      502,
    )
  }
  if (!rd || rd.temp == null || rd.hum == null) {
    // Distinguish "the sensor didn't answer" from "we never asked": this is the
    // difference between a flat battery and a broken deploy.
    return json({ error: `The sensor on ${inc.name} did not answer. Check it is powered and online.` }, 502)
  }

  await noteLink(rd.online)

  const at = new Date().toISOString()
  const reading = { incubator_id: inc.id, at, temp_c: rd.temp, humidity_pct: rd.hum, source: 'govee' }
  const ins = await fetch(`${SB_URL}/rest/v1/sensor_readings`, {
    method: 'POST',
    headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([reading]),
  })
  // A reading we can't store is still a reading worth showing, so this reports
  // the number and says it wasn't saved rather than failing outright.
  const stored = ins.ok

  console.info(`[poll-now] ${userId} polled ${inc.name}: ${rd.temp}°C ${rd.hum}% (stored=${stored})`)
  return json({ ok: true, stored, reading: { at, tempC: rd.temp, humidityPct: rd.hum } })
}
