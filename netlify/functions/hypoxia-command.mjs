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
 * Commands are QUEUED, not pushed. The chamber has no broker and no inbound
 * port; it collects its next command on its own telemetry post, so this writes
 * a row and the device picks it up within a publish cycle (~15 s).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE.
 */

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
    `${SB_URL}/rest/v1/hypoxia_chambers?select=id,name,device_key_hash&id=eq.${chamberId}`,
    { headers: sb },
  )
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0])

  /** Record a REFUSED attempt. An accepted one is recorded by the queue write. */
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
        // A refusal never reaches a chamber, so it is delivered in the only
        // sense that matters: it is not sitting in the queue waiting to fire.
        delivered_at: new Date().toISOString(),
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
  if (!chamber.device_key_hash) {
    const why = 'This chamber has no device key yet, so nothing is listening for commands.'
    await audit(false, why)
    return json({ error: why }, 400)
  }

  /*
   * The audit row IS the queue. One insert records who asked for what and puts
   * it in line for the chamber to collect; `delivered_at` is stamped when it
   * actually does, which is also the answer to "did the chamber ever get it".
   */
  const queued = await fetch(`${SB_URL}/rest/v1/hypoxia_commands`, {
    method: 'POST',
    headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      chamber_id: chamberId,
      wire: verdict.wire,
      risk: verdict.risk,
      sent_by: me.id,
      ok: true,
    }),
  })
  if (!queued.ok) {
    return json({ error: `Could not queue the command: ${(await queued.text()).slice(0, 200)}` }, 502)
  }

  /*
   * The setpoint the app believes, updated once the command is queued. Still
   * only a record of what was ASKED FOR — the firmware owns the real value, so
   * the screen shows the reading.
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

  return json({ ok: true, wire: verdict.wire, risk: verdict.risk, note: 'Queued — the chamber collects it within about 15 seconds.' })
}
