/**
 * Alberta Township System → coordinates. Pure functions — no React, no network.
 *
 * Turns any legal land description into a box on the map, whether or not it is
 * a field in the system. The point is scouting: a grower names a quarter you
 * have never worked, and you want to see where it is before driving out.
 *
 * ── This is an APPROXIMATION, and the size of the error is measured ──────────
 *
 * The ATS is a survey, not a formula. Township and range lines were walked in
 * the field, meridians converge toward the pole, and correction lines re-set
 * the ranges periodically — so no arithmetic reproduces it exactly. What this
 * does is lay a regular 6-mile grid north from 49°N and west from each
 * meridian, which is the shape the survey approximates.
 *
 * ── Two tiers ────────────────────────────────────────────────────────────────
 *
 * SURVEY (`atsBox` with a township table) uses the real Alberta Township System
 * survey, collapsed to one origin and section pitch per township by
 * `scripts/build_ats_townships.py`. Median error 7 m. This is what Alberta
 * lookups use.
 *
 * GRID (`atsBox` with no table) lays a regular grid north from 49°N and west
 * from each meridian. Typical error 300 m, and it CANNOT be better: the survey
 * re-sets its ranges at correction lines every four townships, so the offset
 * jumps — two fields either side of one are wrong in opposite directions. This
 * tier exists so Saskatchewan, Manitoba and W1–W3 degrade instead of failing.
 *
 * `ats.test.ts` measures both against fifteen real TNT fields whose surveyed
 * pivot coordinates are known. Even the survey tier is a lookup of section
 * centres, NOT a legal boundary — anything that needs survey accuracy needs
 * Alberta's own ATS dataset.
 */

/** Metres in a survey mile. */
const MILE_M = 1609.344

/**
 * A township is six miles PLUS its road allowances, and so is a range.
 *
 * These two numbers are the whole difference between a naive grid and a usable
 * one. Six miles exactly puts a parcel 1.5–2.9 km from where it is — pointing
 * at the wrong section entirely. The extra comes from the 66-foot road
 * allowances the survey leaves between sections: three east–west crossings per
 * township (~60 m) and six north–south ones per range (~121 m).
 *
 * The values below were FITTED by least squares against fifteen TNT fields
 * whose surveyed pivot coordinates are known, and they land within a few metres
 * of what the road allowances predict — which is the reassuring part. See
 * `ats.test.ts`, which re-measures the fit on every run.
 */
const TOWNSHIP_M = 6 * MILE_M + 56
const RANGE_M = 6 * MILE_M + 138

/**
 * Typical error of each tier, measured — quoted to the user, so they know what
 * the box on the map is worth. A quarter section is 804 m across.
 */
export const SURVEY_ERROR_M = 35
export const GRID_ERROR_M = 300

/**
 * Longitude of each meridian, west negative.
 *
 * The First Meridian is not a round number — it was fixed just west of
 * Winnipeg in 1869 and everything else follows from it.
 */
export const MERIDIANS: Record<number, number> = {
  1: -97.457_5,
  2: -102,
  3: -106,
  4: -110,
  5: -114,
  6: -118,
}

/** The southern edge of Township 1: the international boundary. */
const BASE_LAT = 49

/** Metres per degree of latitude at `lat` (WGS84 approximation, sub-metre). */
function mPerDegLat(lat: number): number {
  const p = (lat * Math.PI) / 180
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p)
}

/** Metres per degree of longitude at `lat`. */
function mPerDegLon(lat: number): number {
  const p = (lat * Math.PI) / 180
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p)
}

/**
 * Latitude of the southern boundary of `township`.
 *
 * Stepped township by township rather than multiplied out, because degrees per
 * mile shrink as you go north. Over 126 townships a single multiplication is
 * out by kilometres; stepping keeps it consistent with the survey's own
 * north-from-the-border construction.
 */
export function townshipSouthLat(township: number): number {
  let lat = BASE_LAT
  for (let t = 1; t < township; t++) {
    lat += TOWNSHIP_M / mPerDegLat(lat)
  }
  return lat
}

export interface LatLng {
  lat: number
  lng: number
}

/** A rectangle on the map, as a closed ring of five points. */
export type Ring = LatLng[]

