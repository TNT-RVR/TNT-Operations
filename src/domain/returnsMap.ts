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
  /**
   * The placement this came from, when it came from one.
   *
   * Absent on imported spreadsheet rows — those are coordinates and a number
   * with no record behind them. Carrying it lets a click on the map open the
   * real block rather than re-deriving one by matching coordinates back, which
   * is guesswork the moment two blocks share a fix.
   */
  placementId?: string
}

export interface IdwOptions {
  /** Grid resolution in metres. Smaller = smoother and slower. */
  cellM?: number
  /** Distance exponent. 2 is the QGIS default; higher = more local. */
  power?: number
  /**
   * Ignore samples further than this when averaging. Null = the nearest
   * `maxNeighbors` all count, whatever their distance.
   *
   * NOTE: this is NOT the edge trim — see `clipDistanceM`. Confusing the two
   * produces a disc of flat colour around every block ("polka dots"), because
   * a cell that can only reach one sample just returns that sample's value
   * instead of blending between blocks.
   */
  maxDistanceM?: number | null
  /**
   * Leave a cell empty when the NEAREST sample is further than this.
   *
   * Purely a mask on where the surface is drawn — it does not change any value
   * that is drawn. This is what stops a rectangular grid squaring off a round
   * field, while the interpolation itself still blends across blocks normally.
   */
  clipDistanceM?: number | null
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
  /**
   * Row-major interpolated values. Computed a little BEYOND the field edge on
   * purpose: the renderer decides the boundary per pixel, and it needs values
   * either side of that line to sample cleanly. Without the overspill the edge
   * falls back to the cell grid and looks like stair-steps.
   */
  values: Float64Array
  /** 1 where the cell is genuinely inside the field — the honest extent. */
  mask: Uint8Array
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

const DEFAULTS: Required<Omit<IdwOptions, 'maxDistanceM' | 'clipDistanceM'>> & {
  maxDistanceM: number | null
  clipDistanceM: number | null
} = {
  cellM: 10,
  power: 2,
  maxDistanceM: null,
  clipDistanceM: null,
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

/** Roughly within `pad` metres of the field edge, from either side. */
function nearBoundary(
  ring: Array<[number, number]> | null,
  r2: number,
  e: number,
  n: number,
  pad: number,
): boolean {
  if (ring && ring.length >= 3) {
    // Cheap proximity test against the ring's segments.
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[(i + 1) % ring.length]
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      let t = len2 === 0 ? 0 : ((e - ax) * dx + (n - ay) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      if (Math.hypot(e - (ax + t * dx), n - (ay + t * dy)) <= pad) return true
    }
    return false
  }
  const r = Math.sqrt(r2)
  return Math.abs(Math.hypot(e, n) - r) <= pad
}

/**
 * Whether an ENU point lies inside the field: within the boundary ring when
 * one is defined, otherwise within the pivot radius.
 *
 * Exported so the renderer can test EVERY OUTPUT PIXEL rather than every grid
 * cell. Testing per cell means the boundary is drawn at the interpolation
 * resolution, which turns a pivot's circle into visible stair-steps; testing
 * per pixel gives a true circle (or true straight edges) whatever the grid.
 */
export function insideField(frame: FieldFrame, e: number, n: number): boolean {
  const ring = frame.boundaryEnu
  if (ring && ring.length >= 3) return pointInEnuRing(ring, e, n)
  return e * e + n * n <= frame.radius * frame.radius
}

/**
 * Value at an arbitrary ENU position, bilinearly interpolated between grid
 * cells. NaN when any corner is missing, so the surface fades out rather than
 * smearing values across a hole.
 */
export function sampleGrid(g: ReturnsGrid, e: number, n: number): number {
  const fx = (e - g.originE) / g.cellM - 0.5
  const fy = (g.originN - n) / g.cellM - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0

  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return NaN
    return g.values[y * g.cols + x]
  }
  const v00 = at(x0, y0)
  const v10 = at(x0 + 1, y0)
  const v01 = at(x0, y0 + 1)
  const v11 = at(x0 + 1, y0 + 1)
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    // On the very edge, fall back to the nearest real value so the boundary
    // stays filled right up to the geometric edge instead of fraying.
    const near = [v00, v10, v01, v11].filter((v) => Number.isFinite(v))
    return near.length ? near[0] : NaN
  }
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

export interface FieldMatch {
  fieldId: string
  /** How many of the samples fall inside that field. */
  inside: number
  total: number
  /** inside / total, 0–1. */
  fraction: number
}

/**
 * Which known field these points actually sit in.
 *
 * Matching by GEOMETRY rather than by name: an imported sheet's field names
 * are whatever someone typed in a past season and rarely match the app's,
 * whereas the coordinates either fall inside a boundary or they don't.
 *
 * Returns the best match, or null when nothing contains a convincing share of
 * the points — better to infer the outline from the points than to clip a
 * field's data to the wrong field's boundary and silently lose half of it.
 */
/**
 * What share of the samples each candidate field contains, keyed by field id.
 *
 * Used to keep irrelevant fields out of the outline picker. Offering a field
 * on the far side of the county invites clipping a season's data to a
 * boundary that has nothing to do with it — which produces a confidently
 * wrong map rather than an error.
 */
export function fieldContainment(
  candidates: Array<{ id: string; geometry?: unknown }>,
  samples: SamplePoint[],
): Map<string, number> {
  const out = new Map<string, number>()
  if (samples.length === 0) return out
  for (const c of candidates) {
    if (!c.geometry) continue
    const frame = fieldFrame(c.geometry as FieldDict)
    if (!frame) continue
    const enu = latlonListToEnu(
      samples.map((s) => [s.lat, s.lng] as [number, number]),
      frame.pivotLon,
      frame.pivotLat,
    )
    let inside = 0
    for (const [e, n] of enu) if (insideField(frame, e, n)) inside++
    out.set(c.id, inside / samples.length)
  }
  return out
}

export function matchFieldByGeometry(
  candidates: Array<{ id: string; geometry?: unknown }>,
  samples: SamplePoint[],
  minFraction = 0.6,
): FieldMatch | null {
  if (samples.length === 0) return null
  let best: FieldMatch | null = null

  for (const c of candidates) {
    if (!c.geometry) continue
    const frame = fieldFrame(c.geometry as FieldDict)
    if (!frame) continue
    const enu = latlonListToEnu(
      samples.map((s) => [s.lat, s.lng] as [number, number]),
      frame.pivotLon,
      frame.pivotLat,
    )
    let inside = 0
    for (const [e, n] of enu) if (insideField(frame, e, n)) inside++
    const fraction = inside / samples.length
    if (!best || inside > best.inside) best = { fieldId: c.id, inside, total: samples.length, fraction }
  }

  return best && best.fraction >= minFraction ? best : null
}

/**
 * Approximate distance, in cells, from every cell to the nearest `true` in
 * `mask`. Two-pass chamfer (3-4 weights) — not exact Euclidean, but within a
 * few percent and linear in the number of cells, which matters at 250k.
 */
function chamferDistance(mask: Uint8Array, cols: number, rows: number): Float32Array {
  const BIG = 1e9
  const d = new Float32Array(cols * rows)
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : BIG

  const D1 = 1 // orthogonal step
  const D2 = 1.41421356 // diagonal step

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + D1)
      if (y > 0) v = Math.min(v, d[i - cols] + D1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - cols - 1] + D2)
      if (x < cols - 1 && y > 0) v = Math.min(v, d[i - cols + 1] + D2)
      d[i] = v
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x
      let v = d[i]
      if (x < cols - 1) v = Math.min(v, d[i + 1] + D1)
      if (y < rows - 1) v = Math.min(v, d[i + cols] + D1)
      if (x < cols - 1 && y < rows - 1) v = Math.min(v, d[i + cols + 1] + D2)
      if (x > 0 && y < rows - 1) v = Math.min(v, d[i + cols - 1] + D2)
      d[i] = v
    }
  }
  return d
}

