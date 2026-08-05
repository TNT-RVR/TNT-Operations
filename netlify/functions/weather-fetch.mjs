/**
 * Season weather fetcher + cache filler for the Analysis section.
 *
 * The browser posts the grid cells it needs; this fetches any that aren't in
 * `weather_cache` yet, writes them, and returns the daily blocks.
 *
 * Why it is server-side at all — the Open-Meteo archive API is free and needs
 * no key, so the Base44 app called it straight from the component. That meant:
 * every panel refetching the same field on every mount, every user paying the
 * latency again, and a public API taking ~157 requests per page view from each
 * browser. Weather for a finished season never changes, so it is fetched once
 * for everyone and kept.
 *
 * Server-side only — secrets live in Netlify env, never in the browser:
 *   SUPABASE_SERVICE_ROLE  — Supabase service_role key (full access; server only)
 *   SUPABASE_URL           — optional; falls back to VITE_SUPABASE_URL
 *
 * Uses global fetch + the PostgREST API — no dependencies.
 */

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'precipitation_sum',
  'wind_speed_10m_max',
].join(',')

/** Matches src/domain/weather.ts — Apr 1 to Sep 30. */
function seasonWindow(year) {
  return { start: `${year}-04-01`, end: `${year}-09-30` }
}

/**
 * Open-Meteo asks for courtesy on request volume, so cells go out in small
 * batches rather than 157 at once. A cold cache is a one-time cost.
 */
const BATCH = 8
const MAX_CELLS = 400

export default async (req) => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE

  if (!SB_URL || !SB_KEY) {
    return json({ error: 'weather-fetch: not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 500)
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let cells
  try {
    const body = await req.json()
    cells = Array.isArray(body?.cells) ? body.cells : null
  } catch {
    return json({ error: 'Body must be JSON: { cells: [{ key, lat, lng, year }] }' }, 400)
  }
  if (!cells?.length) return json({ cells: [] })

  // Guard against a client asking for the world in one call.
  if (cells.length > MAX_CELLS) cells = cells.slice(0, MAX_CELLS)

  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  const out = []

  try {
    for (let i = 0; i < cells.length; i += BATCH) {
      const batch = cells.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async (cell) => {
          const lat = Number(cell.lat)
          const lng = Number(cell.lng)
          const year = String(cell.year ?? '')
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || !/^\d{4}$/.test(year)) return null

          const latKey = Number(lat.toFixed(3))
          const lngKey = Number(lng.toFixed(3))
          const { start, end } = seasonWindow(year)

          const url =
            `${ARCHIVE}?latitude=${latKey}&longitude=${lngKey}` +
            `&start_date=${start}&end_date=${end}&daily=${DAILY_VARS}` +
            `&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`

          const res = await fetch(url)
          if (!res.ok) {
            console.error('[weather-fetch] open-meteo', res.status, await res.text())
            return null
          }
          const data = await res.json()
          if (!data?.daily?.time?.length) return null

          return {
            key: cell.key ?? `${latKey.toFixed(3)},${lngKey.toFixed(3)},${year}`,
            year,
            daily: data.daily,
            row: {
              lat_key: latKey,
              lng_key: lngKey,
              year,
              start_date: start,
              end_date: end,
              daily: data.daily,
            },
          }
        }),
      )

      const good = results.filter(Boolean)
      if (good.length === 0) continue

      // Write the cache before returning, so a user who navigates away still
      // leaves the cell warm for the next person.
      const write = await fetch(
        `${SB_URL}/rest/v1/weather_cache?on_conflict=lat_key,lng_key,year,start_date,end_date`,
        {
          method: 'POST',
          headers: {
            ...sb,
            'content-type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(good.map((g) => g.row)),
        },
      )
      if (!write.ok) {
        // A cache-write failure must not fail the request — the caller still
        // gets its data, it just costs another fetch next time.
        console.error('[weather-fetch] cache write', write.status, await write.text())
      }

      for (const g of good) out.push({ key: g.key, year: g.year, daily: g.daily })
    }

    return json({ cells: out })
  } catch (e) {
    console.error('[weather-fetch]', e)
    return json({ error: String(e?.message ?? e) }, 500)
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
