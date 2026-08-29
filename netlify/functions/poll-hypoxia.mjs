/**
 * Pull hypoxia chamber telemetry out of ThingsBoard and into Supabase.
 *
 * ThingsBoard stays the device gateway — the chambers publish to it over MQTT
 * and take commands back from it — but the app needs what it needs for
 * incubators: history that outlives a retention window, and alerts that reach a
 * phone. This is the same shape as the Govee poller, for the same reasons.
 *
 * ── What it alerts on, and what it deliberately does not ────────────────────
 *
 *   silent          nothing heard for SILENT_AFTER_MIN. The bridge publishes
 *                   every 15 s, so silence means the Nano, the ESP32 or the
 *                   Wi-Fi has stopped — and a sealed chamber nobody is hearing
 *                   from is the worst state to be unaware of.
 *   fault           the Nano raised its own error flag.
 *   out of band     oxygen outside setpoint ± deadband.
 *
 * NOT alerted: a chamber that is purging or in maintenance. Purging leaves the
 * band ON PURPOSE — that is the mechanism working, and alerting on it would
 * mean an alert every cycle. Maintenance means a person is standing there
 * driving it by hand; telling them their chamber is out of band is telling them
 * what they are doing.
 *
 * Env: TB_USERNAME / TB_PASSWORD (+ optional TB_BASE_URL), SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE. Unconfigured, it no-ops with 501 rather than throwing.
 */
import { tbConfigured, tbLatestTelemetry } from './lib/thingsboard.mjs'
import { pushOptIns, subscriptionsFor, sendToAll, writeInAppNotification } from './lib/push.mjs'

export const config = {
  // Every five minutes. The device publishes far faster; this is about noticing
  // a chamber has drifted or gone quiet, not about capturing every breath.
  schedule: '*/5 * * * *',
}

/** Keys the Nano publishes. Mirrors src/domain/hypoxia.ts. */
const KEYS = ['o2', 't', 'rh', 'v1', 'v2', 'blow', 'circ', 'purge', 'maint', 'w', 'e']

/** Mirrors SILENT_AFTER_MIN in src/domain/hypoxia.ts. */
const SILENT_AFTER_MIN = 10

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const flag = (v) => num(v) === 1