/**
 * Morphological closing: dilate by `r` cells, then erode by the same.
 *
 * The clip mask is a union of discs, one per block, so its outer edge is a
 * chain of arcs — visibly scalloped. Closing fills any notch narrower than
 * `r` while leaving the overall shape alone, which turns that scalloped rim
 * into a clean outline. Genuine concavities wider than `r` survive, so an
 * L-shaped or notched field keeps its real shape.
 */
export function closeMask(mask: Uint8Array, cols: number, rows: number, r: number): Uint8Array {
  if (r <= 0) return mask
  // Dilate: every cell within r of the mask.
  const dist = chamferDistance(mask, cols, rows)
  const dilated = new Uint8Array(cols * rows)
  for (let i = 0; i < dilated.length; i++) dilated[i] = dist[i] <= r ? 1 : 0

  // Erode the dilation by the same radius: a cell survives only if it is at
  // least r from the outside. Net effect is the notches filled, edge restored.
  const inverse = new Uint8Array(cols * rows)
  for (let i = 0; i < inverse.length; i++) inverse[i] = dilated[i] ? 0 : 1
  const distOut = chamferDistance(inverse, cols, rows)

  const out = new Uint8Array(cols * rows)
  for (let i = 0; i < out.length; i++) out[i] = dilated[i] && distOut[i] > r ? 1 : 0
  return out
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
  /** Cells with a block close enough to draw — tidied up after the pass. */
  const nearMask = new Uint8Array(cols * rows)
  const ring = frame.boundaryEnu
  const r2 = frame.radius * frame.radius
  const maxD2 = o.maxDistanceM == null ? Infinity : o.maxDistanceM * o.maxDistanceM
  const clipD2 = o.clipDistanceM == null ? Infinity : o.clipDistanceM * o.clipDistanceM
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

      // Whether this cell is really in the field. Values are computed either
      // way — see `values` — but only in-field cells count as the surface.
      const inside = ring && ring.length >= 3 ? pointInEnuRing(ring, e, n) : e * e + n * n <= r2
      // Skip cells far outside: they'd never be sampled and cost time. One
      // cell of overspill is all the renderer needs to interpolate the edge.
      if (!inside && !nearBoundary(ring, r2, e, n, cellM * 1.5)) continue

      const candidates = index.near(e, n, o.maxNeighbors, MAX_RINGS)
      if (candidates.length === 0) continue

      // Distances once, then sort: the nearest decides whether this cell is
      // drawn at all, and the nearest N decide what colour it is.
      const scored: Array<[number, number]> = []
      for (const i of candidates) {
        const s = samplesEnu[i]
        const de = e - s.e
        const dn = n - s.n
        scored.push([de * de + dn * dn, i])
      }
      scored.sort((a, b) => a[0] - b[0])

      // CLIP is a mask, not an influence limit. Beyond the nearest block by
      // more than this, draw nothing; inside it, interpolate normally. Using
      // one distance for both jobs is what produced a flat disc per block.
      //
      // The value is computed either way and the mask applied afterwards, so
      // the edge can be tidied without leaving holes where a cell was skipped.
      if (inside && scored[0][0] <= clipD2) nearMask[ry * cols + cx] = 1

      let num = 0
      let den = 0
      let exact = NaN
      const take = Math.min(o.maxNeighbors, scored.length)
      for (let k = 0; k < take; k++) {
        const [d2, i] = scored[k]
        if (d2 > maxD2) break // sorted, so everything after is further still
        if (d2 < 1e-9) {
          // Sitting on a sample: use it rather than dividing by zero.
          exact = samplesEnu[i].value
          break
        }
        // pow(d2, power/2) is the general form; power 2 is the common case and
        // reduces to plain 1/d2, avoiding a Math.pow per sample per cell.
        const w = isSquare ? 1 / d2 : 1 / Math.pow(d2, halfPower)
        num += w * samplesEnu[i].value
        den += w
      }

      const v = Number.isFinite(exact) ? exact : den > 0 ? num / den : NaN
      if (!Number.isFinite(v)) continue // no sample within maxDistanceM
      values[ry * cols + cx] = v
    }
  }

  // ── Tidy the edge ─────────────────────────────────────────────────────────
  // The mask is a union of one disc per block, so its rim is a chain of arcs
  // and reads as visibly wavy. Closing fills the notches between neighbouring
  // blocks, leaving a clean outline; concavities wider than the radius (a real
  // notch in the field) survive.
  let mask: Uint8Array = nearMask
  if (o.clipDistanceM != null) {
    const rCells = Math.min(24, Math.max(1, Math.round(o.clipDistanceM / cellM)))
    mask = closeMask(nearMask, cols, rows, rCells)
  }

  // Range comes from the cells actually inside the field — the overspill past
  // the edge is scaffolding for the renderer, not part of the surface.
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue
    const v = values[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }

  if (!Number.isFinite(min)) return null // nothing landed inside the field

  const corners: Array<[number, number]> = [
    enuToLonLat(frame, minE, maxN), // NW
    enuToLonLat(frame, maxE, maxN), // NE
    enuToLonLat(frame, maxE, minN), // SE
    enuToLonLat(frame, minE, minN), // SW
  ]

  return { cols, rows, cellM, values, mask, min, max, corners, samplesEnu, originE: minE, originN: maxN, frame }
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
 * Typical spacing between neighbouring blocks, in metres (median of each
 * point's nearest neighbour). The basis for how far the surface should extend
 * past the outermost blocks before it stops meaning anything.
 */
export function medianSpacingM(samples: SamplePoint[]): number | null {
  if (samples.length < 2) return null
  // Project to a local metre frame about the first point; exact enough for a
  // spacing statistic and far cheaper than haversine per pair.
  const lat0 = samples[0].lat
  const mPerLat = 111_320
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const pts = samples.map((s) => [s.lng * mPerLng, s.lat * mPerLat] as [number, number])

  // O(n^2) is fine to a few thousand; sample a subset beyond that.
  const step = pts.length > 1500 ? Math.ceil(pts.length / 1500) : 1
  const nn: number[] = []
  for (let i = 0; i < pts.length; i += step) {
    let best = Infinity
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue
      const dx = pts[i][0] - pts[j][0]
      const dy = pts[i][1] - pts[j][1]
      const d2 = dx * dx + dy * dy
      if (d2 < best) best = d2
    }
    // Ignore repeats of the SAME position — several blocks recorded at one
    // spot, or two GPS reads of it. Their separation says nothing about how
    // far apart sampled positions are, and including them drags the median to
    // ~0, which collapses the edge trim and gives every block its own disc.
    if (Number.isFinite(best) && best > 1) nn.push(Math.sqrt(best))
  }

  // Independent estimate that duplicates cannot distort: if n positions cover
  // this bounding box, they sit roughly sqrt(area / n) apart. Used as a floor.
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const s of samples) {
    minLat = Math.min(minLat, s.lat)
    maxLat = Math.max(maxLat, s.lat)
    minLng = Math.min(minLng, s.lng)
    maxLng = Math.max(maxLng, s.lng)
  }
  const widthM = (maxLng - minLng) * mPerLng
  const heightM = (maxLat - minLat) * mPerLat
  const area = Math.abs(widthM * heightM)
  const coverage = area > 0 ? Math.sqrt(area / samples.length) : null

  if (nn.length === 0) return coverage
  nn.sort((a, b) => a - b)
  const mid = nn.length >> 1
  const nnMedian = nn.length % 2 ? nn[mid] : (nn[mid - 1] + nn[mid]) / 2

  // Take the LARGER: too small leaves holes between blocks, too large only
  // reaches a little further past the edge. The failure modes aren't equal.
  return coverage == null ? nnMedian : Math.max(nnMedian, coverage)
}

