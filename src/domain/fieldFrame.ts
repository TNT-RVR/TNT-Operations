import { fromLonLat, toLonLat, latlonListToEnu } from './geo'
import { resolveRowMask, baySlotLefts, type FieldDict } from './tentGrid'

/**
 * The shared coordinate frame every map overlay works in — the SAME projection,
 * rotation and bay tiling the placement engine uses (spec §5.1–5.3).
 *
 * The engine is the single source of truth for placement (spec Part 11), so
 * overlays must never re-derive this math: bays drawn from a slightly different
 * rotation than the shelters were placed in is exactly the class of bug the
 * golden tests exist to prevent. Build a frame here, project with it, done.
 *
 *   lateral = across the passes (+x roughly east before rotation)
 *   along   = down the pass
 */

const IN_TO_M = 0.0254
const FT_TO_M = 0.3048

/**
 * Tolerant numeric read. An ABSENT or blank value yields `dflt`, not 0 —
 * `Number('')` is 0, which would silently place a pivot-less field at lat/lon
 * 0,0 (the Atlantic) and draw a full set of overlays there.
 */
const toFloat = (v: unknown, dflt = 0): number => {
  const s = String(v ?? '').trim()
  if (s === '') return dflt
  const n = Number(s)
  return Number.isFinite(n) ? n : dflt
}
const pymod = (a: number, b: number): number => ((a % b) + b) % b
const truthy = (v: unknown): boolean =>
  v === true || v === 'true' || v === 'True' || v === 'Yes' || v === 'yes' || v === 1

export interface FieldFrame {
  pivotLat: number
  pivotLon: number
  /** Pivot easting/northing in the UTM-ish projection, for enu round-trips. */
  easting: number
  northing: number
  cosR: number
  sinR: number
  /** Field extent in metres (boundary max radius × 1.05, or the pivot Radius). */
  radius: number
  /** Boundary ring in ENU metres, or null for radius-only fields. */
  boundaryEnu: Array<[number, number]> | null
  // ── Bay tiling (only meaningful when useBays) ──
  useBays: boolean
  mask: string
  rowSpacingM: number
  gapM: number
  /** Lateral left edge (m) of every row slot in one pass. */
  lefts: number[]
  /** Full planter-pass width (m). */
  passW: number
  sprayerWidthM: number
  /** Spray direction may differ from planting; both in degrees. */
  plantAngle: number
  sprayAngle: number
  passPhaseSwap: boolean
  /** Lateral/along shift from crew calibration (m). */
  shiftE: number
  shiftN: number
}

/** Build the frame for a field, or null when the pivot isn't set yet. */
export function fieldFrame(field: FieldDict): FieldFrame | null {
  const pivotLat = toFloat(field['PP_Latitude'], NaN)
  const pivotLon = toFloat(field['PP_Longitude'], NaN)
  if (!Number.isFinite(pivotLat) || !Number.isFinite(pivotLon)) return null

  const plantAngle = toFloat(field['Planting_angle'] ?? field['Spray_angle'] ?? 0)
  const sprayAngleRaw = String(field['Spray_angle'] ?? '').trim()
  const sprayAngle = sprayAngleRaw ? toFloat(sprayAngleRaw) : plantAngle

  const rotate = pymod(0 - plantAngle + 180, 360) - 180
  const rotR = (rotate * Math.PI) / 180
  const [easting, northing] = fromLonLat(pivotLon, pivotLat, pivotLon)

  // Boundary → ENU, and the field extent.
  const poly = field['boundary_polygon'] as Array<[unknown, unknown]> | null | undefined
  let boundaryEnu: Array<[number, number]> | null = null
  let radius = toFloat(field['Radius'], 0)
  if (Array.isArray(poly) && poly.length >= 3) {
    boundaryEnu = latlonListToEnu(
      poly.map((p) => [toFloat(p[0]), toFloat(p[1])] as [number, number]),
      pivotLon,
      pivotLat,
    )
    let rmax = 0
    for (const [e, n] of boundaryEnu) rmax = Math.max(rmax, Math.hypot(e, n))
    radius = rmax * 1.05
  }
  if (!(radius > 0)) radius = 400

  const useBays = !(field['use_bays'] === false || String(field['use_bays'] ?? '') === 'false')
  const nf = toFloat(field['num_female_rows'], 0)
  const nm = toFloat(field['num_male_rows'], 0)
  const totalRows = toFloat(field['total_rows'], nf + nm)
  const rowSpacingM = toFloat(field['row_spacing_in'], 0) * IN_TO_M
  const gapM = toFloat(field['bay_gap_in'], 0) * IN_TO_M
  const mask = useBays
    ? resolveRowMask(nf, nm, String(field['row_layout'] ?? 'centered'), String(field['custom_row_mask'] ?? ''), totalRows)
    : ''
  const [lefts, passW] = mask && rowSpacingM > 0 ? baySlotLefts(mask, rowSpacingM, gapM) : [[], 0]

  return {
    pivotLat,
    pivotLon,
    easting,
    northing,
    cosR: Math.cos(rotR),
    sinR: Math.sin(rotR),
    radius,
    boundaryEnu,
    useBays,
    mask,
    rowSpacingM,
    gapM,
    lefts,
    passW,
    sprayerWidthM: toFloat(field['Sprayer_width'], 133) * FT_TO_M,
    plantAngle,
    sprayAngle,
    passPhaseSwap: truthy(field['pass_phase_swap']),
    shiftE: toFloat(field['bay_shift_e_m'], 0),
    shiftN: toFloat(field['bay_shift_n_m'], 0),
  }
}

/** (lateral, along) → ENU metres, applying any calibration shift. */
export function latAlongToEnu(f: FieldFrame, lateral: number, along: number): [number, number] {
  const east = lateral * f.cosR - along * f.sinR + f.shiftE
  const north = along * f.cosR + lateral * f.sinR + f.shiftN
  return [east, north]
}

/** ENU metres → (lateral, along), removing any calibration shift. */
export function enuToLatAlong(f: FieldFrame, east: number, north: number): [number, number] {
  const e = east - f.shiftE
  const n = north - f.shiftN
  return [e * f.cosR + n * f.sinR, -e * f.sinR + n * f.cosR]
}

/** ENU metres → [lon, lat] for GeoJSON. */
export function enuToLonLat(f: FieldFrame, east: number, north: number): [number, number] {
  const [lon, lat] = toLonLat(f.easting + east, f.northing + north, f.pivotLon)
  return [lon, lat]
}

/** (lateral, along) → [lon, lat] — the common path for drawing overlays. */
export function latAlongToLonLat(f: FieldFrame, lateral: number, along: number): [number, number] {
  const [e, n] = latAlongToEnu(f, lateral, along)
  return enuToLonLat(f, e, n)
}

/** The field's extent in the rotated frame: [latMin, latMax, alongMin, alongMax]. */
export function frameExtent(f: FieldFrame): [number, number, number, number] {
  if (!f.boundaryEnu || f.boundaryEnu.length < 3) {
    return [-f.radius, f.radius, -f.radius, f.radius]
  }
  const lats: number[] = []
  const alongs: number[] = []
  for (const [e, n] of f.boundaryEnu) {
    const [lateral, along] = enuToLatAlong(f, e, n)
    lats.push(lateral)
    alongs.push(along)
  }
  return [Math.min(...lats), Math.max(...lats), Math.min(...alongs), Math.max(...alongs)]
}

/** Point-in-polygon over an ENU ring (ray casting). */
export function pointInEnuRing(ring: Array<[number, number]>, e: number, n: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > n !== yj > n && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
