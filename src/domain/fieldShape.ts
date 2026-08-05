/**
 * Infer a field's shape from the blocks placed in it.
 *
 * The alternative — masking to "wherever a block is nearby" — traces the point
 * cloud, so a pivot comes out lumpy and a straight edge comes out ragged. Real
 * fields are simple shapes, so fitting one gives a clean, presentable outline
 * with no boundary to draw by hand.
 *
 * Two shapes cover essentially everything:
 *   circle   — centre pivots, by far the commonest
 *   polygon  — quarters, squares and irregular fields with straight sides
 *
 * Which one is chosen is decided by the data, not guessed: how much of its
 * enclosing circle does the outline actually fill? A circle fills all of it, a
 * square 64%. That separates them cleanly and uses the whole outline rather
 * than a few vertices.
 */
import type { SamplePoint } from './returnsMap'
import type { FieldDict } from './tentGrid'

export interface ShapeOptions {
  /**
   * How round a shape must be to be drawn as a circle, measured as hull area
   * over the area of the circle enclosing it.
   *
   * A circle scores 1.0, a regular octagon 0.90, a hexagon 0.83, a square
   * 0.64. So 0.88 calls circles and near-circles round while keeping squares
   * and quarters straight-edged.
   *
   * Area is the right measure here. The obvious alternative — how much the
   * edge-to-centre distance varies — is far weaker, because hull vertices
   * spread along a square's sides average out and make it look round.
   */
  circleTolerance?: number
  /** Push the outline this far beyond the outermost blocks, in metres. */
  bufferM?: number
  /** Corner-merging tolerance for the polygon fit, in metres. */
  simplifyM?: number
}

export interface InferredShape {
  kind: 'circle' | 'polygon'
  field: FieldDict
  /** Centre in degrees. */
  centre: { lat: number; lng: number }
  /** Circle only. */
  radiusM?: number
  /** Polygon only: corner count after simplification. */
  corners?: number
}

/** Local metres-per-degree at a latitude. Plenty accurate over one field. */
function scaleAt(lat: number): { mPerLat: number; mPerLng: number } {
  return { mPerLat: 111_320, mPerLng: 111_320 * Math.cos((lat * Math.PI) / 180) }
}

/** Signed area of a closed ring (shoelace). */
export function polygonArea(ring: Array<[number, number]>): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 3) return [...pts]
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  const lower: Array<[number, number]> = []
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Ramer–Douglas–Peucker: drop vertices that lie within `tol` of a straight run. */
export function simplify(points: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (points.length < 3 || tol <= 0) return points

  const distToLine = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
  }

  const keep = (lo: number, hi: number, out: Set<number>) => {
    let worst = -1
    let worstD = tol
    for (let i = lo + 1; i < hi; i++) {
      const d = distToLine(points[i], points[lo], points[hi])
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst < 0) return
    out.add(worst)
    keep(lo, worst, out)
    keep(worst, hi, out)
  }

  const kept = new Set<number>([0, points.length - 1])
  keep(0, points.length - 1, kept)
  return [...kept].sort((a, b) => a - b).map((i) => points[i])
}

/**
 * Fit a clean field outline to the blocks.
 *
 * Returns null when there aren't enough points to fit anything meaningful —
 * an outline invented from three blocks would be fiction.
 */
export function inferFieldShape(samples: SamplePoint[], opts: ShapeOptions = {}): InferredShape | null {
  const { circleTolerance = 0.88, bufferM = 30, simplifyM = 25 } = opts
  const usable = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  if (usable.length < 8) return null

  // Work in metres about the centroid.
  const lat0 = usable.reduce((a, s) => a + s.lat, 0) / usable.length
  const lng0 = usable.reduce((a, s) => a + s.lng, 0) / usable.length
  const { mPerLat, mPerLng } = scaleAt(lat0)
  const pts: Array<[number, number]> = usable.map((s) => [(s.lng - lng0) * mPerLng, (s.lat - lat0) * mPerLat])

  const hull = convexHull(pts)
  if (hull.length < 3) return null

  // Centre of the hull, which is steadier than the centroid of all the points
  // when blocks are unevenly spread inside the field.
  const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length
  const cy = hull.reduce((a, p) => a + p[1], 0) / hull.length

  // ── Circle or polygon? ───────────────────────────────────────────────────
  // How much of its enclosing circle does the shape actually fill? A circle
  // fills all of it; a square fills 64%. Robust because it uses the whole
  // outline rather than a handful of vertices.
  const radii = hull.map((p) => Math.hypot(p[0] - cx, p[1] - cy))
  const maxR = Math.max(...radii)
  const hullArea = Math.abs(polygonArea(hull))
  const circularity = maxR > 0 ? hullArea / (Math.PI * maxR * maxR) : 0

  const centre = { lat: lat0 + cy / mPerLat, lng: lng0 + cx / mPerLng }

  if (circularity >= circleTolerance) {
    // A pivot. Use the outermost block plus the buffer, so nothing sits on or
    // outside the drawn edge.
    const radiusM = Math.max(...radii) + bufferM
    return {
      kind: 'circle',
      centre,
      radiusM,
      field: {
        PP_Latitude: String(centre.lat),
        PP_Longitude: String(centre.lng),
        Radius: String(radiusM),
        use_bays: false,
      } as FieldDict,
    }
  }

  // A polygon. Simplify the hull so near-collinear vertices collapse into one
  // straight run, then push it out from the centre by the buffer.
  const closed = [...hull, hull[0]]
  const simplified = simplify(closed, simplifyM)
  // Drop the duplicated closing vertex before scaling.
  const ring = simplified.slice(0, -1)
  const grown = ring.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const d = Math.hypot(dx, dy) || 1
    const k = (d + bufferM) / d
    return [cx + dx * k, cy + dy * k] as [number, number]
  })

  return {
    kind: 'polygon',
    centre,
    corners: grown.length,
    field: {
      PP_Latitude: String(centre.lat),
      PP_Longitude: String(centre.lng),
      use_bays: false,
      // fieldFrame reads boundary_polygon as [lat, lng] pairs.
      boundary_polygon: grown.map(([x, y]) => [lat0 + y / mPerLat, lng0 + x / mPerLng]),
    } as FieldDict,
  }
}