export default async () => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) {
    return new Response('poll-hypoxia: not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 501 })
  }
  if (!tbConfigured()) {
    return new Response('poll-hypoxia: not configured (TB_USERNAME / TB_PASSWORD)', { status: 501 })
  }
  const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` }

  const chambers = await fetch(
    `${SB_URL}/rest/v1/hypoxia_chambers?select=*&active=is.true&tb_device_id=not.is.null`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  if (!Array.isArray(chambers) || chambers.length === 0) {
    return new Response('poll-hypoxia: no active chambers with a device', { status: 200 })
  }

  const summary = { polled: 0, stored: 0, alerts: 0, errors: [] }

  for (const c of chambers) {
    try {
      const latest = await tbLatestTelemetry(c.tb_device_id, KEYS)
      summary.polled++
      if (!latest) continue

      const v = latest.values
      const o2 = num(v.o2)
      // No oxygen figure is not a reading. 0% is a readable number and a
      // catastrophic one; storing a partial row would invent a dead chamber.
      if (o2 === null || o2 < 0 || o2 > 100) continue

      const row = {
        chamber_id: c.id,
        at: latest.at,
        o2_pct: o2,
        temp_c: num(v.t),
        rh_pct: num(v.rh),
        valve1: flag(v.v1),
        valve2: flag(v.v2),
        blower_duty: num(v.blow) ?? 0,
        circulation_duty: num(v.circ) ?? 0,
        purging: flag(v.purge),
        maintenance: flag(v.maint),
        warn: flag(v.w),
        error: flag(v.e),
      }

      // The same latest value comes back every run until the device publishes
      // again; the unique (chamber_id, at) makes that a no-op rather than a
      // duplicate, which is what lets this stay dumb.
      const ins = await fetch(`${SB_URL}/rest/v1/hypoxia_readings?on_conflict=chamber_id,at`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(row),
      })
      if (ins.ok) summary.stored++

      await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen_at: latest.at, updated_at: new Date().toISOString() }),
      })

      summary.alerts += await evaluate(SB_URL, sb, c, row)
    } catch (e) {
      summary.errors.push(`${c.name}: ${e?.message ?? e}`)
    }
  }

  // A chamber we heard nothing from this run — including one whose device has
  // never reported at all.
  for (const c of chambers) {
    const last = c.last_seen_at ? Date.parse(c.last_seen_at) : NaN
    const silent = !Number.isFinite(last) || Date.now() - last > SILENT_AFTER_MIN * 60_000
    if (!silent) continue
    summary.alerts += await raise(SB_URL, sb, {
      type: 'hypoxia_silent',
      severity: 'critical',
      title: `${c.name} has gone quiet`,
      body: c.last_seen_at
        ? `No telemetry since ${c.last_seen_at}. A sealed chamber that is not reporting cannot be checked from here.`
        : 'This chamber has never reported. Check the bridge is powered and on Wi-Fi.',
      dedupKey: `hypoxia_silent:${c.id}`,
      url: '/incubation/hypoxia',
    })
  }

  console.log('[poll-hypoxia]', JSON.stringify(summary))
  return new Response(JSON.stringify(summary), {
    status: summary.errors.length ? 207 : 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Alerts for one fresh reading. Returns how many were raised. */
async function evaluate(SB_URL, sb, chamber, row) {
  let raised = 0

  if (row.error) {
    raised += await raise(SB_URL, sb, {
      type: 'hypoxia_fault',
      severity: 'critical',
      title: `${chamber.name} is reporting a fault`,
      body: `The controller raised its error flag. Oxygen last read ${row.o2_pct}%. Its reading cannot be trusted until this clears.`,
      dedupKey: `hypoxia_fault:${chamber.id}`,
      url: '/incubation/hypoxia',
    })
  }

  /*
   * Purging leaves the band on purpose and maintenance means somebody is
   * standing there doing it. Alerting on either would be alerting on the
   * mechanism working, which is how people learn to ignore alerts.
   */
  if (row.purging || row.maintenance) return raised

  const sp = Number(chamber.setpoint_pct ?? 10)
  const db = Number(chamber.deadband_pct ?? 1)
  const high = row.o2_pct > sp + db
  const low = row.o2_pct < sp - db
  if (high || low) {
    raised += await raise(SB_URL, sb, {
      type: 'hypoxia_out_of_band',
      severity: 'warning',
      title: `${chamber.name} is ${high ? 'above' : 'below'} target`,
      body: `Oxygen ${row.o2_pct}% against a target of ${sp}% ± ${db}%.${
        high ? ' The chamber is not holding its atmosphere.' : ' Lower than intended — check the nitrogen supply and the valves.'
      }`,
      dedupKey: `hypoxia_out_of_band:${chamber.id}`,
      url: '/incubation/hypoxia',
    })
  }
  return raised
}

/**
 * Write the alert and push it.
 *
 * `dedupKey` leans on the unique index in 0006: one active unread alert per
 * key, so a chamber that stays out of band raises this once rather than every
 * five minutes until somebody stops reading them.
 */
async function raise(SB_URL, sb, { type, severity, title, body, dedupKey, url }) {
  try {
    await writeInAppNotification(SB_URL, sb, {
      category: 'incubation',
      type,
      severity,
      title,
      body,
      source: 'hypoxia_poller',
      dedupKey,
    })
    const optIns = await pushOptIns(SB_URL, sb, type)
    if (optIns.size) {
      const subs = await subscriptionsFor(SB_URL, sb, optIns)
      await sendToAll(SB_URL, sb, subs, { title, body, url, tag: dedupKey })
    }
    return 1
  } catch {
    // An alert that could not be raised must not stop the poll — the reading is
    // already stored, which is the part that cannot be recovered later.
    return 0
  }
}
