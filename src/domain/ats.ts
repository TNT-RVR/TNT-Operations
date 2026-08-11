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
 * `ats.test.ts` measures the error against fifteen real TNT fields whose
 * surveyed pivot coordinates are known, and asserts each pivot lands inside the
 * quarter this computes. That is the honest claim: good enough to find a parcel
 * and drive to it, NOT a legal boundary. Anything that needs survey accuracy
 * needs the Alberta ATS dataset, not this.
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
 * Typical error, measured. A quarter section is 804 m across, so this places a
 * parcel reliably in the right section and usually in the right quarter.
 */
export const TYPICAL_ERROR_M = 300

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

/**
 * The box for a legal land description.
 *
 * With a quarter, the box is that quarter (half a mile square). Without one it
 * is the whole section (a mile square) — which is the right answer to "where is
 * 35-8-21", rather than silently picking a corner.
 */
export function atsBox(parts: AtsParts): AtsBox | null {
  const meridianLng = MERIDIANS[parts.meridian]
  if (meridianLng === undefined) return null
  const pos = sectionGridPosition(parts.section)
  if (!pos) return null
  if (parts.township < 1 || parts.township > 126) return null
  if (parts.range < 1 || parts.range > 34) return null

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
  }
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
