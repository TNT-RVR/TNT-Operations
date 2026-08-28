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
 * ── Why Google ──────────────────────────────────────────────────────────────
 *
 * Because the three fields that DO have travel times were measured by Google in
 * the old app, and mixing sources would leave one season half-measured two
 * ways. Its Distance Matrix answers home→every-field in ONE request, so a
 * refresh of the whole season is a single call rather than fifteen — which
 * matters when every element is billable, even at a price this volume will
 * never reach.
 *
 * NOTE Google now labels Distance Matrix a legacy API and points new work at
 * the Routes API (`v2:computeRouteMatrix`). This uses the legacy one on
 * purpose: it is what produced the numbers already on file. The parsing is
 * confined to `readDistanceMatrix` if that ever has to change.
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

/**
 * Google wants `lat,lng` as a plain string — the same order this app stores.
 *
 * Worth its own function anyway: the previous routing service wanted them the
 * other way round, and a silent flip routes every field into the Gulf of Guinea
 * while still returning confident-looking kilometres.
 */
export const toLatLng = ([lat, lon]: LatLon): string => `${lat},${lon}`

export interface TravelResult {
  id: string
  name: string
  source: FieldLocation['source']
  /** One-way road kilometres. */
  km: number
  /** One-way road minutes. */
  min: number
}

/** The Distance Matrix response, as much of it as this needs. */
export interface DistanceMatrixResponse {
  status?: string
  error_message?: string
  rows?: Array<{
    elements?: Array<{
      status?: string
      distance?: { value?: number }
      duration?: { value?: number }
    }>
  }>
}

/**
 * Read a Distance Matrix response into per-field figures.
 *
 * One origin (home) against N destinations, so everything is in `rows[0]`.
 * Distances come back in METRES and durations in SECONDS regardless of the
 * `units` parameter — that only changes the human-readable `text`, which this
 * ignores. Reading `text` would mean parsing "31.5 km" back into a number, and
 * it is localised.
 *
 * An element that is not `OK` — no road near the pin, or too far to route — is
 * left OUT rather than written as zero. Zero is what the cost estimator already
 * wrongly believes, so writing it would make the gap permanent and invisible.
 */
export function readDistanceMatrix(
  response: DistanceMatrixResponse,
  destinations: FieldLocation[],
): { results: TravelResult[]; unroutable: string[] } {
  const elements = response.rows?.[0]?.elements ?? []
  const results: TravelResult[] = []
  const unroutable: string[] = []

  destinations.forEach((d, i) => {
    const el = elements[i]
    const metres = el?.distance?.value
    const seconds = el?.duration?.value
    if (el?.status !== 'OK' || !isCoord(metres!) || !isCoord(seconds!) || metres! <= 0 || seconds! <= 0) {
      unroutable.push(d.name || d.id)
      return
    }
    results.push({
      id: d.id,
      name: d.name,
      source: d.source,
      km: Math.round((metres! / 1000) * 1000) / 1000,
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