/**
 * How far past the blocks to keep drawing, derived from their spacing.
 *
 * The interpolation grid is a rectangle, but a field is not — so without a
 * limit the corners get filled with colour extrapolated from blocks a long way
 * off, and a circular pivot renders as a square. Masking cells that have no
 * block within this distance makes the surface follow the shape actually
 * sampled, whatever that shape is.
 *
 * `looseness` scales it: ~1 hugs the blocks, ~3 reaches well past them.
 */
export function autoTrimM(samples: SamplePoint[], looseness = 2): number {
  const spacing = medianSpacingM(samples)
  // No spacing to go on (a single block): fall back to something sane rather
  // than masking everything or nothing.
  if (spacing == null || !Number.isFinite(spacing) || spacing <= 0) return 150 * looseness
  // Clamped so pathological spacing can't produce a useless mask either way.
  return Math.min(600, Math.max(25, spacing * looseness))
}

/**
 * A field's own boundary as a closed lon/lat ring, for drawing it on a map.
 *
 * Works for both shapes the app records: a polygon boundary is returned as it
 * stands, while a pivot — which is stored as a centre and a radius, with no
 * vertices at all — is turned into a circle. Useful before any blocks exist,
 * when there is a field to look at but no surface to draw.
 */
export function fieldOutlineRing(field: FieldDict, segments = 96): Array<[number, number]> | null {
  const frame = fieldFrame(field)
  if (!frame) return null

  const ring = frame.boundaryEnu
  if (ring && ring.length >= 3) {
    const out = ring.map(([e, n]) => enuToLonLat(frame, e, n))
    // Close the ring so a line layer draws the final side.
    out.push(out[0])
    return out
  }

  if (!(frame.radius > 0)) return null
  const out: Array<[number, number]> = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push(enuToLonLat(frame, frame.radius * Math.cos(a), frame.radius * Math.sin(a)))
  }
  return out
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
    // Mask only: values computed past the edge are scaffolding for the
    // renderer and must not enter the field's statistics.
    if (!g.mask[i]) continue
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
 * Colour ramp, low → high: red (worst) through yellow to green (best).
 *
 * ColorBrewer RdYlGn, the classic QGIS yield ramp — chosen so these maps read
 * the same way as the ones growers have seen for years.
 *
 * Caveat worth knowing: red/green is the commonest form of colour blindness,
 * so roughly one man in twelve will struggle to separate the two ends. The
 * legend prints the actual numbers for that reason.
 */
export const RAMP: Array<[number, number, number]> = [
  [165, 0, 38], // dark red — worst
  [215, 48, 39],
  [244, 109, 67],
  [253, 174, 97],
  [254, 224, 139],
  [217, 239, 139],
  [145, 207, 96],
  [26, 152, 80], // dark green — best
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
      const i = ry * g.cols + cx
      if (!g.mask[i]) continue // exported grid is the field, not the overspill
      const v = g.values[i]
      if (!Number.isFinite(v)) continue
      const e = g.originE + (cx + 0.5) * g.cellM
      const n = g.originN - (ry + 0.5) * g.cellM
      const [lng, lat] = enuToLonLat(g.frame, e, n)
      out.push(`${lng.toFixed(7)},${lat.toFixed(7)},${v.toFixed(4)}`)
    }
  }
  return out.join('\n')
}
