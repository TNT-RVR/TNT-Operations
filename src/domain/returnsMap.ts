/**
 * Interpolated bee-return surface for a field — the thing that used to be a
 * manual QGIS job.
 *
 * Blocks are weighed at scattered points; this fills the space between them so
 * you can see which parts of a field produced. Pure maths, no map library, no
 * React — the renderer just paints whatever grid comes out.
 *
 * Method: IDW (inverse distance weighting), the usual QGIS default. Each cell
 * is a weighted average of the sample points, weight 1/d^power. Predictable and
 * explainable, which matters when the output drives a grower conversation:
 * every cell traces back to "the nearby blocks, nearer ones counting more".
 *
 * What IDW will NOT do: invent detail between distant blocks, or extrapolate
 * meaningfully far outside the sampled area. Sparse fields produce smooth
 * blobs, which is honest — it's what the data supports.
 */
import { latlonListToEnu } from './geo'
import { fieldFrame, pointInEnuRing, enuToLonLat, type FieldFrame } from './fieldFrame'
import type { FieldDict } from './tentGrid'

/** One weighed block: where it was, and what it returned. */
export interface SamplePoint {
  lng: number
  lat: number
  /** Bee return in lbs (gross − stripped). */
  value: number
  /** For labelling the point on the map. */
  label?: string
}

export interface IdwOptions {
  /** Grid resolution in metres. Smaller = smoother and slower. */
  cellM?: number
  /** Distance exponent. 2 is the QGIS default; higher = more local. */
  power?: number
  /**
   * Ignore samples further than this from a cell. Null = every sample counts.
   * A radius keeps a far-off corner from being tinted by blocks hundreds of
   * metres away, which reads as data where there is none.
   */
  maxDistanceM?: number | null
  /** Safety cap on total cells, so a huge field can't lock up the browser. */
  maxCells?: number
  /**
   * How many nearest samples actually contribute to a cell.
   *
   * Naive IDW weighs EVERY sample for EVERY cell, which is O(cells × samples)
   * — fine for a dozen blocks, ruinous for thousands (a 250k-cell grid over
   * 4,000 points is ~1e9 distance calculations, which locks the tab). Distant
   * samples contribute almost nothing at power 2 anyway, so taking the nearest
   * N through a spatial index gives the same picture in a fraction of the time.
   * This is also what QGIS's IDW offers as "N nearest neighbours".
   */
  maxNeighbors?: number
}

export interface ReturnsGrid {
  cols: number
  rows: number
  /** Cell size actually used (may be coarsened to respect maxCells). */
  cellM: number
  /** Row-major values; NaN where the cell is outside the field. */
  values: Float64Array
  /** Range across valid cells, for the colour scale. */
  min: number
  max: number
  /** Corner coordinates [NW, NE, SE, SW] as [lng, lat], for georeferencing. */
  corners: Array<[number, number]>
  /** Samples projected into the same ENU frame, for drawing the points. */
  samplesEnu: Array<{ e: number; n: number; value: number; label?: string }>
  /** ENU origin of the grid, so a cell index can be turned back into a place. */
  originE: number
  originN: number
  frame: FieldFrame
}

const DEFAULTS: Required<Omit<IdwOptions, 'maxDistanceM'>> & { maxDistanceM: number | null } = {
  cellM: 10,
  power: 2,
  maxDistanceM: null,
  maxCells: 250_000,
  // Measured against brute force over 3,947 points: 128 neighbours costs ~30ms
  // and lands within 0.46 lbs worst-case (0.10 mean) of weighing every point,
  // where 16 neighbours drifted by 1.2 lbs. Fidelity matters more than the
  // extra 15ms when the output is compared against a QGIS map.
  maxNeighbors: 128,
}

/**
 * Uniform-grid spatial index over the samples, so a cell only has to look at
 * points that are actually near it instead of the whole set.
 */
class SampleIndex {
  private bins = new Map<number, number[]>()
  private binSize: number
  private cols: number
  private minE: number
  private minN: number

