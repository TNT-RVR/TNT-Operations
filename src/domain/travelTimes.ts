/**
 * Home→field road distance and time, for the cost estimator.
 *
 * ── What was missing ────────────────────────────────────────────────────────
 *
 * Spec §8.2 prices two things off a field's road distance from the depot: the
 * paid round trip (`travel = people × rt_h × pay`, for each of setup, bees and
 * removal) and most of the fuel (`fuel_km = rt_km × 2 × crews + route_km`). The
 * old app filled those with a Google Distance Matrix call behind an "update
 * travel times" button.
 *
 * That button was never ported. `fieldCost` has always READ `rtKm`/`rtMin`, and
 * nothing has ever WRITTEN them — so 12 of 15 real fields carried zero, and
 * every one of them costed a few hundred dollars light with a correspondingly
 * flattering profit per acre. On one measured field the gap is $278 on 152
 * acres, which is $1.82 an acre of pure arithmetic.
 *
 * This is the missing half: pick where a field actually is, and read a routing
 * matrix back into kilometres and minutes.
 *
 * ── Why OpenRouteService ────────────────────────────────────────────────────
 *
 * Real road distances on a free tier with no billing to enable, which matches
 * how this codebase already sources weather (Open-Meteo). Its matrix endpoint
 * answers home→every-field in ONE request, so a refresh of the whole season is
 * a single call rather than fifteen.
 *
 * Pure functions — no React, no fetch. The HTTP lives in
 * `netlify/functions/travel-times.mjs`.
 */

/** `[lat, lon]`, the order this app stores coordinates in. */
export type LatLon = [number, number]

export interface FieldLocation {
  id: string
  name: string
  /** Where the crew actually drives to. */
  at: LatLon
  /**
   * Which pin that came from. A field with no parking pin still has a pivot,
   * and over 30 km of road the difference between them is noise — but it is
   * recorded rather than hidden, because "we used the pivot" is the honest
   * answer to "why is this one slightly off".
   */
  source: 'parking' | 'pivot'
}

const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A `[lat, lon]` pair from whatever the field JSON happens to hold. */
function pair(value: unknown): LatLon | null {
  if (Array.isArray(value) && isCoord(Number(value[0])) && isCoord(Number(value[1]))) {
    const lat = Number(value[0])
    const lon = Number(value[1])
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return [lat, lon]
  }
  return null
}

/**
 * Where to route to for one field: its parking pin, else its pivot.
 *
 * Returns null when the field has neither, which is a field nobody could drive
 * to anyway — the caller reports it rather than routing to the equator.
 */
export function fieldLocation(field: {
  id: string
  name?: string
  parking_pin?: unknown
  PP_Latitude?: unknown
  PP_Longitude?: unknown
}): FieldLocation | null {
  const name = String(field.name ?? '')
  const parking = pair(field.parking_pin)
  if (parking) return { id: field.id, name, at: parking, source: 'parking' }

  /*
   * Blank, not zero. `Number('')` is 0 and [0, 0] is a real coordinate — off
   * the coast of Africa — so an empty pivot would route there and come back
   * with a confident 8,000 km. The field JSON stores these as strings and an
   * unset one is '', which is why this cannot just be Number().
   */
  const pivot = pair([blank(field.PP_Latitude), blank(field.PP_Longitude)])
  if (pivot) return { id: field.id, name, at: pivot, source: 'pivot' }
  return null
}

/** A number from a field-JSON string, or NaN when it was never filled in. */
function blank(v: unknown): number {
  if (v === null || v === undefined) return NaN
  if (typeof v === 'string' && v.trim() === '') return NaN
  return Number(v)
}

/** ORS wants `[lon, lat]`. Getting this the wrong way round routes to the sea. */
export const toOrsCoord = ([lat, lon]: LatLon): [number, number] => [lon, lat]

export interface TravelResult {
  id: string
  name: string
  source: FieldLocation['source']
  /** One-way road kilometres. */
  km: number
  /** One-way road minutes. */
  min: number
}

/**
 * Read an ORS matrix response into per-field figures.
 *
 * The request is one source (home) against N destinations, so both matrices
 * come back as a single row. A null cell means ORS could not route to that
 * point — usually a pin in the middle of a field with no road near it — and
 * that field is left OUT rather than written as zero. Zero is what the cost
 * estimator already wrongly believes; writing it would make the gap permanent
 * and invisible.
 */
export function readMatrix(
  response: { distances?: (number | null)[][]; durations?: (number | null)[][] },
  destinations: FieldLocation[],
): { results: TravelResult[]; unroutable: string[] } {
  const dist = response.distances?.[0] ?? []
  const dur = response.durations?.[0] ?? []
  const results: TravelResult[] = []
  const unroutable: string[] = []

  destinations.forEach((d, i) => {
    const km = dist[i]
    const seconds = dur[i]
    if (!isCoord(km!) || !isCoord(seconds!) || km! <= 0 || seconds! <= 0) {
      unroutable.push(d.name || d.id)
      return
    }
    results.push({
      id: d.id,
      name: d.name,
      source: d.source,
      // ORS is asked for kilometres; durations are always seconds.
      km: Math.round(km! * 1000) / 1000,
      min: Math.round((seconds! / 60) * 10) / 10,
    })
  })

  return { results, unroutable }
}

/** Does this field have a usable travel cache? Drives the "incomplete" marker. */
export function hasTravel(field: { home_to_parking_km?: unknown; home_to_parking_min?: unknown }): boolean {
  const km = Number(field.home_to_parking_km)
  const min = Number(field.home_to_parking_min)
  return Number.isFinite(km) && km > 0 && Number.isFinite(min) && min > 0
}
