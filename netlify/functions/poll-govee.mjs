/**
 * Cloud Govee poller — runs on a schedule in Netlify's cloud (NO always-on
 * computer needed). Every few minutes it reads the incubators from Supabase,
 * polls each running sensor's temp/humidity from the Govee API, and writes the
 * readings back to Supabase's `sensor_readings`. The web app then shows live data.
 *
 * Server-side only — the secrets live in Netlify env, never in the browser:
 *   GOVEE_API_KEY          — your Govee API key (same one the desktop poller uses)
 *   SUPABASE_SERVICE_ROLE  — Supabase service_role key (full access; server only)
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 *
 * Mirrors the logic in bee-incubation/govee_client.py (Platform API v2, with a
 * v1 fallback). Uses global fetch (Node 18+) — no dependencies.
 */

export const config = {
  // every 5 minutes; make it finer/coarser by editing this cron expression
  schedule: '*/5 * * * *',
}

const V2_STATE = 'https://openapi.api.govee.com/router/api/v1/device/state'
const V1_STATE = 'https://developer-api.govee.com/v1/devices/state'

/** Govee reports integers in 0.01 units (2942 → 29.42). */
const rawVal = (raw) => (typeof raw !== 'number' ? null : raw > 100 ? raw / 100 : raw)
/** Some sensors report °F; the desktop poller treats >50 as °F and converts. */
const toC = (t) => (t != null && t > 50 ? Math.round(((t - 32) * 5) / 9 * 100) / 100 : t)

function parseV2(caps = []) {
  let temp = null
  let hum = null
  for (const c of caps) {
    const inst = (c.instance || '').toLowerCase()
    const v = c.state?.value
    if (v == null) continue
    if (inst.includes('temperature')) temp = rawVal(v)
    else if (inst.includes('humidity')) hum = rawVal(v)
  }
  return { temp, hum }
}

async function pollDevice(key, device, sku) {
  // Platform API v2 (gateway sensors)
  try {
    const r = await fetch(V2_STATE, {
      method: 'POST',
      headers: { 'Govee-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: crypto.randomUUID(), payload: { sku, device } }),
    })
    const j = await r.json()
    if (j.code === 200) {
      const { temp, hum } = parseV2(j.payload?.capabilities || [])
      if (temp != null && hum != null) return { temp: toC(temp), hum }
    }
  } catch {
    /* fall through to v1 */
  }
  // Legacy API v1 fallback
  try {
    const url = `${V1_STATE}?device=${encodeURIComponent(device)}&model=${encodeURIComponent(sku)}`
    const r = await fetch(url, { headers: { 'Govee-API-Key': key } })
    const j = await r.json()
    let temp = null
    let hum = null
    for (const p of j.data?.properties || []) {
      if ('temperature' in p) temp = rawVal(p.temperature)
      if ('humidity' in p) hum = rawVal(p.humidity)
    }
    if (temp != null && hum != null) return { temp: toC(temp), hum }
  } catch {
    /* give up on this device this cycle */
  }
  return null
}

export default async () => {
  const GOVEE = process.env.GOVEE_API_KEY
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!GOVEE || !SB_URL || !SB_KEY) {
    return new Response('poll-govee: missing env (GOVEE_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE)', {
      status: 200,
    })
  }

  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  // Poll every incubator that has a Govee device configured. We intentionally do
  // NOT gate on temp_mode: that value is frozen at import time in Supabase (the
  // desktop app changes modes only in the local SQLite), so it can't be trusted
  // here. The physical sensor reports regardless of the app's "mode", and an
  // offline sensor simply returns nothing and is skipped below.
  const incs = await fetch(
    `${SB_URL}/rest/v1/incubators?select=id,name,govee_device_id,govee_sku`,
    { headers: sb },
  ).then((r) => r.json())

  const withDevice = (Array.isArray(incs) ? incs : []).filter((i) => i.govee_device_id && i.govee_sku)

  const at = new Date().toISOString()
  const readings = []
  for (const inc of withDevice) {
    const rd = await pollDevice(GOVEE, inc.govee_device_id.trim(), inc.govee_sku.trim())
    if (rd) readings.push({ incubator_id: inc.id, at, temp_c: rd.temp, humidity_pct: rd.hum, source: 'govee' })
  }

  if (readings.length) {
    await fetch(`${SB_URL}/rest/v1/sensor_readings`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(readings),
    })
  }

  const total = Array.isArray(incs) ? incs.length : 0
  return new Response(
    `poll-govee: ${total} incubators, ${withDevice.length} with a Govee device, ${readings.length} readings written`,
    { status: 200 },
  )
}
