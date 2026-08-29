/**
 * ThingsBoard REST — the only place that knows how to reach the chambers.
 *
 * The hypoxia chambers publish to ThingsBoard over MQTT and take commands back
 * from it as RPC. TNT does not replace that (no firmware change, nothing
 * reflashed); it reads through it and sends through it.
 *
 * Two calls matter:
 *   GET  /api/plugins/telemetry/DEVICE/{id}/values/timeseries  — latest values
 *   POST /api/rpc/oneway/{id}                                  — send a command
 *
 * Env:
 *   TB_BASE_URL   defaults to https://thingsboard.cloud
 *   TB_USERNAME   a ThingsBoard user with access to the devices
 *   TB_PASSWORD
 *
 * NOTE the device ACCESS TOKEN is a different thing and does not belong here —
 * that is the credential the firmware itself uses to publish, and it should
 * never leave the device or the ThingsBoard console. One arrived hardcoded in
 * the student's `TNT_ESP32C3_CODE.ino`; it wants rotating, not copying.
 */

const DEFAULT_BASE = 'https://thingsboard.cloud'

/**
 * Cached JWT.
 *
 * ThingsBoard tokens are short-lived and a Netlify function may serve several
 * invocations from one warm container, so logging in per call would be a login
 * per chamber per poll. Cached with a margin rather than to the second, because
 * a token that expires mid-request fails the request.
 */
let cached = { token: null, expiresAt: 0 }
const EXPIRY_MARGIN_MS = 60_000

export function tbConfigured() {
  return Boolean(process.env.TB_USERNAME && process.env.TB_PASSWORD)
}

export function tbBase() {
  return (process.env.TB_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

/** Log in, or reuse a token that is still comfortably valid. */
export async function tbToken() {
  const now = Date.now()
  if (cached.token && now < cached.expiresAt - EXPIRY_MARGIN_MS) return cached.token

  const res = await fetch(`${tbBase()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.TB_USERNAME,
      password: process.env.TB_PASSWORD,
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`ThingsBoard login failed (${res.status}): ${detail}`)
  }
  const body = await res.json()
  if (!body?.token) throw new Error('ThingsBoard login returned no token')

  cached = { token: body.token, expiresAt: now + readExpiry(body.token) }
  return cached.token
}

/**
 * When this JWT expires, from its own payload.
 *
 * Read rather than assumed: ThingsBoard's token lifetime is a server setting,
 * and guessing it short means logging in constantly while guessing it long
 * means every call after expiry fails. Falls back to a conservative ten minutes
 * if the token is not the shape expected.
 */
function readExpiry(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'))
    if (payload?.exp) return payload.exp * 1000 - Date.now()
  } catch {
    /* not a JWT we can read — fall through */
  }
  return 10 * 60_000
}

async function tbFetch(path, init = {}) {
  const token = await tbToken()
  return fetch(`${tbBase()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'X-Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
}

/**
 * Latest telemetry for one device.
 *
 * ThingsBoard answers `{ key: [{ ts, value }] }` — every value a STRING, even
 * the numbers, and every key its own array because the shape is built for
 * ranges. Flattened here into one object plus the newest timestamp across the
 * keys, which is what "when was this chamber last heard from" means.
 *
 * Returns null when the device has never reported, which is different from a
 * device reporting zeroes.
 */
export async function tbLatestTelemetry(deviceId, keys) {
  const q = encodeURIComponent(keys.join(','))
  const res = await tbFetch(`/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=${q}`)
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`ThingsBoard telemetry ${res.status}: ${detail}`)
  }
  const body = await res.json()
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) return null

  const values = {}
  let newestTs = 0
  for (const [key, series] of Object.entries(body)) {
    const point = Array.isArray(series) ? series[0] : null
    if (!point) continue
    values[key] = point.value
    if (typeof point.ts === 'number' && point.ts > newestTs) newestTs = point.ts
  }
  if (!newestTs) return null
  return { values, at: new Date(newestTs).toISOString() }
}

/**
 * Send a command.
 *
 * One-way RPC: the device acts, and does not answer. That is the right shape
 * here — the answer to "did the purge happen" is the next telemetry line
 * showing `purge:1`, not an HTTP response, and a two-way call would block this
 * function on a chamber that may be mid-cycle.
 *
 * The `{method, params}` wrapper matches what the ESP32 unwraps: it accepts
 * either a bare method or `{"method":"cmd","params":"PURGE"}`.
 */
export async function tbSendCommand(deviceId, wire) {
  const res = await tbFetch(`/api/rpc/oneway/${deviceId}`, {
    method: 'POST',
    body: JSON.stringify({ method: 'cmd', params: wire }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    // 504 from ThingsBoard means the device did not acknowledge — for one-way
    // RPC that is expected rather than a failure, so it is not treated as one.
    if (res.status === 504) return { ok: true, note: 'sent; device did not acknowledge (one-way)' }
    return { ok: false, error: `ThingsBoard RPC ${res.status}: ${detail}` }
  }
  return { ok: true }
}
