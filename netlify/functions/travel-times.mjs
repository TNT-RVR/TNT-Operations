/**
 * Fill the cost estimator's travel cache from OpenRouteService.
 *
 * ── What this restores ───────────────────────────────────────────────────────
 *
 * Spec §8.2 prices the paid round trip and most of the fuel off each field's
 * road distance from the depot. `fieldCost` has always read those two numbers
 * and nothing has ever written them — the old app's "update travel times"
 * button was never ported — so 12 of 15 real fields carried zero and costed a
 * few hundred dollars light apiece.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 *
 *   POST /.netlify/functions/travel-times
 *   Authorization: Bearer <the caller's supabase access token>
 *
 * Deliberately NOT scheduled and deliberately a door of its own. Road distance
 * between two fixed points does not change on a timer; it changes when someone
 * moves a parking pin or the depot, which is a person doing a thing. It is
 * gated on a signed-in editor rather than a shared token because it both spends
 * quota and rewrites cost inputs.
 *
 * ONE request for the whole season: ORS's matrix endpoint takes home as the
 * single source and every field as destinations, so a refresh is one call
 * rather than fifteen. That matters on a free tier.
 *
 * Env: ORS_API_KEY (openrouteservice.org, free tier — no billing to enable),
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE.
 */
/*
 * The geometry helpers are repeated here rather than imported from
 * src/domain/travelTimes.ts. Netlify bundles functions separately and nothing
 * else in this directory reaches into src — the same reason push.mjs carries
 * its own copy of the badge cap. `travelTimesParity.test.ts` runs BOTH
 * implementations over the same inputs and fails if they ever disagree, so this
 * is a duplicate that cannot drift.
 */

/** `[lat, lon]` from whatever the field JSON holds, or null. */
function pair(a, b) {
  const lat = blank(a)
  const lon = blank(b)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return [lat, lon]
}

/** A number from a field-JSON string, or NaN when it was never filled in. */
function blank(v) {
  if (v === null || v === undefined) return NaN
  if (typeof v === 'string' && v.trim() === '') return NaN
  return Number(v)
}

/** Where to route to: the parking pin, else the pivot. */
export function fieldLocation(field) {
  const name = String(field.name ?? '')
  const p = Array.isArray(field.parking_pin) ? pair(field.parking_pin[0], field.parking_pin[1]) : null
  if (p) return { id: field.id, name, at: p, source: 'parking' }
  const pivot = pair(field.PP_Latitude, field.PP_Longitude)
  if (pivot) return { id: field.id, name, at: pivot, source: 'pivot' }
  return null
}

/** ORS wants [lon, lat]. Backwards routes every field into the sea. */
export const toOrsCoord = ([lat, lon]) => [lon, lat]

