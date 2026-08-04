/**
 * Shelter-position grid engine — the faithful TypeScript port of
 * `get_tent_positions()` from the old beetent-maps `maketentgrid.py`.
 *
 * Given a field definition (boundary polygon or pivot circle, bay layout,
 * pivot tracks, exclusions and a shelter-count mode) it computes shelter pin
 * positions as [lat, lon] in NW-snake numbering order.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Ported code paths (the ones every real field in beetent-maps/fields exercises):
 *   • MANUAL mode         — return the user's stored pins verbatim.
 *   • SYNTHETIC-GRID mode — the unified green-zone grid used by ALL shelter-count
 *     modes (target count / explicit spacing / auto). Includes: bay-locked
 *     lateral columns, pivot-inner + pivot-track exclusion, interior/outside
 *     sprayer-pass kill zones, corner-arm and inner-boundary exclusions,
 *     kill-zone "snap", count-targeting binary search, column symmetry trim,
 *     radius-based trim, and the ENU→lat/lon round-trip boundary filter.
 *   • two-pivot and spray-both-ways sub-branches are ported too (single global
 *     grid), though no current field exercises them.
 *
 * Deferred (throws `NotPortedError` if a field ever hits it — loud, not silent):
 *   • PASS-FOLLOWING mode (imported John Deere planter passes). Gated behind
 *     `use_imported_passes` + non-empty `planter_passes`; off for every field
 *     today. Port from `maketentgrid.py` lines ~2148–2546 when needed.
 *
 * The synthetic-grid math mirrors the Python operation-for-operation so the
 * golden-file tests (real fields run through the old Python) match within ~1 m.
 * Do NOT "tidy" the algebra, rounding, or loop bounds — fidelity is the point.
 */

import { fromLonLat, toLonLat, latlonListToEnu, type LngLat } from './geo'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Raw field dict, matching the JSON saved by the old app (loosely typed). */
export type FieldDict = Record<string, unknown>

export interface TentPositions {
  /** Shelter pins in NW-snake order. */
  positions: LngLat[]
  /** 0-based NW-snake row index per pin (parallel to `positions`). */
  rows: number[]
}

/** Thrown when a field needs a code path not yet ported (e.g. pass-following). */
export class NotPortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotPortedError'
  }
}

export interface TentOptions {
  /** Match `use_metric` in the Python (default true → metres). */
  useMetric?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Python-compatibility primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Python truthiness for the value kinds found in field dicts. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** `dict.get(key) or default` — default when the value is falsy. */
function getOr<T>(field: FieldDict, key: string, dflt: T): unknown | T {
  const v = field[key]
  return truthy(v) ? v : dflt
}

/** `dict.get(key, default)` — default only when the key is absent. */
function getMissing<T>(field: FieldDict, key: string, dflt: T): unknown | T {
  return key in field ? field[key] : dflt
}

/** `float(x)` — throws (like Python ValueError) on non-numeric input. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`float() bad number: ${v}`)
    return v
  }
  const s = String(v).trim()
  if (s === '') throw new Error('float() empty string')
  const n = Number(s)
  if (Number.isNaN(n) || !Number.isFinite(n)) throw new Error(`float() invalid: ${s}`)
  return n
}

/** `int(x)` — truncate toward zero for numbers; parse an integer literal for strings. */
function toInt(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v)
  const s = String(v).trim()
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`int() invalid: ${s}`)
  return parseInt(s, 10)
}

/** Python `round()` — round half to even ("banker's rounding"). */
function pyRound(value: number, ndigits = 0): number {
  if (!Number.isFinite(value)) return value
  const m = 10 ** ndigits
  const scaled = value * m
  const floor = Math.floor(scaled)
  const frac = scaled - floor
  let rounded: number
  if (Math.abs(frac - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1
  } else {
    rounded = Math.round(scaled) // half-up only reached for non-half values → nearest
  }
  return rounded / m
}

/** Python `%` (result takes the sign of the divisor). */
function pymod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Stable sort by a numeric key, matching Python's `sorted(..., key=fn)`
 * (equal keys keep their original order).
 */
function sortedByKey<T>(items: T[], key: (item: T) => number): T[] {
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((d) => d.item)
}

/** First element minimising `key` (ties → first, like Python `min(..., key=)`). */
function minByKey<T>(items: T[], key: (item: T) => number): T {
  let best = items[0]
  let bestK = key(best)
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i])
    if (k < bestK) {
      bestK = k
      best = items[i]
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers (from maketentgrid.py)
// ─────────────────────────────────────────────────────────────────────────────

type Pt = [number, number]
type BBox = [number, number, number, number] // minX, maxX, minY, maxY

/** Ray-casting point-in-polygon. `polygon` is [(x, y), ...]. */
function pointInPolygon(px: number, py: number, polygon: Pt[]): boolean {
  let inside = false
  let j = polygon.length - 1
  for (let i = 0; i < polygon.length; i++) {
    const xi = polygon[i][0]
    const yi = polygon[i][1]
    const xj = polygon[j][0]
    const yj = polygon[j][1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
    j = i
  }
  return inside
}

function bboxOf(polygon: Pt[]): BBox {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, maxX, minY, maxY]
}

/** Point-in-polygon with an O(1) bounding-box reject. */
function pointInPolygonBB(px: number, py: number, polygon: Pt[], bbox: BBox): boolean {
  if (px < bbox[0] || px > bbox[1] || py < bbox[2] || py > bbox[3]) return false
  return pointInPolygon(px, py, polygon)
}

/** Contiguous runs of `char` in `mask` as [start, endExclusive) pairs. */
export function maskRuns(mask: string, char: string): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start: number | null = null
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === char) {
      if (start === null) start = i
    } else if (start !== null) {
      runs.push([start, i])
      start = null
    }
  }
  if (start !== null) runs.push([start, mask.length])
  return runs
}