export interface AtsBox {
  /** Centre of the parcel. */
  center: LatLng
  /** Corner ring, closed (first point repeated last), ready for GeoJSON. */
  ring: Ring
  /** South-west and north-east corners. */
  bounds: { south: number; west: number; north: number; east: number }
  /** Which tier produced this — the UI quotes a different error for each. */
  source: 'survey' | 'grid'
}

// ═══════════════════════════════════════════════════════════════════════════
// The survey table
// ═══════════════════════════════════════════════════════════════════════════

/** One township as surveyed: where it starts and how its sections step. */
export interface Township {
  /** Latitude of the south edge of the southern section row. */
  south: number
  /** Longitude of the east edge of the eastern section column. */
  east: number
  /**
   * Spacing between section edges. NOT the same as `sizeLat`/`sizeLon` — the
   * survey cuts a road allowance between sections, so the pitch is a mile plus
   * that allowance.
   */
  pitchLat: number
  pitchLon: number
  /** The surveyed section itself, without the road allowance. */
  sizeLat: number
  sizeLon: number
}

export interface TownshipTable {
  get(meridian: number, township: number, range: number): Township | null
  readonly size: number
}

/** Fixed-point scales, matching `scripts/build_ats_townships.py`. */
const DEG_SCALE = 1e7
const STEP_SCALE = 1e6
const RECORD_BYTES = 20

const townshipKey = (meridian: number, township: number, range: number) =>
  meridian * 1_000_000 + township * 1_000 + range

/**
 * Decode `public/ats-townships.bin`.
 *
 * Returns null rather than throwing on a bad or truncated file: a corrupt asset
 * should cost the lookup its accuracy, not take the map down with it. The
 * caller falls back to the grid tier.
 */
export function parseTownshipTable(buffer: ArrayBuffer): TownshipTable | null {
  if (buffer.byteLength < 8) return null
  const view = new DataView(buffer)
  // Magic 'ATT1' — guards against a 404 HTML page arriving as the asset.
  if (view.getUint32(0, false) !== 0x41545431) return null
  const count = view.getUint32(4, true)
  if (buffer.byteLength < 8 + count * RECORD_BYTES) return null

  const map = new Map<number, Township>()
  for (let i = 0; i < count; i++) {
    const o = 8 + i * RECORD_BYTES
    map.set(townshipKey(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2)), {
      south: view.getInt32(o + 4, true) / DEG_SCALE,
      east: view.getInt32(o + 8, true) / DEG_SCALE,
      pitchLat: view.getUint16(o + 12, true) / STEP_SCALE,
      pitchLon: view.getUint16(o + 14, true) / STEP_SCALE,
      sizeLat: view.getUint16(o + 16, true) / STEP_SCALE,
      sizeLon: view.getUint16(o + 18, true) / STEP_SCALE,
    })
  }
  return {
    get: (meridian, township, range) => map.get(townshipKey(meridian, township, range)) ?? null,
    size: map.size,
  }
}

/**
 * Where section `section` sits in its township, as a grid position.
 *
 * Sections are numbered in a serpentine ("boustrophedon") from the SOUTH-EAST
 * corner: 1–6 run east to west along the bottom, 7–12 run back west to east on
 * the next row up, and so on to 36 in the north-east. Getting this backwards
 * puts a parcel up to six miles from where it belongs, and the result still
 * looks plausible on a map — which is why it has its own test.
 */
export function sectionGridPosition(section: number): { colFromWest: number; rowFromSouth: number } | null {
  if (!Number.isInteger(section) || section < 1 || section > 36) return null
  const rowFromSouth = Math.floor((section - 1) / 6)
  const posInRow = (section - 1) % 6
  // Even rows (1–6, 13–18, 25–30) are numbered east→west; odd rows west→east.
  const colFromWest = rowFromSouth % 2 === 0 ? 5 - posInRow : posInRow
  return { colFromWest, rowFromSouth }
}

/** Where a quarter sits inside its section. */
function quarterOffset(quarter: string | null): { east: number; north: number } {
  // Half-mile steps from the section's south-west corner to the quarter's.
  switch (quarter) {
    case 'NE':
      return { east: 1, north: 1 }
    case 'NW':
      return { east: 0, north: 1 }
    case 'SE':
      return { east: 1, north: 0 }
    case 'SW':
      return { east: 0, north: 0 }
    default:
      return { east: 0, north: 0 }
  }
}

