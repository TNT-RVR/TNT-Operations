/**
 * The chamber's one call. Telemetry in, next command out.
 *
 *   POST /.netlify/functions/hypoxia-ingest
 *   X-Device-Key: <the chamber's key>
 *   {"pod":1,"o2":10.4,"t":4.2,"rh":38,"v1":0,...}   ← the Nano's line, verbatim
 *
 *   → 200 {"cmd":"PURGE"}   or   200 {}
 *
 * ── Why one round trip ──────────────────────────────────────────────────────
 *
 * With no broker there is nothing to push to a device, so the device collects.
 * Answering its telemetry POST with the next queued command means no MQTT, no
 * persistent connection, no second endpoint to poll, and no inbound port on a
 * box sitting in a shed. Latency is one publish cycle — about 15 seconds, which
 * is nothing for "purge" or "set target".
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 *
 * A per-chamber key in a header. The database stores only its SHA-256, so a
 * backup or a leaked query cannot be replayed against a chamber — the failure
 * the student's hardcoded ThingsBoard token had. Compared in constant time,
 * because a timing oracle on a device key is a real if unglamorous way in.
 *
 * This is the ONE function with no Supabase session: the caller is a
 * microcontroller, not a person.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { pushOptIns, subscriptionsFor, sendToAll, writeInAppNotification } from './lib/push.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Constant-time compare of two hex digests. */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const flag = (v) => num(v) === 1

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) return json({ error: 'not configured' }, 500)
  const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` }

  const presented = (req.headers.get('x-device-key') ?? '').trim()
  if (!presented) return json({ error: 'no key' }, 401)
  const digest = sha256(presented)

  /*
   * Look the chamber up BY the hash. Fetching candidates and comparing in the
   * function would mean sending every chamber's hash over the wire on every
   * telemetry post from every device.
   */
  const chamber = await fetch(
    `${SB_URL}/rest/v1/hypoxia_chambers?select=id,name,active,setpoint_pct,deadband_pct,device_key_hash&device_key_hash=eq.${digest}`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0])

  // The equality above already matched, so this is belt and braces against a
  // future change that loosens the query into something like a prefix match.
  if (!chamber || !sameDigest(chamber.device_key_hash, digest)) return json({ error: 'unknown key' }, 401)
  if (!chamber.active) return json({ error: 'chamber is not active' }, 403)

  let line
  try {
    line = await req.json()
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }

  const o2 = num(line?.o2)
  const at = new Date().toISOString()

  /*
   * No oxygen figure is a heartbeat, not a reading. It still counts as the
   * chamber being alive — so `last_seen_at` moves and the silence alert stays
   * quiet — but nothing is stored, because 0% is a readable number and a
   * catastrophic one.
   */
  if (o2 !== null && o2 >= 0 && o2 <= 100) {
    const row = {
      chamber_id: chamber.id,
      at,
      o2_pct: o2,
      temp_c: num(line.t),
      rh_pct: num(line.rh),
      valve1: flag(line.v1),
      valve2: flag(line.v2),
      blower_duty: num(line.blow) ?? 0,
      circulation_duty: num(line.circ) ?? 0,
      purging: flag(line.purge),
      maintenance: flag(line.maint),
      warn: flag(line.w),
      error: flag(line.e),
    }
    await fetch(`${SB_URL}/rest/v1/hypoxia_readings`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    })
    // Alerts are evaluated here now. There is no poller in this design — the
    // device's own post IS the tick.
    await evaluate(SB_URL, sb, chamber, row)
  }

  await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${chamber.id}`, {
    method: 'PATCH',
    headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ last_seen_at: at }),
  })

  // ── The next command, if there is one ──
  const pending = await fetch(
    `${SB_URL}/rest/v1/hypoxia_commands?select=id,wire&chamber_id=eq.${chamber.id}&delivered_at=is.null&order=sent_at.asc&limit=1`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0])

  if (!pending) return json({})

  /*
   * Stamped BEFORE it is handed over, so a crash between the two leaves the
   * command undelivered-looking rather than delivered-twice. For PURGE or
   * SERVO=OPEN, at-most-once is the safe direction to fail in.
   */
  const marked = await fetch(`${SB_URL}/rest/v1/hypoxia_commands?id=eq.${pending.id}`, {
    method: 'PATCH',
    headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ delivered_at: new Date().toISOString() }),
  })
  if (!marked.ok) return json({})

  return json({ cmd: pending.wire })
}

/** Fault and out-of-band alerts. Mirrors what the ThingsBoard poller did. */
async function evaluate(SB_URL, sb, chamber, row) {
  if (row.error) {
    await raise(SB_URL, sb, {
      type: 'hypoxia_fault',
      severity: 'critical',
      title: `${chamber.name} is reporting a fault`,
      body: `The controller raised its error flag. Oxygen last read ${row.o2_pct}%. Its reading cannot be trusted until this clears.`,
      dedupKey: `hypoxia_fault:${chamber.id}`,
    })
  }

  // Purging leaves the band on purpose and maintenance means somebody is
  // standing there doing it. Alerting on either trains people to ignore alerts.
  if (row.purging || row.maintenance) return

  const sp = Number(chamber.setpoint_pct ?? 10)
  const db = Number(chamber.deadband_pct ?? 1)
  const high = row.o2_pct > sp + db
  const low = row.o2_pct < sp - db
  if (!high && !low) return

  await raise(SB_URL, sb, {
    type: 'hypoxia_out_of_band',
    severity: 'warning',
    title: `${chamber.name} is ${high ? 'above' : 'below'} target`,
    body: `Oxygen ${row.o2_pct}% against a target of ${sp}% ± ${db}%.${
      high ? ' The chamber is not holding its atmosphere.' : ' Lower than intended — check the nitrogen supply and the valves.'
    }`,
    dedupKey: `hypoxia_out_of_band:${chamber.id}`,
  })
}

async function raise(SB_URL, sb, { type, severity, title, body, dedupKey }) {
  try {
    await writeInAppNotification(SB_URL, sb, {
      category: 'incubation',
      type,
      severity,
      title,
      body,
      source: 'hypoxia_ingest',
      dedupKey,
    })
    const optIns = await pushOptIns(SB_URL, sb, type)
    if (!optIns.size) return
    const subs = await subscriptionsFor(SB_URL, sb, optIns)
    await sendToAll(SB_URL, sb, subs, { title, body, url: '/incubation/hypoxia', tag: dedupKey })
  } catch {
    // A chamber's reading is already stored, which is the part that cannot be
    // recovered. Failing to raise the alert must not fail the device's post —
    // the firmware would retry the whole line.
  }
}