/** Build the M/F-per-row planter mask (see resolve_row_mask in the Python). */
export function resolveRowMask(
  nf: number,
  nm: number,
  layout: string,
  custom: string,
  totalRows?: number,
): string {
  nf = toInt(nf)
  nm = toInt(nm)
  const unit = Math.max(0, nf + nm)
  if (unit === 0) return ''
  let target: number
  try {
    target = totalRows ? toInt(totalRows) : unit
  } catch {
    target = unit
  }
  if (target <= 0) target = unit
  if (layout === 'custom') {
    const s = (custom || '')
      .toUpperCase()
      .split('')
      .filter((c) => c === 'M' || c === 'F')
      .join('')
    if (s) return s
    layout = 'centered'
  }
  let unitMask: string
  if (layout === 'outer') {
    const left = Math.trunc(nm / 2)
    const right = nm - left
    unitMask = 'M'.repeat(left) + 'F'.repeat(nf) + 'M'.repeat(right)
  } else {
    const leftF = Math.trunc(nf / 2)
    const rightF = nf - leftF
    unitMask = 'F'.repeat(leftF) + 'M'.repeat(nm) + 'F'.repeat(rightF)
  }
  if (target === unit) return unitMask
  const copies = Math.trunc((target + unit - 1) / unit)
  return unitMask.repeat(copies).slice(0, target)
}

/**
 * Lateral left-edge of each planter row slot with a `gapM` gap inserted at every
 * male/female boundary. Returns [lefts, passW]. Mirrors bay_slot_lefts.
 */
export function baySlotLefts(mask: string, rsM: number, gapM: number): [number[], number] {
  const n = mask.length
  if (n === 0) return [[], 0.0]
  const lefts = new Array<number>(n).fill(0.0)
  let x = 0.0
  for (let k = 1; k < n; k++) {
    x += rsM
    if (mask[k - 1] !== mask[k]) x += gapM
    lefts[k] = x
  }
  let passW = lefts[n - 1] + rsM
  if (mask[0] !== mask[n - 1]) passW += gapM
  return [lefts, passW]
}

const MALE_BAY_OFFSET_FT = 5.0

/** Sorted lateral positions of shelter rows — one per male bay (male_bay_shelter_laterals). */
export function maleBayShelterLaterals(
  nf: number,
  nm: number,
  layout: string,
  custom: string,
  totalRows: number,
  rsM: number,
  offsetM: number,
  radius: number,
  phase = 0,
  gapM = 0.0,
): number[] {
  const mask = resolveRowMask(nf, nm, layout, custom, totalRows)
  const runs = mask ? maskRuns(mask, 'M') : []
  if (runs.length === 0 || totalRows <= 0 || rsM <= 0) return []
  const reversed = mask.split('').reverse().join('')
  const runsRev = maskRuns(reversed, 'M')
  const [leftsFwd, passW] = baySlotLefts(mask, rsM, gapM)
  const [leftsRev] = baySlotLefts(reversed, rsM, gapM)
  const half = passW / 2.0
  const nPass = Math.trunc(radius / passW) + 2
  const xs: number[] = []
  for (let i = -nPass; i <= nPass; i++) {
    const xc = (i + 0.5) * passW
    const even = pymod(i + phase, 2) === 0
    const runsI = even ? runs : runsRev
    const leftsI = even ? leftsFwd : leftsRev
    for (const [s] of runsI) {
      xs.push(xc + leftsI[s] - half - offsetM)
    }
  }
  const uniq = new Set<number>()
  for (const x of xs) uniq.add(pyRound(x, 4))
  return Array.from(uniq).sort((a, b) => a - b)
}