export interface AtsParts {
  quarter: string | null
  section: number
  township: number
  range: number
  meridian: number
}

/** Assemble a box from its edges. */
function makeBox(
  south: number,
  west: number,
  north: number,
  east: number,
  source: 'survey' | 'grid',
): AtsBox {
  return {
    center: { lat: (south + north) / 2, lng: (west + east) / 2 },
    ring: [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: east },
      { lat: north, lng: west },
      { lat: south, lng: west },
    ],
    bounds: { south, west, north, east },
    source,
  }
}

/**
 * The box for a legal land description.
 *
 * With a quarter, the box is that quarter (half a mile square). Without one it
 * is the whole section (a mile square) — which is the right answer to "where is
 * 35-8-21", rather than silently picking a corner.
 *
 * Pass `table` (from `parseTownshipTable`) to use the survey. Without it, or
 * for a township the survey data does not cover, this falls back to the grid —
 * see the two tiers at the top of the file.
 */
export function atsBox(parts: AtsParts, table?: TownshipTable | null): AtsBox | null {
  const meridianLng = MERIDIANS[parts.meridian]
  if (meridianLng === undefined) return null
  const pos = sectionGridPosition(parts.section)
  if (!pos) return null
  if (parts.township < 1 || parts.township > 126) return null
  if (parts.range < 1 || parts.range > 34) return null

  const surveyed = table?.get(parts.meridian, parts.township, parts.range)
  if (surveyed) {
    const q = quarterOffset(parts.quarter)
    // Sections step west from the township's east edge, so a column counted
    // from the west has to be flipped.
    const colFromEast = 5 - pos.colFromWest
    const secSouth = surveyed.south + pos.rowFromSouth * surveyed.pitchLat
    const secEast = surveyed.east - colFromEast * surveyed.pitchLon
    const h = parts.quarter ? surveyed.sizeLat / 2 : surveyed.sizeLat
    const w = parts.quarter ? surveyed.sizeLon / 2 : surveyed.sizeLon
    const south = secSouth + (parts.quarter ? q.north * h : 0)
    const east = secEast - (parts.quarter ? (1 - q.east) * w : 0)
    return makeBox(south, east - w, south + h, east, 'survey')
  }

  const southLat = townshipSouthLat(parts.township)
  // Work at the township's middle latitude: longitude degrees change with
  // latitude, and using the south edge would skew the box's east-west size.
  const midLat = southLat + TOWNSHIP_M / 2 / mPerDegLat(southLat)
  const degLat = (m: number) => m / mPerDegLat(midLat)
  const degLon = (m: number) => m / mPerDegLon(midLat)

  // A section is a sixth of its township/range — very slightly over a mile,
  // because the road allowances are inside the township, not around it.
  const secH = TOWNSHIP_M / 6
  const secW = RANGE_M / 6
  const q = quarterOffset(parts.quarter)

  // South edge: up from the township line by whole sections, then the quarter.
  const south = southLat + degLat(pos.rowFromSouth * secH + (parts.quarter ? (q.north * secH) / 2 : 0))
  const north = south + degLat(parts.quarter ? secH / 2 : secH)

  // Ranges count WEST from the meridian, and sections count west within the
  // township — so east longitude decreases as both increase.
  const rangeEast = meridianLng - degLon((parts.range - 1) * RANGE_M)
  const sectionEast = rangeEast - degLon((5 - pos.colFromWest) * secW)
  const east = sectionEast - (parts.quarter ? degLon(((1 - q.east) * secW) / 2) : 0)
  const west = east - degLon(parts.quarter ? secW / 2 : secW)

  return makeBox(south, west, north, east, 'grid')
}

/** Great-circle distance in metres. For measuring how far off we are. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Whether a point falls inside a box. */
export function contains(box: AtsBox, p: LatLng): boolean {
  return (
    p.lat >= box.bounds.south &&
    p.lat <= box.bounds.north &&
    p.lng >= box.bounds.west &&
    p.lng <= box.bounds.east
  )
}

/** The box as a GeoJSON Feature, ready to hand to MapLibre. */
export function toGeoJson(box: AtsBox, label: string): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: { label },
    geometry: {
      type: 'Polygon',
      coordinates: [box.ring.map((p) => [p.lng, p.lat] as [number, number])],
    },
  }
}