  constructor(
    pts: Array<{ e: number; n: number; value: number }>,
    minE: number,
    minN: number,
    width: number,
    height: number,
  ) {
    this.minE = minE
    this.minN = minN
    // Aim for a handful of points per bin: enough that a ring search finds
    // neighbours quickly, few enough that each bin stays cheap to scan.
    const target = Math.max(1, Math.ceil(Math.sqrt(pts.length / 4)))
    this.binSize = Math.max(1, Math.max(width, height) / target)
    this.cols = Math.max(1, Math.ceil(width / this.binSize))
    for (let i = 0; i < pts.length; i++) {
      const key = this.keyOf(pts[i].e, pts[i].n)
      const arr = this.bins.get(key)
      if (arr) arr.push(i)
      else this.bins.set(key, [i])
    }
  }

  private keyOf(e: number, n: number): number {
    const bx = Math.floor((e - this.minE) / this.binSize)
    const by = Math.floor((n - this.minN) / this.binSize)
    return by * this.cols + bx
  }

  /**
   * Indices of samples near (e, n): expanding ring search until enough
   * candidates are found, then one extra ring so a nearer point in a diagonal
   * bin can't be missed.
   */
  near(e: number, n: number, want: number, maxRings: number): number[] {
    const bx = Math.floor((e - this.minE) / this.binSize)
    const by = Math.floor((n - this.minN) / this.binSize)
    const found: number[] = []
    let extra = -1
    for (let r = 0; r <= maxRings; r++) {
      for (let y = by - r; y <= by + r; y++) {
        for (let x = bx - r; x <= bx + r; x++) {
          // Only the ring's perimeter — the interior was covered already.
          if (r > 0 && Math.abs(y - by) !== r && Math.abs(x - bx) !== r) continue
          const arr = this.bins.get(y * this.cols + x)
          if (arr) found.push(...arr)
        }
      }
      if (extra >= 0) break // that was the safety ring
      if (found.length >= want) extra = r // do one more, then stop
    }
    return found
  }
}

/**
 * Interpolate `samples` across `field`, clipped to its boundary.
 *
 * Returns null when there's nothing to draw — no geometry, or no samples. A
 * single sample produces a flat surface, which is correct: one measurement
 * says the same thing everywhere.
 */