/** Auto ~1-per-acre spacing (calculate_spacing). Used only when no count/spacing given. */
function calculateSpacing(radius: number, width: number, factor = 1, numTents?: number): number {
  let c = 0
  let total = 0
  while (c < radius) {
    total += Math.sqrt(radius * radius - c * c)
    c += width
  }
  total = total * 4 - radius * 2
  if (numTents) return (total / numTents) * factor
  return (total / ((Math.PI * radius * radius) / 4046.87 + 1)) * factor
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry points
// ─────────────────────────────────────────────────────────────────────────────

/** Shelter pins for a field, in NW-snake order. See {@link getTentPositionsWithRows}. */
export function getTentPositions(field: FieldDict, opts: TentOptions = {}): LngLat[] {
  return getTentPositionsWithRows(field, opts).positions
}

/** Shelter pins plus their NW-snake row indices. */
export function getTentPositionsWithRows(field: FieldDict, opts: TentOptions = {}): TentPositions {
  const useMetric = opts.useMetric ?? true
  const [posLatLon, rows] = impl(field, useMetric)
  return {
    positions: posLatLon.map(([lat, lng]) => ({ lat, lng })),
    rows,
  }
}

/**
 * Core port of `_get_tent_positions_impl`. Returns [[lat, lon], ...] and the
 * parallel NW-snake row index list. Any error → empty (matching the Python's
 * outer `except: return []`), EXCEPT a NotPortedError which propagates.
 */
function impl(field: FieldDict, useMetric: boolean): [Pt[], number[]] {
  // Manual-pin mode: complete short-circuit.
  const modeEarly = String(getOr(field, 'shelter_mode', '')).trim().toLowerCase()
  if (modeEarly === 'manual') {
    const manual = (getOr(field, 'manual_shelter_pins', []) as unknown[]) || []
    const result: Pt[] = []
    for (const pt of manual) {
      try {
        const arr = pt as [unknown, unknown]
        const lat = toFloat(arr[0])
        const lon = toFloat(arr[1])
        result.push([lat, lon])
      } catch {
        continue
      }
    }
    return [result, result.map(() => 0)]
  }

  try {
    const conv = useMetric ? 1.0 : 0.3048
    const pivotLon = toFloat(field['PP_Longitude'])
    const pivotLat = toFloat(field['PP_Latitude'])
    const sprayerWidth = toFloat(field['Sprayer_width']) * 0.3048 // feet → metres

    const boundaryPolygon = (getOr(field, 'boundary_polygon', null) as Array<Pt> | null) || null
    const pivotTracks = ((getOr(field, 'pivot_tracks', []) as unknown[]) || [])
      .map((r) => toFloat(r))
      .sort((a, b) => a - b)
    const exclM = toFloat(getOr(field, 'track_exclusion_ft', 10)) * 0.3048

    let innerPivotRadius = sprayerWidth
    if (pivotTracks.length > 0 && !truthy(field['shelter_at_pivot'])) {
      innerPivotRadius = Math.max(sprayerWidth, pivotTracks[0])
    }
    const outsidePass =
      String(getOr(field, 'shelters_in_outside_pass', 'Yes')).trim().toLowerCase() !== 'yes'

    let radius: number
    let boundaryEnu: Pt[] | null
    let boundaryEnuBbox: BBox | null
    if (boundaryPolygon) {
      boundaryEnu = latlonListToEnu(
        boundaryPolygon.map((p) => [toFloat(p[0]), toFloat(p[1])] as [number, number]),
        pivotLon,
        pivotLat,
      )
      boundaryEnuBbox = bboxOf(boundaryEnu)
      let rmax = 0
      for (const [e, n] of boundaryEnu) {
        const d = Math.sqrt(e * e + n * n)
        if (d > rmax) rmax = d
      }
      radius = rmax * 1.05
    } else {
      const rRaw = String(getOr(field, 'Radius', '')).trim()
      if (!rRaw) return [[], []]
      radius = toFloat(rRaw) * conv
      boundaryEnu = null
      boundaryEnuBbox = null
    }

    // Misplaced-pivot guard (freeze protection).
    if (boundaryEnu) {
      const xs = boundaryEnu.map((p) => p[0])
      const ys = boundaryEnu.map((p) => p[1])
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      let minD = Infinity
      for (const [e, n] of boundaryEnu) {
        const d = Math.hypot(e, n)
        if (d < minD) minD = d
      }
      if (minD > Math.max(2000.0, 3.0 * diag)) return [[], []]
    }

    // Optional SECOND pivot (rare — no current field). One global grid.
    let pivot2Enu: Pt | null = null
    let innerR2P1 = innerPivotRadius * innerPivotRadius
    let innerR2P2 = innerR2P1
    let trkP1 = pivotTracks.slice()
    let trkP2: number[] = []
    let radius1 = radius
    let radius2 = radius
    if (truthy(field['two_pivots'])) {
      try {
        const p2lon = toFloat(field['PP2_Longitude'])
        const p2lat = toFloat(field['PP2_Latitude'])
        pivot2Enu = latlonListToEnu([[p2lat, p2lon]], pivotLon, pivotLat)[0]
        const pivotTracks2 = ((getOr(field, 'pivot_tracks2', []) as unknown[]) || [])
          .map((r) => toFloat(r))
          .sort((a, b) => a - b)
        trkP2 = pivotTracks2
        let innerPivotRadius2 = sprayerWidth
        if (pivotTracks2.length > 0 && !truthy(field['shelter_at_pivot'])) {
          innerPivotRadius2 = Math.max(sprayerWidth, pivotTracks2[0])
        }
        innerR2P2 = innerPivotRadius2 * innerPivotRadius2
        if (boundaryPolygon) {
          radius2 = radius1
        } else {
          const r2Raw = String(getOr(field, 'Radius2', '')).trim()
          radius2 = r2Raw ? toFloat(r2Raw) * conv : radius1
          const d12 = Math.sqrt(pivot2Enu[0] ** 2 + pivot2Enu[1] ** 2)
          radius = Math.max(radius, d12 + radius2)
        }
      } catch {
        pivot2Enu = null
      }
    }
    const rad1Sq = radius1 * radius1
    const rad2Sq = radius2 * radius2

    const nearestPivot = (east: number, north: number): [number, number, number[]] => {
      const d1 = east * east + north * north
      if (pivot2Enu === null) return [d1, innerR2P1, trkP1]
      const e2 = east - pivot2Enu[0]
      const n2 = north - pivot2Enu[1]
      const d2 = e2 * e2 + n2 * n2
      if (d2 < d1) return [d2, innerR2P2, trkP2]
      return [d1, innerR2P1, trkP1]
    }

    const outsideFieldCircles = (east: number, north: number): boolean => {
      if (east * east + north * north <= rad1Sq) return false
      if (pivot2Enu !== null) {
        const e2 = east - pivot2Enu[0]
        const n2 = north - pivot2Enu[1]
        if (e2 * e2 + n2 * n2 <= rad2Sq) return false
      }
      return true
    }

    const edgeInside = (east: number, north: number): number => {
      let best = radius1 - Math.sqrt(east * east + north * north)
      if (pivot2Enu !== null) {
        const e2 = east - pivot2Enu[0]
        const n2 = north - pivot2Enu[1]
        const d2e = radius2 - Math.sqrt(e2 * e2 + n2 * n2)
        if (d2e > best) best = d2e
      }
      return best
    }

    // Inner-exclusion rings (interior boundaries + pivot access road).
    const boundaryInnerRaw: unknown[] = [
      ...((getOr(field, 'boundary_inner', []) as unknown[]) || []),
      ...((getOr(field, 'access_road_boundary', []) as unknown[]) || []),
    ]
    const boundaryInnerEnu: Pt[][] = []
    for (const ringRaw of boundaryInnerRaw) {
      const ring = ringRaw as Array<[unknown, unknown]>
      if (!ring || ring.length < 3) continue
      try {
        const ringEnu = latlonListToEnu(
          ring.map((p) => [toFloat(p[0]), toFloat(p[1])] as [number, number]),
          pivotLon,
          pivotLat,
        )
        if (ringEnu.length >= 3) boundaryInnerEnu.push(ringEnu)
      } catch {
        /* skip bad ring */
      }
    }
    const boundaryInnerBbox = boundaryInnerEnu.map((r) => bboxOf(r))

    const seedAngle = toFloat(
      getOr(field, 'Planting_angle', getOr(field, 'Spray_angle', getOr(field, 'Seed_angle', 0))),
    )
    const sprayBothWays = truthy(field['spray_both_ways'])

    // Bay parameters → shelter row laterals.
    const nfRaw = String(getOr(field, 'num_female_rows', '')).trim()
    const nmRaw = String(getOr(field, 'num_male_rows', '')).trim()
    const rsInRaw = String(getOr(field, 'row_spacing_in', '')).trim()
    let bayLaterals: number[] | null = null

    let useBays = getMissing(field, 'use_bays', true)
    if (typeof useBays === 'string') {
      useBays = ['1', 'true', 'yes', 'y', 'on'].includes(useBays.trim().toLowerCase())
    } else {
      useBays = truthy(useBays)
    }

    let tentRowWidth: number
    let latOffset: number
    if (!useBays) {
      tentRowWidth = sprayerWidth
      latOffset = 0.0
    } else if (nfRaw && nmRaw && rsInRaw) {
      const nfI = toInt(nfRaw)
      const nmI = toInt(nmRaw)
      const rsM = toFloat(rsInRaw) * 0.0254
      let totalRowsI = toInt(String(getOr(field, 'total_rows', nfI + nmI) || nfI + nmI))
      const layout = String(getOr(field, 'row_layout', 'centered'))
      const custom = String(getOr(field, 'custom_row_mask', ''))
      if (layout === 'custom') {
        const cm = custom
          .toUpperCase()
          .split('')
          .filter((c) => c === 'M' || c === 'F')
          .join('')
        if (cm) totalRowsI = cm.length
      }
      const offsetM = MALE_BAY_OFFSET_FT * 0.3048
      const phase = truthy(field['pass_phase_swap']) ? 1 : 0
      let gapM: number
      try {
        gapM = Math.max(0.0, toFloat(getOr(field, 'bay_gap_in', 0))) * 0.0254
      } catch {
        gapM = 0.0
      }
      bayLaterals = maleBayShelterLaterals(
        nfI,
        nmI,
        layout,
        custom,
        totalRowsI,
        rsM,
        offsetM,
        radius,
        phase,
        gapM,
      )
      if (bayLaterals.length > 0) {
        tentRowWidth = sprayerWidth
        latOffset = 0.0
      } else {
        try {
          gapM = Math.max(0.0, toFloat(getOr(field, 'bay_gap_in', 0))) * 0.0254
        } catch {
          gapM = 0.0
        }
        tentRowWidth = (nfI + 1) * rsM + (nmI + 1) * rsM + 2.0 * gapM
        latOffset = 1.2192
      }
    } else if (boundaryEnu !== null) {
      tentRowWidth = sprayerWidth
      latOffset = 0.0
    } else {
      tentRowWidth = sprayerWidth
      latOffset = toFloat(getOr(field, 'Lateral_offset', 0)) * conv
    }

    const doRaw = String(getOr(field, 'directional_offset', '')).trim()
    const directionalOffset = doRaw ? toFloat(doRaw) * conv : 0.0

    // Shelter-count mode → num_tents / user spacing.
    const mode = String(getOr(field, 'shelter_mode', '')).trim().toLowerCase()
    let spRaw = ''
    let numTents: number | null = null
    const intOrNull = (v: unknown): number | null => {
      try {
        return Math.trunc(pyRound(toFloat(String(v).trim())))
      } catch {
        return null
      }
    }
    if (mode === 'spacing') {
      spRaw = String(getOr(field, 'spacing', '')).trim()
    } else if (mode === 'per_acre') {
      try {
        const spa = toFloat(getOr(field, 'shelters_per_acre', 0))
        const ac = toFloat(getOr(field, 'acres', 0))
        if (spa > 0 && ac > 0) numTents = Math.max(1, Math.trunc(pyRound(spa * ac)))
      } catch {
        numTents = null
      }
    } else if (mode === 'acres_per_shelter') {
      try {
        const aps = toFloat(getOr(field, 'acres_per_shelter', 0))
        const ac = toFloat(getOr(field, 'acres', 0))
        if (aps > 0 && ac > 0) numTents = Math.max(1, Math.trunc(pyRound(ac / aps)))
      } catch {
        numTents = null
      }
    } else if (mode === 'trays_1' || mode === 'trays_2') {
      try {
        const gpa = toFloat(getOr(field, 'gals_per_acre', 0))
        const gpt = toFloat(getOr(field, 'gals_per_tray', 0))
        const ac = toFloat(getOr(field, 'acres', 0))
        if (gpa > 0 && gpt > 0 && ac > 0) {
          const totalTrays = Math.ceil((gpa * ac) / gpt)
          const divisor = mode === 'trays_2' ? 2 : 1
          numTents = Math.max(1, Math.ceil(totalTrays / divisor))
        }
      } catch {
        numTents = null
      }
    } else if (mode === 'total') {
      numTents = intOrNull(getOr(field, 'num_structures', getOr(field, '# of Structures', '')))
    } else {
      spRaw = String(getOr(field, 'spacing', '')).trim()
      numTents = intOrNull(getOr(field, 'num_structures', getOr(field, '# of Structures', '')))
    }
    const userSpacing = Boolean(spRaw)

    const rotate = pymod(0 - seedAngle + 180, 360) - 180
    const rotR = (rotate * Math.PI) / 180
    const cosR = Math.cos(rotR)
    const sinR = Math.sin(rotR)

    const [easting, northing] = fromLonLat(pivotLon, pivotLat, pivotLon)

    // Corner-arm exclusion zones (ENU).
    type CornerCircle = ['circle', number, number, number]
    type CornerPath = ['path', Pt[], [number, number, number, number]]
    const cornerExcl: Array<CornerCircle | CornerPath> = []
    for (const armRaw of (getOr(field, 'corner_arms', []) as unknown[]) || []) {
      if (typeof armRaw !== 'object' || armRaw === null) continue
      const arm = armRaw as Record<string, unknown>
      if (arm['type'] === 'circle') {
        try {
          const [ce, cn] = fromLonLat(toFloat(arm['lon']), toFloat(arm['lat']), pivotLon)
          cornerExcl.push(['circle', ce - easting, cn - northing, toFloat(arm['radius_m']) ** 2])
        } catch {
          /* skip */
        }
      } else if (arm['type'] === 'path') {
        const pts = (arm['pts'] as unknown[]) || []
        if (pts.length >= 2) {
          try {
            const enuPts: Pt[] = []
            for (const pRaw of pts) {
              const p = pRaw as [unknown, unknown]
              const [pe, pn] = fromLonLat(toFloat(p[1]), toFloat(p[0]), pivotLon)
              enuPts.push([pe - easting, pn - northing])
            }
            const xs = enuPts.map((pp) => pp[0])
            const ys = enuPts.map((pp) => pp[1])
            const bbox: [number, number, number, number] = [
              Math.min(...xs) - exclM,
              Math.max(...xs) + exclM,
              Math.min(...ys) - exclM,
              Math.max(...ys) + exclM,
            ]
            cornerExcl.push(['path', enuPts, bbox])
          } catch {
            /* skip */
          }
        }
      }
    }
    const exclM2 = exclM * exclM

    const inCornerExcl = (east: number, north: number): boolean => {
      for (const zone of cornerExcl) {
        if (zone[0] === 'circle') {
          const [, ce, cn, cr2] = zone
          if ((east - ce) ** 2 + (north - cn) ** 2 < cr2) return true
        } else {
          const bb = zone[2]
          if (!(bb[0] <= east && east <= bb[1] && bb[2] <= north && north <= bb[3])) continue
          const segPts = zone[1]
          for (let j = 0; j < segPts.length - 1; j++) {
            const ax = segPts[j][0]
            const ay = segPts[j][1]
            const bx = segPts[j + 1][0]
            const by = segPts[j + 1][1]
            const dx = bx - ax
            const dy = by - ay
            const seg2 = dx * dx + dy * dy
            let px: number
            let py: number
            if (seg2 > 0) {
              const t = Math.max(0.0, Math.min(1.0, ((east - ax) * dx + (north - ay) * dy) / seg2))
              px = ax + t * dx
              py = ay + t * dy
            } else {
              px = ax
              py = ay
            }
            if ((east - px) ** 2 + (north - py) ** 2 < exclM2) return true
          }
        }
      }
      return false
    }

    // Pass-following mode is gated but NOT ported — fail loud if a field hits it.
    const planterPasses = ((getOr(field, 'planter_passes', []) as unknown[]) || []).filter(
      (p) => Array.isArray(p) && p.length >= 2,
    )
    const useImported = truthy(getMissing(field, 'use_imported_passes', true))
    if (useImported && planterPasses.length > 0 && !userSpacing && numTents && useBays) {
      throw new NotPortedError(
        'pass-following shelter placement (imported planter passes) is not ported yet — ' +
          'see maketentgrid.py lines ~2148–2546',
      )
    }

    // ── TRUE RECTANGULAR / green-zone grid (the path every real field uses) ──
    if (sprayerWidth <= 0) return [[], []]

    // Decimated boundary edges for the coarse distance band.
    let bndEdges: Array<[number, number, number, number, number]> | null = null
    if (boundaryEnu) {
      let src = boundaryEnu
      const nB = boundaryEnu.length
      if (nB > 120) {
        const k = Math.trunc((nB + 119) / 120)
        src = []
        for (let i = 0; i < nB; i += k) src.push(boundaryEnu[i])
      }
      bndEdges = []
      const mB = src.length
      for (let i = 0; i < mB; i++) {
        const ax = src[i][0]
        const ay = src[i][1]
        const bx = src[(i + 1) % mB][0]
        const by = src[(i + 1) % mB][1]
        const dx = bx - ax
        const dy = by - ay
        bndEdges.push([ax, ay, dx, dy, dx * dx + dy * dy])
      }
    }

    const minDistToBnd = (east: number, north: number): number => {
      let minD2 = Infinity
      for (const [ax, ay, dx, dy, seg2] of bndEdges!) {
        let px: number
        let py: number
        if (seg2 > 0) {
          let t = ((east - ax) * dx + (north - ay) * dy) / seg2
          if (t < 0.0) t = 0.0
          else if (t > 1.0) t = 1.0
          px = ax + t * dx
          py = ay + t * dy
        } else {
          px = ax
          py = ay
        }
        const ddx = east - px
        const ddy = north - py
        const d2 = ddx * ddx + ddy * ddy
        if (d2 < minD2) minD2 = d2
      }
      return Math.sqrt(minD2)
    }

    const rMax = Math.trunc(radius / sprayerWidth) + 2
    const exclMSafe = exclM + 0.01

    let passEdgeBufferM: number
    try {
      passEdgeBufferM = toFloat(getOr(field, 'pass_edge_buffer_ft', 25)) * 0.3048
    } catch {
      passEdgeBufferM = 25.0 * 0.3048
    }
    const bufferEnabled = passEdgeBufferM > 0
    const passDeadHalf = Math.max(0.0, sprayerWidth / 2.0 - passEdgeBufferM)
    const opEdgeM = passEdgeBufferM > 0 ? passEdgeBufferM : 0.0

    const SNAP_MAX_M = 40.0
    const SNAP_STEP_M = 0.5

    const inOuterBand = (east: number, north: number): boolean => {
      if (opEdgeM <= 0) return false
      if (boundaryEnu) return minDistToBnd(east, north) <= opEdgeM
      return edgeInside(east, north) <= opEdgeM
    }

    const baseValid = (east: number, north: number): boolean => {
      const [dnSq, innerR2N, tracksN] = nearestPivot(east, north)
      if (dnSq < innerR2N) return false
      if (bufferEnabled && passDeadHalf > 0 && sprayerWidth > 0) {
        const latE = east * cosR + north * sinR
        let frac = latE / sprayerWidth
        frac -= Math.floor(frac)
        const dCenter = Math.abs(frac - 0.5) * sprayerWidth
        if (dCenter < passDeadHalf && !inOuterBand(east, north)) return false
      }
      if (tracksN.length > 0) {
        const d = Math.sqrt(dnSq)
        for (const tr of tracksN) {
          let diff = d - tr
          if (diff < 0) diff = -diff
          if (diff < exclMSafe) return false
        }
      }
      if (cornerExcl.length > 0 && inCornerExcl(east, north)) return false
      return true
    }

    const outsideOk = (east: number, north: number): boolean => {
      if (!outsidePass) return true
      const dB = boundaryEnu ? minDistToBnd(east, north) : edgeInside(east, north)
      if (opEdgeM < dB && dB < sprayerWidth - opEdgeM) return false
      return true
    }

    const valid = (east: number, north: number): boolean =>
      baseValid(east, north) && outsideOk(east, north)

    const inside = (east: number, north: number): boolean => {
      if (boundaryEnu) {
        if (!pointInPolygonBB(east, north, boundaryEnu, boundaryEnuBbox!)) return false
      } else if (outsideFieldCircles(east, north)) {
        return false
      }
      for (let i = 0; i < boundaryInnerEnu.length; i++) {
        if (pointInPolygonBB(east, north, boundaryInnerEnu[i], boundaryInnerBbox[i])) return false
      }
      return true
    }

    const snapAlongPreN = (preE: number, preN0: number): number | null => {
      const steps = Math.trunc(SNAP_MAX_M / SNAP_STEP_M)
      const cands: Array<[number, number, number]> = []
      for (const sign of [1, -1]) {
        for (let i = 1; i <= steps; i++) {
          const delta = i * SNAP_STEP_M
          const newPreN = preN0 + sign * delta
          const east = preE * cosR - newPreN * sinR
          const north = newPreN * cosR + preE * sinR
          if (!inside(east, north)) continue
          if (!valid(east, north)) continue
          const dB = boundaryEnu ? minDistToBnd(east, north) : edgeInside(east, north)
          cands.push([i, -dB, newPreN])
          break
        }
      }
      if (cands.length === 0) return null
      cands.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      return cands[0][2]
    }

    const snappableCoarse = (preE: number, preN0: number): boolean => {
      const steps = Math.trunc(SNAP_MAX_M)
      for (let i = 1; i <= steps; i++) {
        for (const sign of [1, -1]) {
          const newPreN = preN0 + sign * i
          const east = preE * cosR - newPreN * sinR
          const north = newPreN * cosR + preE * sinR
          if (inside(east, north) && valid(east, north)) return true
        }
      }
      return false
    }

    const nudgeOutOfKillzone = (x: number): number => {
      if (!(bufferEnabled && passDeadHalf > 0 && sprayerWidth > 0)) return x
      const c = (Math.floor(x / sprayerWidth) + 0.5) * sprayerWidth
      const d = x - c
      if (Math.abs(d) >= passDeadHalf) return x
      const margin = passDeadHalf + 0.02
      return c + (d >= 0 ? margin : -margin)
    }

    // Lateral row positions (columns). Each entry = [preE, rowIndex].
    let rowList: Array<[number, number]> = []
    const seenRows = new Set<number>()
    if (bayLaterals) {
      for (let r = -rMax; r <= rMax; r++) {
        const edge = r * sprayerWidth
        let preE = minByKey(bayLaterals, (v) => Math.abs(v - edge))
        preE = nudgeOutOfKillzone(preE)
        const key = pyRound(preE, 3)
        if (seenRows.has(key)) continue
        seenRows.add(key)
        rowList.push([preE, rowList.length])
      }
    } else {
      for (let r = -rMax; r <= rMax; r++) {
        const edge = r * sprayerWidth
        const k = pyRound((edge - latOffset) / tentRowWidth)
        let preE = k * tentRowWidth + latOffset
        preE = nudgeOutOfKillzone(preE)
        const key = pyRound(preE, 3)
        if (seenRows.has(key)) continue
        seenRows.add(key)
        rowList.push([preE, k])
      }
    }

    // Optional user override of column count (the "Grid rows" stepper).
    let forcedRows = 0
    try {
      forcedRows = Math.trunc(toFloat(getOr(field, 'shelter_rows', 0)))
    } catch {
      forcedRows = 0
    }
    let colsReduced = false
    if (forcedRows > 0 && numTents && rowList.length > 1) {
      if (boundaryEnu) {
        const latC = boundaryEnu.map(([e, n]) => e * cosR + n * sinR)
        const latMin = Math.min(...latC)
        const latMax = Math.max(...latC)
        const infield = rowList.filter((rc) => latMin <= rc[0] && rc[0] <= latMax)
        if (infield.length >= 2) rowList = infield
      }
      const wantCols = Math.max(
        1,
        Math.min(rowList.length, Math.trunc(pyRound((2.0 * numTents) / forcedRows))),
      )
      if (wantCols < rowList.length) {
        let idxs: number[]
        if (wantCols === 1) {
          idxs = [Math.trunc(rowList.length / 2)]
        } else {
          const stride = (rowList.length - 1) / (wantCols - 1)
          idxs = Array.from(new Set(Array.from({ length: wantCols }, (_, i) => Math.trunc(pyRound(i * stride))))).sort(
            (a, b) => a - b,
          )
        }
        rowList = idxs.map((i) => rowList[i])
        colsReduced = true
      }
    }

    // Centre the along-pass spacing grid on the FIELD.
    let pnCenter: number
    let pnHalf: number
    if (boundaryEnu) {
      const pnVals = boundaryEnu.map(([e, n]) => -e * sinR + n * cosR)
      pnCenter = (Math.min(...pnVals) + Math.max(...pnVals)) / 2.0
      pnHalf = (Math.max(...pnVals) - Math.min(...pnVals)) / 2.0
    } else {
      pnCenter = 0.0
      pnHalf = radius
    }

    const countAtLeast = (nSp: number, target: number): boolean => {
      if (nSp <= 0) return false
      const cMax = Math.trunc(pnHalf / nSp) + 2
      let total = 0
      for (let idx = 0; idx < rowList.length; idx++) {
        const preE = rowList[idx][0]
        const nStagger = idx % 2 ? nSp / 2 : 0.0
        for (let c = -cMax; c <= cMax; c++) {
          const preN = pnCenter + c * nSp + directionalOffset + nStagger
          const east = preE * cosR - preN * sinR
          const north = preN * cosR + preE * sinR
          if (!inside(east, north)) continue
          if (baseValid(east, north)) {
            if (!outsideOk(east, north)) continue
            total += 1
            if (total >= target) return true
          } else if (snappableCoarse(preE, preN)) {
            total += 1
            if (total >= target) return true
          }
        }
      }
      return false
    }

    // ── N-S spacing ─────────────────────────────────────────────────────────
    let nsSpacing: number
    if (userSpacing) {
      nsSpacing = Math.max(1.0, toFloat(spRaw) * conv)
    } else if (numTents) {
      let lo = 1.0
      let hi = radius * 2.0
      if (!countAtLeast(lo, numTents)) {
        nsSpacing = lo
      } else {
        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2
          if (countAtLeast(mid, numTents)) lo = mid
          else hi = mid
        }
        nsSpacing = lo
      }

      // Auto-balance for very sparse layouts.
      if (!colsReduced && nsSpacing > radius * 2.0 && rowList.length > 1) {
        if (boundaryEnu) {
          const latC = boundaryEnu.map(([e, n]) => e * cosR + n * sinR)
          const latMin = Math.min(...latC)
          const latMax = Math.max(...latC)
          const infield = rowList.filter((rc) => latMin <= rc[0] && rc[0] <= latMax)
          if (infield.length >= 2) rowList = infield
        } else {
          const infield = rowList.filter((rc) => Math.abs(rc[0]) < radius / 1.05)
          if (infield.length >= 2) rowList = infield
        }
        const targetCols = Math.max(1, pyRound(Math.sqrt(numTents)))
        if (targetCols < rowList.length) {
          if (targetCols === 1) {
            rowList = [rowList[Math.trunc(rowList.length / 2)]]
          } else {
            const stride = (rowList.length - 1) / (targetCols - 1)
            const idxs = Array.from(
              new Set(Array.from({ length: targetCols }, (_, i) => Math.trunc(pyRound(i * stride)))),
            ).sort((a, b) => a - b)
            rowList = idxs.map((i) => rowList[i])
          }
        }
        lo = 1.0
        hi = radius * 2.0
        if (!countAtLeast(lo, numTents)) {
          nsSpacing = lo
        } else {
          for (let i = 0; i < 32; i++) {
            const mid = (lo + hi) / 2
            if (countAtLeast(mid, numTents)) lo = mid
            else hi = mid
          }
          nsSpacing = lo
        }
      }
    } else {
      nsSpacing = Math.max(1.0, calculateSpacing(radius, sprayerWidth))
    }

    // ── Generate the final grid ───────────────────────────────────────────────
    let raw: Array<[number, number, number]> = []
    if (sprayBothWays) {
      // SQUARE grid locked to sprayer passes in both axes (rare; unexercised).
      let loLat: number
      let hiLat: number
      let loPrn: number
      let hiPrn: number
      if (boundaryEnu) {
        const latC = boundaryEnu.map(([e, n]) => e * cosR + n * sinR)
        const prnC = boundaryEnu.map(([e, n]) => -e * sinR + n * cosR)
        loLat = Math.min(...latC)
        hiLat = Math.max(...latC)
        loPrn = Math.min(...prnC)
        hiPrn = Math.max(...prnC)
      } else {
        loLat = -radius
        hiLat = radius
        loPrn = -radius
        hiPrn = radius
      }
      const inset = bufferEnabled ? Math.min(passEdgeBufferM, MALE_BAY_OFFSET_FT * 0.3048) : 0.0

      const rectGrid = (kl: number, ka: number): Array<[number, number, number]> => {
        const stepL = kl * sprayerWidth
        const stepA = ka * sprayerWidth
        const out: Array<[number, number, number]> = []
        const i0 = Math.floor(loLat / stepL) - 1
        const i1 = Math.ceil(hiLat / stepL) + 1
        const j0 = Math.floor((loPrn - directionalOffset) / stepA) - 1
        const j1 = Math.ceil((hiPrn - directionalOffset) / stepA) + 1
        for (let i = i0; i <= i1; i++) {
          const preE = i * stepL + inset
          for (let j = j0; j <= j1; j++) {
            const preN = j * stepA + inset + directionalOffset
            const east = preE * cosR - preN * sinR
            const north = preN * cosR + preE * sinR
            if (!inside(east, north)) continue
            if (!baseValid(east, north)) continue
            if (!outsideOk(east, north)) continue
            out.push([east, north, i])
          }
        }
        return out
      }

      if (numTents && numTents > 0) {
        const cand: Array<[number, number, number, Array<[number, number, number]>]> = []
        for (let kl = 1; kl < 13; kl++) {
          for (let ka = 1; ka < 13; ka++) {
            const g = rectGrid(kl, ka)
            cand.push([g.length, kl, ka, g])
            if (g.length <= numTents) break
          }
        }
        const over = cand.filter((c) => c[0] >= numTents!)
        let best: [number, number, number, Array<[number, number, number]>]
        if (over.length > 0) {
          best = over.reduce((m, c) =>
            c[0] < m[0] || (c[0] === m[0] && Math.abs(c[1] - c[2]) < Math.abs(m[1] - m[2])) ? c : m,
          )
        } else {
          best = cand.reduce((m, c) => (c[0] > m[0] ? c : m))
        }
        raw = best[3]
      } else {
        const auto = Math.max(1, Math.trunc(pyRound(calculateSpacing(radius, sprayerWidth) / sprayerWidth)))
        raw = rectGrid(auto, auto)
      }
    } else {
      const cMax = Math.trunc(pnHalf / nsSpacing) + 2
      for (let idx = 0; idx < rowList.length; idx++) {
        const preE = rowList[idx][0]
        const nStagger = idx % 2 ? nsSpacing / 2 : 0.0
        for (let c = -cMax; c <= cMax; c++) {
          const preN = pnCenter + c * nsSpacing + directionalOffset + nStagger
          const east = preE * cosR - preN * sinR
          const north = preN * cosR + preE * sinR
          if (!inside(east, north)) continue
          if (baseValid(east, north)) {
            if (!outsideOk(east, north)) continue
            raw.push([east, north, idx])
          } else {
            const snapped = snapAlongPreN(preE, preN)
            if (snapped !== null) {
              const newE = preE * cosR - snapped * sinR
              const newN = snapped * cosR + preE * sinR
              raw.push([newE, newN, idx])
            }
          }
        }
      }
    }

    if (raw.length === 0) return [[], []]

    // Keep OUTER columns symmetric about the field centre.
    if (!sprayBothWays && boundaryEnu && nsSpacing > 0 && rowList.length > 1) {
      const colPitch = nsSpacing / 2.0
      const cols = new Map<number, Pt[]>()
      for (const [e, n] of raw) {
        const pn = -e * sinR + n * cosR
        const key = pyRound((pn - pnCenter) / colPitch)
        if (!cols.has(key)) cols.set(key, [])
        cols.get(key)!.push([e, n])
      }
      const spans = new Map<number, number>()
      for (const [c, v] of cols) {
        let mn = Infinity
        let mx = -Infinity
        for (const [e, n] of v) {
          const l = e * cosR + n * sinR
          if (l < mn) mn = l
          if (l > mx) mx = l
        }
        spans.set(c, mx - mn)
      }
      let full = 0.0
      for (const s of spans.values()) if (s > full) full = s

      const sliver = (c: number): boolean =>
        !cols.has(c) || (full > 0 && spans.get(c)! < 0.55 * full && cols.get(c)!.length <= 2)

      const keep = new Set<number>()
      if (cols.has(0)) keep.add(0)
      let maxAbs = 0
      for (const c of cols.keys()) if (Math.abs(c) > maxAbs) maxAbs = Math.abs(c)
      for (let m = 1; m <= maxAbs; m++) {
        if (cols.has(m) && cols.has(-m) && !sliver(m) && !sliver(-m)) {
          keep.add(m)
          keep.add(-m)
        }
      }
      const rebuilt: Array<[number, number, number]> = []
      for (const [c, v] of cols) {
        if (!keep.has(c)) continue
        for (const [e, n] of v) rebuilt.push([e, n, pyRound(e * cosR + n * sinR, 0)])
      }
      if (rebuilt.length > 0) raw = rebuilt
    }

    const ldx = cosR
    const ldy = sinR
    const tdx = -sinR
    const tdy = cosR

    const rowGroups = new Map<number, Pt[]>()
    for (const [e, n, r] of raw) {
      if (!rowGroups.has(r)) rowGroups.set(r, [])
      rowGroups.get(r)!.push([e, n])
    }

    const rowLatCoord = (r: number): number => {
      const pts = rowGroups.get(r)!
      let s = 0
      for (const [e, n] of pts) s += e * ldx + n * ldy
      return s / pts.length
    }
    const sortedRows = sortedByKey(Array.from(rowGroups.keys()), rowLatCoord)

    const travelNw = tdx * -1 + tdy * 1
    const firstRowDescending = travelNw > 0
    let ordered: Pt[] = []
    let orderedRows: number[] = []
    for (let i = 0; i < sortedRows.length; i++) {
      const r = sortedRows[i]
      let pts = sortedByKey(rowGroups.get(r)!, ([e, n]) => e * tdx + n * tdy)
      const descending =
        (i % 2 === 0 && firstRowDescending) || (i % 2 === 1 && !firstRowDescending)
      if (descending) pts = pts.slice().reverse()
      ordered.push(...pts)
      for (let k = 0; k < pts.length; k++) orderedRows.push(i)
    }

    // Trim to exactly num_tents, keeping the pins closest to the pivot.
    if (numTents !== null && ordered.length > numTents && numTents > 0) {
      const byRadius = sortedByKey(
        Array.from({ length: ordered.length }, (_, i) => i),
        (i) => ordered[i][0] * ordered[i][0] + ordered[i][1] * ordered[i][1],
      )
      const keep = new Set(byRadius.slice(0, numTents))
      const newOrdered: Pt[] = []
      const newRows: number[] = []
      for (let i = 0; i < ordered.length; i++) {
        if (keep.has(i)) {
          newOrdered.push(ordered[i])
          newRows.push(orderedRows[i])
        }
      }
      ordered = newOrdered
      orderedRows = newRows
    }

    // Convert to lat/lon; drop any pin that leaves the boundary after round-trip.
    const result: Pt[] = []
    const keptRows: number[] = []
    for (let i = 0; i < ordered.length; i++) {
      const [e, n] = ordered[i]
      const rowIdx = orderedRows[i]
      const [lon, lat] = toLonLat(e + easting, n + northing, pivotLon)
      if (boundaryEnu) {
        let [reE, reN] = fromLonLat(lon, lat, pivotLon)
        reE -= easting
        reN -= northing
        if (!pointInPolygon(reE, reN, boundaryEnu)) continue
        let inInner = false
        for (const ring of boundaryInnerEnu) {
          if (pointInPolygon(reE, reN, ring)) {
            inInner = true
            break
          }
        }
        if (inInner) continue
      }
      result.push([lat, lon])
      keptRows.push(rowIdx)
    }

    if (truthy(field['shelter_at_pivot'])) {
      result.push([toFloat(field['PP_Latitude']), toFloat(field['PP_Longitude'])])
      keptRows.push(-1)
    }

    return [result, keptRows]
  } catch (err) {
    if (err instanceof NotPortedError) throw err
    return [[], []]
  }
}
