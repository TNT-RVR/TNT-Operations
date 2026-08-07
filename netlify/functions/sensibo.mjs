/**
 * Sensibo AC control for the incubators.
 *
 * A proxy, for two reasons that both matter:
 *
 * 1. The Sensibo API key must never reach a browser. It controls the heat on
 *    every incubator, and a key in the bundle is a key anyone can read.
 * 2. The caller has to prove who they are. Turning a heat pump off is a
 *    physical act on live bees, so it is gated on the same edit rights as the
 *    rest of the incubation module — viewers and pending accounts can read the
 *    state and change nothing.
 *
 * MANUAL ONLY. This never acts on its own and is never called by a schedule:
 * it does what a person just pressed, mirroring the desktop app's deliberate
 * choice not to build a closed loop on top of one sensor.
 *
 *   GET  /.netlify/functions/sensibo?deviceIds=AAA,BBB
 *   POST /.netlify/functions/sensibo
 *        { "deviceIds": "AAA,BBB", "on": true, "targetTemperature": 86,
 *          "mode": "heat", "fanLevel": "auto" }
 *   Authorization: Bearer <the caller's supabase access token>
 *
 * Env (Netlify, server-side only):
 *   SENSIBO_API_KEY        — Sensibo app → account settings → API key
 *   SUPABASE_SERVICE_ROLE  — to read the caller's role
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 */

const SENSIBO = 'https://home.sensibo.com/api/v2'
const TIMEOUT_MS = 12_000

/** Roles allowed to change an AC. Reading is open to any signed-in user. */
const CAN_CONTROL = new Set(['admin', 'developer', 'operator'])

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const parseIds = (raw) =>
  String(raw ?? '')
    .replace(/[;\n]/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Fetch with a deadline — a hung AC call shouldn't hold the function open. */
async function withTimeout(url, init = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** Who is asking, and may they change anything? */
async function identify(req) {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return { error: json({ error: 'Not configured (Supabase)' }, 500) }

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: json({ error: 'Sign in first' }, 401) }

  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return { error: json({ error: 'Sign in first' }, 401) }

  const prof = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${me.id}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).then((r) => (r.ok ? r.json() : null))
  const role = Array.isArray(prof) ? prof[0]?.role : null
  return { userId: me.id, role, canControl: CAN_CONTROL.has(role) }
}

/** Most recent acState for one device. */
async function getState(apiKey, deviceId) {
  const res = await withTimeout(
    `${SENSIBO}/pods/${encodeURIComponent(deviceId)}/acStates?apiKey=${encodeURIComponent(apiKey)}&limit=1`,
  )
  if (!res.ok) return { deviceId, error: `HTTP ${res.status}` }
  const body = await res.json()
  const state = body?.result?.[0]?.acState ?? null
  return { deviceId, state }
}

export default async (req) => {
  const apiKey = process.env.SENSIBO_API_KEY
  if (!apiKey) return json({ error: 'Sensibo is not configured (SENSIBO_API_KEY)' }, 500)

  const who = await identify(req)
  if (who.error) return who.error

  // ── Read ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ids = parseIds(new URL(req.url).searchParams.get('deviceIds'))
    if (!ids.length) return json({ error: 'No device ids given' }, 400)
    const devices = await Promise.all(ids.map((id) => getState(apiKey, id)))
    return json({ devices, canControl: who.canControl })
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST only' }, 405)
  if (!who.canControl) {
    return json({ error: 'You do not have permission to change the incubator ACs.' }, 403)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Bad JSON' }, 400)
  }

  const ids = parseIds(body?.deviceIds)
  if (!ids.length) return json({ error: 'No device ids given' }, 400)

  const { on, targetTemperature, mode, fanLevel } = body ?? {}
  if (targetTemperature != null) {
    // The equipment's own range. Refuse rather than clamp: a silently altered
    // target leaves someone believing the incubator is somewhere it isn't.
    if (!Number.isInteger(targetTemperature) || targetTemperature < 62 || targetTemperature > 86) {
      return json({ error: 'Target must be a whole number between 62 and 86 °F' }, 400)
    }
  }

  // Read-modify-write per device: only the named fields change, so setting a
  // temperature can't turn a unit on and a power toggle can't reset a mode.
  const results = await Promise.all(
    ids.map(async (deviceId) => {
      const current = await getState(apiKey, deviceId)
      const base = current.state ?? {
        on: false,
        mode: mode ?? 'heat',
        targetTemperature: targetTemperature ?? 72,
        temperatureUnit: 'F',
      }
      const next = { ...base }
      if (on !== undefined) next.on = !!on
      if (mode !== undefined) next.mode = mode
      if (targetTemperature !== undefined) {
        next.targetTemperature = targetTemperature
        // Always send the unit with the number. Without it the AC may read the
        // value as Celsius, which is a 40-degree mistake.
        next.temperatureUnit = 'F'
      }
      if (fanLevel !== undefined) next.fanLevel = fanLevel

      const res = await withTimeout(
        `${SENSIBO}/pods/${encodeURIComponent(deviceId)}/acStates?apiKey=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acState: next }),
        },
      )
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // A unit refusing a fan level or mode it doesn't support is normal and
        // model-specific; report it rather than pretending it worked.
        return { deviceId, ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
      }
      return { deviceId, ok: true, state: next }
    }),
  )

  const failed = results.filter((r) => !r.ok)
  console.info(
    `[sensibo] ${who.userId} set ${JSON.stringify({ on, targetTemperature, mode, fanLevel })} ` +
      `on ${ids.join(',')} — ${results.length - failed.length} ok, ${failed.length} failed`,
  )
  // Partial success is reported as such: with several units on one incubator,
  // "some worked" is the truth and hiding it would leave them disagreeing.
  return json({ results, ok: failed.length === 0 }, failed.length && !results.some((r) => r.ok) ? 502 : 200)
}
