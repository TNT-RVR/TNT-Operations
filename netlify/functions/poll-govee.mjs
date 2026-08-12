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

import {
  pushOptIns,
  subscriptionsFor,
  sendToAll,
  recentlyNotified,
  lastAlertAt,
  writeInAppNotification,
} from './lib/push.mjs'

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

/**
 * Target band per mode, in °C. Mirrors TEMP_MODES in src/domain/incubation.ts
 * (and the desktop app's `get_temp_range`) — if you change one, change both.
 * `off` has no band: an idle incubator isn't being held anywhere, so it can't
 * be "out of range".
 */
const TEMP_BANDS = {
  cool_storage: [0.0, 12.0],
  incubation: [25.0, 35.0],
  holding: [10.0, 18.0],
}

/**
 * Don't re-push the same condition more often than this. The poll runs every
 * 15 min and an out-of-band incubator STAYS out of band, so without a cooldown
 * the same alert would fire four times an hour until someone fixed it — which
 * just teaches people to ignore alerts.
 */
const ALERT_COOLDOWN_MIN = 120

/**
 * Only announce a recovery for a problem raised within this window. An
 * all-clear for something that went wrong days ago, unseen, is noise.
 */
const RECOVERY_LOOKBACK_H = 24

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

// Exported for poll-now.mjs, the on-demand single-incubator read.
export async function pollDevice(key, device, sku) {
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
    `${SB_URL}/rest/v1/incubators?select=id,name,govee_device_id,govee_sku,temp_mode,temp_alerts_enabled`,
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

  // ── Temperature out of band ───────────────────────────────────────────────
  // The desktop app raised these and nothing replaced it when we moved to the
  // cloud, so from 2026-07-23 until now NOTHING was watching temperatures.
  // Evaluated against the reading just taken, for running incubators only.
  let tempAlerts = 0
  let recoveries = 0
  let pushesSent = 0
  // NOTE: the preference key is the settings-screen row ('temp_out_of_range'),
  // while alerts.alert_type stays 'temp_humidity' to match the desktop
  // app's imported history. They are deliberately different.
  const optIns = await pushOptIns(SB_URL, sb, 'temp_out_of_range').catch(() => new Set())
  const subs = await subscriptionsFor(SB_URL, sb, optIns).catch(() => [])

  for (const { inc, running } of plan) {
    // Off incubators have no band, and the per-incubator switch can mute one
    // that's known to be misbehaving without silencing the rest.
    if (!running || inc.temp_alerts_enabled === false) continue
    const reading = readings.find((r) => r.incubator_id === inc.id)
    if (!reading || reading.temp_c == null) continue

    const band = TEMP_BANDS[inc.temp_mode]
    if (!band) continue
    const [min, max] = band
    const t = reading.temp_c
    const dedupKey = `temp_humidity:temp:${inc.id}`
    const clearKey = `temp_humidity:clear:${inc.id}`

    // ── Back in range: send ONE all-clear, then stay quiet ──────────────────
    // Without this, alerts just stop, and silence is ambiguous — it reads the
    // same as "nothing is watching any more".
    if (t >= min && t <= max) {
      // Only clear an episode someone was actually told about.
      const lastProblem = await lastAlertAt(SB_URL, sb, dedupKey, { notifiedOnly: true }).catch(() => null)
      if (!lastProblem) continue
      // Ignore stale episodes: an all-clear for something that went wrong days
      // ago and was never seen is noise, not news.
      if (Date.now() - new Date(lastProblem).getTime() > RECOVERY_LOOKBACK_H * 3600_000) continue
      // Already cleared this episode? The clear must be NEWER than the problem.
      const lastClear = await lastAlertAt(SB_URL, sb, clearKey).catch(() => null)
      if (lastClear && new Date(lastClear) > new Date(lastProblem)) continue

      const okMsg = `${inc.name}: Temp ${t.toFixed(1)}°C is back in range (${min.toFixed(1)}–${max.toFixed(1)}°C)`
      await fetch(`${SB_URL}/rest/v1/alerts`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          alert_type: 'temp_humidity',
          severity: 'info',
          incubator_id: inc.id,
          message: okMsg,
          dedup_key: clearKey,
          notified: true,
        }),
      })
      await writeInAppNotification(SB_URL, sb, {
        category: 'incubation',
        type: 'temp_out_of_range',
        severity: 'info',
        title: `${inc.name} is back in range`,
        body: okMsg,
        source: 'alert_rules',
        dedupKey: clearKey,
      })
      const okRes = await sendToAll(SB_URL, sb, subs, {
        title: `${inc.name} back in range`,
        body: okMsg,
        url: '/incubation',
        // Same tag as the problem, so the all-clear REPLACES the warning on the
        // lock screen rather than sitting beneath it contradicting it.
        tag: `temp-${inc.id}`,
      }).catch(() => ({ sent: 0 }))
      pushesSent += okRes.sent
      recoveries++
      continue
    }

    const above = t > max
    // Message shape copied from the desktop app's alerts, so the Alerts screen
    // reads consistently across the changeover.
    const message =
      `${inc.name}: Temp ${t.toFixed(1)}°C ` +
      `${above ? 'above maximum' : 'below minimum'} ${(above ? max : min).toFixed(1)}°C`
    // On lookup failure assume "already notified": a quiet miss beats a storm.
    const quiet = await recentlyNotified(SB_URL, sb, dedupKey, ALERT_COOLDOWN_MIN).catch(() => true)

    // Log EVERY occurrence (that's the alert history); notify only past the
    // cooldown. `notified` is what the cooldown lookup reads next cycle.
    await fetch(`${SB_URL}/rest/v1/alerts`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        alert_type: 'temp_humidity',
        severity: 'warning',
        incubator_id: inc.id,
        message,
        dedup_key: dedupKey,
        notified: !quiet,
      }),
    })
    tempAlerts++
    if (quiet) continue

    await writeInAppNotification(SB_URL, sb, {
      category: 'incubation',
      type: 'temp_out_of_range',
      severity: 'warning',
      title: `${inc.name} is out of range`,
      body: message,
      source: 'alert_rules',
      dedupKey,
    })
    const res = await sendToAll(SB_URL, sb, subs, {
      title: `${inc.name} out of range`,
      body: message,
      url: '/incubation',
      // One live notice per incubator — replaced, not stacked six deep.
      tag: `temp-${inc.id}`,
    }).catch(() => ({ sent: 0 }))
    pushesSent += res.sent
  }

  // Staleness is NOT checked here any more — watchdog.mjs owns it.
  //
  // This check used to live in the poller, which is the one place it cannot
  // do its job: if this function crashes or stops being scheduled, the check
  // that would have reported that goes down with it. It also only ever wrote
  // to the bell inbox, so a feed could go quiet mid-run with nothing on
  // anyone's phone.

  const total = Array.isArray(incs) ? incs.length : 0
  const runningNames = plan.filter((p) => p.running).map((p) => p.inc.name)
  const heartbeats = due.filter((p) => !p.running).length
  return new Response(
    `poll-govee: ${total} incubators, ${withDevice.length} with a Govee device, ` +
      `${runningNames.length} running [${runningNames.join(', ') || 'none'}], ` +
      `${heartbeats} idle heartbeat(s), ${readings.length} readings written, ` +
      `${tempAlerts} temp alerts raised, ${recoveries} recovered, ${pushesSent} push(es) sent`,
    { status: 200 },
  )
}