export function idwGrid(field: FieldDict, samples: SamplePoint[], opts: IdwOptions = {}): ReturnsGrid | null {
  const o = { ...DEFAULTS, ...opts }
  const frame = fieldFrame(field)
  if (!frame) return null

  const usable = samples.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.value),
  )
  if (usable.length === 0) return null

  // Everything happens in ENU metres about the field's pivot, so distances are
  // real metres rather than degrees (which are not equal in x and y).
  const enu = latlonListToEnu(
    usable.map((s) => [s.lat, s.lng] as [number, number]),
    frame.pivotLon,
    frame.pivotLat,
  )
  const samplesEnu = usable.map((s, i) => ({ e: enu[i][0], n: enu[i][1], value: s.value, label: s.label }))

  // Extent: the boundary when there is one, otherwise the pivot radius.
  let minE: number
  let maxE: number
  let minN: number
  let maxN: number
  if (frame.boundaryEnu && frame.boundaryEnu.length >= 3) {
    minE = Infinity
    maxE = -Infinity
    minN = Infinity
    maxN = -Infinity
    for (const [e, n] of frame.boundaryEnu) {
      minE = Math.min(minE, e)
      maxE = Math.max(maxE, e)
      minN = Math.min(minN, n)
      maxN = Math.max(maxN, n)
    }
  } else {
    minE = -frame.radius
    maxE = frame.radius
    minN = -frame.radius
    maxN = frame.radius
  }

  const width = maxE - minE
  const height = maxN - minN
  if (!(width > 0) || !(height > 0)) return null

  // Coarsen rather than refuse, if the field is big enough to blow the budget.
  let cellM = Math.max(1, o.cellM)
  let cols = Math.ceil(width / cellM)
  let rows = Math.ceil(height / cellM)
  if (cols * rows > o.maxCells) {
    const scale = Math.sqrt((cols * rows) / o.maxCells)
    cellM = cellM * scale
    cols = Math.ceil(width / cellM)
    rows = Math.ceil(height / cellM)
  }

  const values = new Float64Array(cols * rows).fill(NaN)
  const ring = frame.boundaryEnu
  const r2 = frame.radius * frame.radius
  const maxD2 = o.maxDistanceM == null ? Infinity : o.maxDistanceM * o.maxDistanceM
  const halfPower = o.power / 2
  const isSquare = o.power === 2
  const index = new SampleIndex(samplesEnu, minE, minN, width, height)
  /** Cap the ring search so a lone cell in an empty corner can't scan forever. */
  const MAX_RINGS = 12
  let min = Infinity
  let max = -Infinity

  for (let ry = 0; ry < rows; ry++) {
    // Row 0 is the TOP of the image (north), so northing counts down.
    const n = maxN - (ry + 0.5) * cellM
    for (let cx = 0; cx < cols; cx++) {
      const e = minE + (cx + 0.5) * cellM

      // Clip to the field: inside the boundary ring, or inside the pivot circle.
      const inside = ring && ring.length >= 3 ? pointInEnuRing(ring, e, n) : e * e + n * n <= r2
      if (!inside) continue

      const candidates = index.near(e, n, o.maxNeighbors, MAX_RINGS)

      // Nearest N only. With many samples the far ones contribute ~nothing at
      // power 2, and considering them all is what made this unusable.
      let num = 0
      let den = 0
      let exact = NaN
      if (candidates.length > o.maxNeighbors) {
        // Partial selection: distance to each candidate, then take the closest N.
        const scored: Array<[number, number]> = []
        for (const i of candidates) {
          const s = samplesEnu[i]
          const de = e - s.e
          const dn = n - s.n
          scored.push([de * de + dn * dn, i])
        }
        scored.sort((a, b) => a[0] - b[0])
        for (let k = 0; k < o.maxNeighbors; k++) {
          const [d2, i] = scored[k]
          if (d2 > maxD2) break
          if (d2 < 1e-9) {
            exact = samplesEnu[i].value
            break
          }
          // pow(d2, power/2) is the general form; power 2 is the common case
          // and reduces to plain 1/d2, avoiding a Math.pow per sample per cell.
          const w = isSquare ? 1 / d2 : 1 / Math.pow(d2, halfPower)
          num += w * samplesEnu[i].value
          den += w
        }
      } else {
        for (const i of candidates) {
          const s = samplesEnu[i]
          const de = e - s.e
          const dn = n - s.n
          const d2 = de * de + dn * dn
          if (d2 > maxD2) continue
          if (d2 < 1e-9) {
            // Sitting on a sample: use it rather than dividing by zero.
            exact = s.value
            break
          }
          const w = isSquare ? 1 / d2 : 1 / Math.pow(d2, halfPower)
          num += w * s.value
          den += w
        }
      }

      const v = Number.isFinite(exact) ? exact : den > 0 ? num / den : NaN
      if (!Number.isFinite(v)) continue // no sample within maxDistanceM
      values[ry * cols + cx] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  if (!Number.isFinite(min)) return null // nothing landed inside the field

  const corners: Array<[number, number]> = [
    enuToLonLat(frame, minE, maxN), // NW
    enuToLonLat(frame, maxE, maxN), // NE
    enuToLonLat(frame, maxE, minN), // SE
    enuToLonLat(frame, minE, minN), // SW
  ]

  return { cols, rows, cellM, values, min, max, corners, samplesEnu, originE: minE, originN: maxN, frame }
}

/**
 * A stand-in "field" that just covers the sample points, for data imported
 * from elsewhere. Without this, interpolating anything that isn't inside a
 * field we already hold geometry for would clip to nothing.
 *
 * `bufferM` extends the area past the outermost point. Keep it modest — IDW
 * beyond the sampled area is extrapolation, and extrapolation is guesswork.
 */
export function syntheticField(samples: SamplePoint[], bufferM = 100): FieldDict | null {
  const usable = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  if (usable.length === 0) return null

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const s of usable) {
    minLat = Math.min(minLat, s.lat)
    maxLat = Math.max(maxLat, s.lat)
    minLng = Math.min(minLng, s.lng)
    maxLng = Math.max(maxLng, s.lng)
  }
  const midLat = (minLat + maxLat) / 2
  const midLng = (minLng + maxLng) / 2

  // Degrees per metre at this latitude — good enough for a bounding box.
  const dLat = bufferM / 111_320
  const dLng = bufferM / (111_320 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)))

  return {
    PP_Latitude: String(midLat),
    PP_Longitude: String(midLng),
    use_bays: false,
    boundary_polygon: [
      [minLat - dLat, minLng - dLng],
      [maxLat + dLat, minLng - dLng],
      [maxLat + dLat, maxLng + dLng],
      [minLat - dLat, maxLng + dLng],
    ],
  } as FieldDict
}

