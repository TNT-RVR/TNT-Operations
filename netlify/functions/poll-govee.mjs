/**
 * Cloud Govee poller — runs on a schedule in Netlify's cloud (NO always-on
 * computer needed). It reads the incubators from Supabase, polls each RUNNING
 * sensor's temp/humidity from the Govee API, and writes the readings back to
 * `sensor_readings`. The web app then shows live data.
 *
 * ── Adaptive cadence (why this isn't a simple "poll everything") ─────────────
 * Polling every incubator every 5 min regardless of state buried the real data:
 * by 2026-08-03, 56% of all sensor_readings were ambient noise logged while every
 * incubator was switched off. So an incubator's `temp_mode` decides its cadence:
 *
 * Running (`temp_mode` is not `off`) → polled every FAST_MIN.
 * Idle                               → one poll per IDLE_HEARTBEAT_H, NEVER
 *                                      fully stopped.
 *
 * That heartbeat is the safety net. Supabase is the source of truth for
 * `temp_mode` (the app writes it via `saveIncubator`; the old Python desktop app
 * was only a prototype), but a mode is still only as accurate as the last person
 * to set it. Because idle incubators keep logging every few hours, a forgotten
 * `off` costs resolution — never the run itself.
 *
 * DO NOT re-add "detect running from temperature". It was tried and removed
 * (2026-08-03): an incubator that is switched OFF still reaches incubation
 * temperatures on a hot day, purely from ambient. On the day it was removed,
 * with all 8 incubators off, four had already exceeded a 24 °C "running"
 * threshold (peaks of 26.4 / 28.6 / 29.5 / 50.0 °C). The mirror-image trick —
 * inferring cool storage from a low reading — fails the same way in an unheated
 * shop in winter. Temperature simply cannot distinguish "heated to 30" from
 * "hot outside", so it must not drive polling.
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
  // Runs at the FAST rate; idle incubators are throttled per-incubator below.
  schedule: '*/15 * * * *',
}

/** Cadence for a running incubator — must match the cron above. */
const FAST_MIN = 15
/** Idle incubators still get one poll this often, so nothing goes fully dark. */
const IDLE_HEARTBEAT_H = 6

/** Anything that isn't `off` is actively being held at a temperature. */
const RUNNING_MODES = new Set(['incubation', 'cool_storage', 'holding'])

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

  const incs = await fetch(
    `${SB_URL}/rest/v1/incubators?select=id,name,govee_device_id,govee_sku,temp_mode`,
    { headers: sb },
  ).then((r) => r.json())

  const withDevice = (Array.isArray(incs) ? incs : []).filter((i) => i.govee_device_id && i.govee_sku)

  // Decide per incubator whether to poll this cycle (see the note at the top).
  // A running incubator always polls; an idle one only once its last reading is
  // older than the heartbeat, so we need that timestamp.
  const plan = []
  for (const inc of withDevice) {
    const running = RUNNING_MODES.has(inc.temp_mode)

    let ageH = Infinity // no history (or an unreadable one) → poll
    if (!running) {
      try {
        const last = await fetch(
          `${SB_URL}/rest/v1/sensor_readings?incubator_id=eq.${inc.id}&select=at&order=at.desc&limit=1`,
          { headers: sb },
        ).then((r) => r.json())
        const lastAt = Array.isArray(last) && last[0]?.at ? new Date(last[0].at).getTime() : 0
        if (lastAt) ageH = (Date.now() - lastAt) / 3600_000
      } catch {
        /* never skip a poll because a history lookup failed */
      }
    }

    plan.push({ inc, running, shouldPoll: running || ageH >= IDLE_HEARTBEAT_H })
  }

  const due = plan.filter((p) => p.shouldPoll)

  const at = new Date().toISOString()
  const readings = []
  for (const { inc } of due) {
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

  // ── Integration health: alert when a sensor feed goes stale ────────────────
  // Only RUNNING incubators are watched. An idle one is polled just once every
  // IDLE_HEARTBEAT_H by design, so its readings are legitimately hours apart —
  // watching it here would fire a "stale feed" alert on every single cycle.
  // A running incubator is the one whose data actually matters.
  const STALE_MIN = 30
  const DEDUPE_H = 6
  let alerts = 0
  const failed = plan
    .filter((p) => p.running)
    .map((p) => p.inc)
    .filter((i) => !readings.some((r) => r.incubator_id === i.id))
  for (const inc of failed) {
    try {
      const last = await fetch(
        `${SB_URL}/rest/v1/sensor_readings?incubator_id=eq.${inc.id}&select=at&order=at.desc&limit=1`,
        { headers: sb },
      ).then((r) => r.json())
      const lastAt = Array.isArray(last) && last[0]?.at ? new Date(last[0].at).getTime() : 0
      const ageMin = (Date.now() - lastAt) / 60000
      if (ageMin < STALE_MIN) continue

      const since = new Date(Date.now() - DEDUPE_H * 3600_000).toISOString()
      const dupe = await fetch(
        `${SB_URL}/rest/v1/app_notifications?type=eq.sensor_feed_stale&source=eq.govee_poller&deleted_at=is.null` +
          `&created_at=gte.${since}&body=like.*${encodeURIComponent(inc.name)}*&select=id&limit=1`,
        { headers: sb },
      ).then((r) => r.json())
      if (Array.isArray(dupe) && dupe.length > 0) continue

      const ageTxt = lastAt ? `${Math.round(ageMin)} minutes` : 'ever (no readings on record)'
      await fetch(`${SB_URL}/rest/v1/app_notifications`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          category: 'integration',
          type: 'sensor_feed_stale',
          severity: 'critical',
          title: `${inc.name} sensor feed is stale`,
          body: `No reading from ${inc.name} in ${ageTxt} — the Govee sensor or gateway may be offline.`,
          source: 'govee_poller',
        }),
      })
      alerts++
    } catch {
      /* health check must never break the poll */
    }
  }

  const total = Array.isArray(incs) ? incs.length : 0
  const runningNames = plan.filter((p) => p.running).map((p) => p.inc.name)
  const heartbeats = due.filter((p) => !p.running).length
  return new Response(
    `poll-govee: ${total} incubators, ${withDevice.length} with a Govee device, ` +
      `${runningNames.length} running [${runningNames.join(', ') || 'none'}], ` +
      `${heartbeats} idle heartbeat(s), ${readings.length} readings written, ` +
      `${alerts} stale alerts raised`,
    { status: 200 },
  )
}