/** One matrix row into km and minutes; nulls and zeros are left out. */
export function readMatrix(response, destinations) {
  const dist = response?.distances?.[0] ?? []
  const dur = response?.durations?.[0] ?? []
  const results = []
  const unroutable = []
  destinations.forEach((d, i) => {
    const km = dist[i]
    const seconds = dur[i]
    if (!Number.isFinite(km) || !Number.isFinite(seconds) || km <= 0 || seconds <= 0) {
      unroutable.push(d.name || d.id)
      return
    }
    results.push({
      id: d.id,
      name: d.name,
      source: d.source,
      km: Math.round(km * 1000) / 1000,
      min: Math.round((seconds / 60) * 10) / 10,
    })
  })
  return { results, unroutable }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** ORS caps a matrix request; well above 15 fields, but not unlimited. */
const MAX_DESTINATIONS = 50

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const ORS = process.env.ORS_API_KEY
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)
  if (!ORS) {
    return json(
      { error: 'ORS_API_KEY not set — add it in Netlify env to enable travel times.' },
      501,
    )
  }

  // ── Who is asking ──
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first' }, 401)
  const me = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${jwt}` },
  }).then((r) => (r.ok ? r.json() : null))
  if (!me?.id) return json({ error: 'Sign in first' }, 401)

  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  const role = await fetch(`${SB_URL}/rest/v1/profiles?select=role&id=eq.${me.id}`, { headers: sb })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0]?.role)
  if (!['admin', 'developer', 'operator'].includes(role)) {
    return json({ error: 'You do not have permission to update travel times.' }, 403)
  }

  // ── Where is home ──
  const prefs = await fetch(`${SB_URL}/rest/v1/cost_prefs?select=data&limit=1`, { headers: sb })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => rows?.[0]?.data ?? {})
  const homeLat = Number(prefs.home_lat)
  const homeLon = Number(prefs.home_lon)
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon) || (homeLat === 0 && homeLon === 0)) {
    return json({ error: 'No depot pin set — drop the home pin on the Costs screen first.' }, 400)
  }

  // ── Which fields ──
  let only = null
  try {
    const body = await req.json()
    if (Array.isArray(body?.fieldIds) && body.fieldIds.length) only = new Set(body.fieldIds)
  } catch {
    /* no body: do them all */
  }

  const rows = await fetch(`${SB_URL}/rest/v1/shelter_fields?select=id,name,data`, { headers: sb })
    .then((r) => (r.ok ? r.json() : []))
  if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'No fields to route to.' }, 400)

  const located = []
  const noLocation = []
  for (const row of rows) {
    if (only && !only.has(row.id)) continue
    const loc = fieldLocation({ id: row.id, name: row.name, ...(row.data ?? {}) })
    if (loc) located.push({ loc, row })
    else noLocation.push(row.name)
  }
  if (!located.length) {
    return json({ error: 'No field has a parking pin or a pivot to route to.', noLocation }, 400)
  }
  if (located.length > MAX_DESTINATIONS) {
    return json({ error: `Too many fields at once (${located.length} > ${MAX_DESTINATIONS}).` }, 400)
  }

  // ── One matrix call: home → every field ──
  const destinations = located.map((l) => l.loc)
  const res = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: { Authorization: ORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [[homeLon, homeLat], ...destinations.map((d) => toOrsCoord(d.at))],
      sources: [0],
      destinations: destinations.map((_, i) => i + 1),
      metrics: ['distance', 'duration'],
      units: 'km',
    }),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400)
    console.error('[travel-times] ORS', res.status, detail)
    // 403 from ORS is a bad or exhausted key — the same class of problem as an
    // expired Anthropic key, and worth saying plainly rather than as "502".
    const hint =
      res.status === 403 || res.status === 401
        ? 'OpenRouteService rejected the key. Check ORS_API_KEY, or the free-tier quota for today.'
        : `OpenRouteService returned ${res.status}.`
    return json({ error: hint, detail }, 502)
  }

  const { results, unroutable } = readMatrix(await res.json(), destinations)

  // ── Write the cache back, one field at a time ──
  const byId = new Map(located.map((l) => [l.loc.id, l.row]))
  let written = 0
  for (const r of results) {
    const row = byId.get(r.id)
    if (!row) continue
    const data = {
      ...(row.data ?? {}),
      home_to_parking_km: r.km,
      home_to_parking_min: r.min,
      // Stamped so the Costs screen can say how old these are, and which pin
      // they were measured from.
      travel_updated_at: new Date().toISOString(),
      travel_from: r.source,
    }
    const put = await fetch(`${SB_URL}/rest/v1/shelter_fields?id=eq.${r.id}`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ data }),
    })
    if (put.ok) written++
    else console.warn('[travel-times] write failed for', r.name, await put.text())
  }

  const summary = {
    written,
    usedPivot: results.filter((r) => r.source === 'pivot').map((r) => r.name),
    unroutable,
    noLocation,
  }
  console.log('[travel-times]', JSON.stringify(summary))
  return json(summary)
}