/**
 * Whether a grid's corners are real places MapLibre will accept.
 *
 * The ENU projection is LOCAL: accurate over a field, meaningless over a
 * continent. One stray point (a 0,0 row, a mistyped decimal) can stretch the
 * extent far enough that the maths returns latitudes past ±90 — which throws
 * inside the map library and takes the whole view down. Checked before
 * anything is handed over, so bad data degrades to a message instead.
 */
export function cornersValid(corners: Array<[number, number]>): boolean {
  return (
    corners.length === 4 &&
    corners.every(
      ([lng, lat]) =>
        Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
    )
  )
}

/** Rough width/height of the mapped area in metres — for a sanity warning. */
export function gridExtentM(g: ReturnsGrid): { widthM: number; heightM: number } {
  return { widthM: g.cols * g.cellM, heightM: g.rows * g.cellM }
}

/** Summary stats for the legend and the field comparison table. */
export interface GridStats {
  /** Cells inside the field that got a value. */
  cells: number
  min: number
  max: number
  mean: number
  /** Field area covered by the interpolation, in acres. */
  acres: number
}

const SQM_PER_ACRE = 4046.8564224

export function gridStats(g: ReturnsGrid): GridStats {
  let n = 0
  let sum = 0
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i]
    if (!Number.isFinite(v)) continue
    n++
    sum += v
  }
  return {
    cells: n,
    min: g.min,
    max: g.max,
    mean: n > 0 ? sum / n : NaN,
    acres: (n * g.cellM * g.cellM) / SQM_PER_ACRE,
  }
}

/**
 * Colour ramp, low → high. Deliberately NOT red-green: red-green is the single
 * most common form of colour blindness, and "which end is bad" has to survive
 * being printed and photocopied for a grower.
 */
export const RAMP: Array<[number, number, number]> = [
  [49, 54, 149], // deep blue — lowest
  [69, 117, 180],
  [116, 173, 209],
  [171, 217, 233],
  [254, 224, 144],
  [253, 174, 97],
  [244, 109, 67],
  [165, 0, 38], // deep red — highest
]

/** Sample the ramp at t ∈ [0,1], linearly between stops. */
export function rampColor(t: number): [number, number, number] {
  if (!Number.isFinite(t)) return [0, 0, 0]
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Grid → CSV of lng,lat,value for every filled cell, so the surface can still
 * go into QGIS or anything else. One row per cell centre.
 */
export function gridToCsv(g: ReturnsGrid): string {
  const out: string[] = ['lng,lat,return_lbs']
  for (let ry = 0; ry < g.rows; ry++) {
    for (let cx = 0; cx < g.cols; cx++) {
      const v = g.values[ry * g.cols + cx]
      if (!Number.isFinite(v)) continue
      const e = g.originE + (cx + 0.5) * g.cellM
      const n = g.originN - (ry + 0.5) * g.cellM
      const [lng, lat] = enuToLonLat(g.frame, e, n)
      out.push(`${lng.toFixed(7)},${lat.toFixed(7)},${v.toFixed(4)}`)
    }
  }
  return out.join('\n')
}
