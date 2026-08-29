/**
 * Send one command to a hypoxia chamber.
 *
 *   POST /.netlify/functions/hypoxia-command
 *   Authorization: Bearer <the caller's supabase access token>
 *   { "chamberId": "…", "wire": "PURGE" }
 *
 * Deliberately its own door and deliberately NOT scheduled: this is a person
 * pressing a button, and Netlify refuses direct invocation of any function that
 * declares a schedule.
 *
 * ── Why the whitelist is here and not only in the UI ────────────────────────
 *
 * These commands move things in a sealed chamber full of live bees — a valve
 * opened, the blast door opened, the control loop switched off — and nothing in
 * the firmware closes them again. A disabled button is a UI state; this is the
 * thing that actually decides. The vocabulary below mirrors
 * `src/domain/hypoxia.ts`, and `hypoxiaCommandParity.test.ts` fails if the two
 * ever drift.
 *
 * Every attempt is written to `hypoxia_commands`, including refused ones — "who
 * opened that valve, and when" is a question that will be asked, and a refusal
 * is also an answer.
 *
 * Env: TB_USERNAME / TB_PASSWORD (+ optional TB_BASE_URL), SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE.
 */
import { tbConfigured, tbSendCommand } from './lib/thingsboard.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Fixed commands and what each one costs. Mirrors src/domain/hypoxia.ts. */
const FIXED = {
  'RUN=ON': 'routine',
  'RUN=OFF': 'routine',
  PURGE: 'routine',
  'MAINT=ON': 'manual',
  'MAINT=OFF': 'routine',
  'V1=ON': 'manual',
  'V1=OFF': 'manual',
  'V2=ON': 'manual',
  'V2=OFF': 'manual',
  'SERVO=OPEN': 'manual',
  'SERVO=CLOSE': 'manual',
  'CAL=AIR': 'calibration',
  'CAL=CHAMBER': 'calibration',
  'CAL=ABORT': 'routine',
}

/** Setpoint bounds, in TENTHS as the firmware parses them. See toTenths(). */
const SP_MIN_TENTHS = 10 // 1.0%
const SP_MAX_TENTHS = 210 // 21.0%
const DB_MAX_TENTHS = 50 // 5.0%

/**
 * Classify a command, or refuse it.
 *
 * The parameterised ones are matched on shape rather than listed, because the
 * number is the point. `SP=` is the dangerous one: the firmware reads TENTHS,
 * so `SP=10` is 1.0% oxygen — an atmosphere that holds nothing alive — and it
 * would be accepted without complaint.
 */
function classify(wire) {
  const w = String(wire ?? '').trim().toUpperCase()
  if (!w) return { error: 'No command given.' }
  if (FIXED[w]) return { wire: w, risk: FIXED[w] }

  const sp = /^SP=(\d{1,4})$/.exec(w)
  if (sp) {
    const t = Number(sp[1])
    if (t < SP_MIN_TENTHS || t > SP_MAX_TENTHS) {
      return { error: `Setpoint out of range. ${t} tenths is ${t / 10}% oxygen; allowed is 1%–21%.` }
    }
    return { wire: w, risk: 'setpoint' }
  }

  const db = /^DB=(\d{1,4})$/.exec(w)
  if (db) {
    const t = Number(db[1])
    if (t < 1 || t > DB_MAX_TENTHS) return { error: `Deadband out of range. Allowed is 0.1%–5%.` }
    return { wire: w, risk: 'setpoint' }
  }

  const duty = /^(CIRC|BLOW)=(\d{1,3})$/.exec(w)
  if (duty) {
    const d = Number(duty[2])
    if (d > 255) return { error: `${duty[1]} duty is 0–255.` }
    return { wire: w, risk: 'manual' }
  }

  return { error: `Unknown command "${w}".` }
}

/**
 * Who may send what.
 *
 * Anything that bypasses the control loop, or takes the sensor out of service,
 * is admin/developer only. A crew tablet can purge and can start or stop
 * regulation — the everyday verbs — but cannot leave a valve open.
 */
const ELEVATED = new Set(['manual', 'calibration'])
const CAN_ROUTINE = new Set(['admin', 'developer', 'operator'])
const CAN_ELEVATED = new Set(['admin', 'developer'])

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)
  if (!tbConfigured()) {
    return json({ error: 'ThingsBoard is not configured — set TB_USERNAME and TB_PASSWORD in Netlify.' }, 501)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const chamberId = String(body?.chamberId ?? '')
  if (!chamberId) return json({ error: 'chamberId is required' }, 400)

  const verdict = classify(body?.wire)
  if (verdict.error) return json({ error: verdict.error }, 400)

  // ── Who is asking ──
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

  const elevated = ELEVATED.has(verdict.risk)
  const allowed = elevated ? CAN_ELEVATED.has(role) : CAN_ROUTINE.has(role)

  const chamber = await fetch(
    `${SB_URL}/rest/v1/hypoxia_chambers?select=id,name,tb_device_id&id=eq.${chamberId}`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0])

  /** Record the attempt, whatever happened to it. */
  const audit = async (ok, error) => {
    await fetch(`${SB_URL}/rest/v1/hypoxia_commands`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        chamber_id: chamberId,
        wire: verdict.wire,
        risk: verdict.risk,
        sent_by: me.id,
        ok,
        error: error ?? null,
      }),
    }).catch(() => {})
  }

  if (!chamber) {
    return json({ error: 'No such chamber.' }, 404)
  }
  if (!allowed) {
    const why = elevated
      ? 'That command bypasses the chamber’s own control, so it is limited to admins.'
      : 'You do not have permission to command chambers.'
    await audit(false, why)
    return json({ error: why }, 403)
  }
  if (!chamber.tb_device_id) {
    const why = 'This chamber has no ThingsBoard device linked, so there is nothing to send to.'
    await audit(false, why)
    return json({ error: why }, 400)
  }

  const res = await tbSendCommand(chamber.tb_device_id, verdict.wire)
  await audit(res.ok, res.ok ? null : res.error)
  if (!res.ok) return json({ error: res.error }, 502)

  /*
   * The setpoint the app believes, updated only after the command actually
   * went. It is a record of what was SENT — the firmware holds the real value,
   * and the reading is what the screen should trust.
   */
  const sp = /^SP=(\d+)$/.exec(verdict.wire)
  const db = /^DB=(\d+)$/.exec(verdict.wire)
  if (sp || db) {
    await fetch(`${SB_URL}/rest/v1/hypoxia_chambers?id=eq.${chamberId}`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(
        sp ? { setpoint_pct: Number(sp[1]) / 10 } : { deadband_pct: Number(db[1]) / 10 },
      ),
    })
  }

  return json({ ok: true, wire: verdict.wire, risk: verdict.risk, note: res.note })
}
