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

/**
 * Set ONE property, explicitly.
 *
 * Sensibo transmits infrared only when the state it holds actually changes. A
 * full-state POST that matches what it already believes is accepted, answered
 * 200, and sends nothing — which is why turning an incubator ON always worked
 * (off → on is always a change) while OFF did nothing whenever its records had
 * drifted from the unit in the room.
 *
 * The single-property endpoint states the intent instead of implying it from a
 * diff, so a power command is a power command.
 */
async function setProperty(apiKey, deviceId, property, newValue) {
  const res = await withTimeout(
    `${SENSIBO}/pods/${encodeURIComponent(deviceId)}/acStates/${property}` +
      `?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newValue, reason: 'UserRequest' }),
    },
  )
  return readOutcome(res)
}

/**
 * What Sensibo actually said.
 *
 * HTTP 200 from this API means the request was well formed — NOT that the
 * command was carried out. A declined command comes back 200 with
 * `{"status":"failure"}` and a reason in the body, and reading only the status
 * line turns that into a success on screen while the heat pump keeps running.
 *
 * That is exactly the shape of the bug this chases: our ON changed state in
 * the Sensibo app, our OFF changed nothing there at all, and our code called
 * both fine.
 */
async function readOutcome(res) {
  const text = await res.text().catch(() => '')
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON — the raw text is the best evidence available */
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` }

  const status = body?.status
  if (status && String(status).toLowerCase() !== 'success') {
    const reason =
      body?.failureReason ??
      body?.reason ??
      body?.result?.failureReason ??
      JSON.stringify(body).slice(0, 300)
    return { ok: false, error: `Sensibo declined it (${status}): ${reason}` }
  }
  return { ok: true, body }
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


/**
 * Remembered state, so the buttons show what someone last SET.
 *
 * These pumps don't report an acState back, so without this the UI resets to
 * "off / auto" on every load no matter what was done to them. Stored server
 * side in the existing `settings` table rather than in a browser, because the
 * question is "what did anyone last set this to", not "what did I set it to on
 * this phone".
 *
 * It is a memory of a command, NOT a reading — the pump could have been
 * changed at the wall. Responses mark it `remembered: true` so the UI can say
 * so rather than presenting it as truth.
 */
const memoryKey = (deviceId) => `sensibo_last_state_${deviceId}`

async function readMemory(deviceId) {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return null
  try {
    const rows = await fetch(
      `${SB_URL}/rest/v1/settings?key=eq.${encodeURIComponent(memoryKey(deviceId))}&select=value`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
    ).then((r) => (r.ok ? r.json() : null))
    const raw = Array.isArray(rows) ? rows[0]?.value : null
    return raw ? JSON.parse(raw) : null
  } catch {
    // A missing memory is normal and must never break reading the AC.
    return null
  }
}

async function writeMemory(deviceId, state) {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return
  try {
    await fetch(`${SB_URL}/rest/v1/settings?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: memoryKey(deviceId), value: JSON.stringify(state) }),
    })
  } catch (e) {
    // Failing to remember is not a reason to fail the command that worked.
    console.warn(`[sensibo] could not remember ${deviceId}:`, e?.message ?? e)
  }
}

export default async (req) => {
  const apiKey = process.env.SENSIBO_API_KEY
  if (!apiKey) {
    // Say WHICH kind of missing. A variable added in Netlify only reaches a
    // function on the NEXT deploy, and can also be scoped to builds only or to
    // a different deploy context — three different fixes that look identical
    // from here. Whether the function can see OTHER server-side variables
    // separates "env not applied yet" from "this one is wrong".
    const otherEnvVisible = !!(process.env.SUPABASE_SERVICE_ROLE || process.env.GOVEE_API_KEY)
    return json(
      {
        error: otherEnvVisible
          ? 'SENSIBO_API_KEY is missing, though other server keys are visible — check the name is exactly SENSIBO_API_KEY, and that its scope includes Functions and the Production context.'
          : 'No server keys are visible to this function at all, which usually means the site has not been redeployed since they were added. Trigger a deploy in Netlify.',
      },
      500,
    )
  }

  const who = await identify(req)
  if (who.error) return who.error

  // ── Read ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ids = parseIds(new URL(req.url).searchParams.get('deviceIds'))
    if (!ids.length) return json({ error: 'No device ids given' }, 400)
    const devices = await Promise.all(
      ids.map(async (id) => {
        const live = await getState(apiKey, id)
        if (live.state) return live
        const remembered = await readMemory(id)
        return remembered ? { ...live, state: remembered, remembered: true } : live
      }),
    )
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
      // Build on what was last SET when the unit reports nothing, so changing
      // the fan doesn't silently reset a target someone dialled in earlier.
      const base = current.state ?? (await readMemory(deviceId)) ?? {
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

      /**
       * Power is sent on its own, the way the Sensibo app sends it.
       *
       * Posting a whole acState asks Sensibo to work out the intent from a
       * diff against what it believes. That is why ON worked and OFF did not:
       * ON is always a change from a stale "off" record, while OFF against
       * that same record is no change at all — accepted, answered 200, and
       * never transmitted. Nothing even appeared in the Sensibo app.
       *
       * The property endpoint states the intent, so a power press is a power
       * press regardless of what Sensibo currently believes.
       */
      if (on !== undefined) {
        const power = await setProperty(apiKey, deviceId, 'on', !!on)
        if (!power.ok) return { deviceId, ok: false, error: power.error }
      }

      // Everything else still goes as a state, and only when something in it
      // actually changed — a power press must not resend a mode or a target.
      const otherChanged =
        mode !== undefined || targetTemperature !== undefined || fanLevel !== undefined
      if (otherChanged) {
        const res = await withTimeout(
          `${SENSIBO}/pods/${encodeURIComponent(deviceId)}/acStates?apiKey=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acState: next }),
          },
        )
        // A unit refusing a fan level or mode it doesn't support is normal and
        // model-specific; report it rather than pretending it worked.
        const outcome = await readOutcome(res)
        if (!outcome.ok) return { deviceId, ok: false, error: outcome.error }
      }

      // ── Did it take? ─────────────────────────────────────────────────────
      // Read back rather than trust the acknowledgement. This confirms what
      // Sensibo holds for the pod, which is not the same as measuring the AC —
      // a unit switched at the wall can still disagree with both.
      let verified = null
      if (on !== undefined) {
        const confirm = await getState(apiKey, deviceId)
        // Null when the pod reports nothing back: several of these do not, and
        // claiming failure there would be as wrong as claiming success.
        verified = confirm.state ? !!confirm.state.on === !!on : null
        if (verified === false) {
          console.warn(
            `[sensibo] ${deviceId}: asked for on=${!!on}, pod still reads on=${confirm.state?.on}`,
          )
        }
      }

      await writeMemory(deviceId, next)
      return { deviceId, ok: true, state: next, verified }
    }),
  )

  const failed = results.filter((r) => !r.ok)
  // Sent but demonstrably not taken: worth its own word, because "it worked"
  // followed by a still-running heat pump is how somebody cooks a batch.
  const unconfirmed = results.filter((r) => r.ok && r.verified === false)
  console.info(
    `[sensibo] ${who.userId} set ${JSON.stringify({ on, targetTemperature, mode, fanLevel })} ` +
      `on ${ids.join(',')} — ${results.length - failed.length} ok, ${failed.length} failed`,
  )
  // Partial success is reported as such: with several units on one incubator,
  // "some worked" is the truth and hiding it would leave them disagreeing.
  return json(
    {
      results,
      ok: failed.length === 0,
      // The UI turns this into a warning. Note what it does NOT prove: this is
      // Sensibo's own record of the pod, not a measurement of the AC. A unit
      // switched at the wall can still disagree with both.
      unconfirmed: unconfirmed.map((r) => r.deviceId),
    },
    failed.length && !results.some((r) => r.ok) ? 502 : 200,
  )
}
