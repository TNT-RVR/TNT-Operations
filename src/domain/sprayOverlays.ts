import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson'
import {
  booleanPointInPolygon,
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  lineSplit as turfLineSplit,
  union as turfUnion,
} from '@turf/turf'
import { fieldBool, innerExclusionUnion } from './bayOverlays'
import { latlonListToEnu } from './geo'
import {
  enuToLatAlong,
  enuToLonLat,
  fieldFrame,
  latAlongToLonLat,
  pointInEnuRing,
  type FieldFrame,
} from './fieldFrame'
import type { FieldDict } from './tentGrid'

/**
 * Pure geometry → GeoJSON generators for the SPRAYER overlays of spec §6.3 and
 * the shelter buffer squares of §6.5:
 *
 *   • `sprayerPassLines`     — pass centre lines at `Sprayer_width` spacing
 *   • `outerSprayerLimit`    — boundary inset by one sprayer width (always drawn)
 *   • `tireAndEdgeZones`     — the tire band (pass centre) + edge band (pass edge)
 *   • `shelterBufferSquares` — the 5 ft John-Deere section-control square per shelter
 *
 * Every generator is pure, takes the raw field dict, returns an EMPTY
 * FeatureCollection when the geometry is impossible, and never throws.
 *
 * ── SPRAY ANGLE vs PLANTING ANGLE (read this before touching the math) ───────
 * `fieldFrame()` builds `cosR`/`sinR` from the **planting** angle, because that's
 * the frame the placement engine (and the bay overlay) works in. The sprayer may
 * run at a different heading — `Spray_angle` is a separate field key and only
 * *falls back* to the planting angle when blank (see `fieldFrame.ts`).
 *
 * So the pass/tire/edge generators below must NOT use `frame.cosR/sinR` or the
 * `latAlongToLonLat` / `frameExtent` helpers built on them. They derive their own
 * rotation from `frame.sprayAngle` with the SAME formula `fieldFrame` uses
 * (`rotate = ((0 - angle + 180) mod 360) - 180`, then cos/sin) and project through
 * `enuToLonLat`, which is angle-agnostic. Getting this wrong draws every pass in
 * the wrong direction *silently* — the map still looks plausible, it's just lying.
 *
 * `shelterBufferSquares` is the exception: those squares are section-control boxes
 * aligned to the CROP, so they use the planting frame (`latAlongToLonLat`).
 *
 * ── PASS INDEXING ────────────────────────────────────────────────────────────
 * Matching the placement engine (`tentGrid.ts`), pass edges sit at integer
 * multiples of the sprayer width in the spray-lateral coordinate and pass `k`
 * spans lateral `[k·W, (k+1)·W]`, so its centre is `(k + 0.5)·W`. `index` is that
 * signed `k`, so a pass line, its tire band and its two edge bands agree.
 *
 * The planter's calibration shift (`frame.shiftE/shiftN`, from `bay_shift_*`) is
 * deliberately NOT applied here — it moves bays and flags, not the sprayer. The
 * sprayer's own lateral nudge is `sprayer_shift` (metres, spec §6.3 "Shift").
 */

const FT_TO_M = 0.3048

/**
 * Parse a field-dict value that may be a number or a (possibly blank) string.
 *
 * A MISSING or BLANK value falls back to `dflt` — blank means "unset", so the
 * spec default applies (`tire_width_ft` 14, `pass_edge_buffer_ft` 25,
 * `shelter_buffer_m` 1.524). An explicit `"0"` is honoured as zero, which is how
 * a user turns a band off.
 */
const toFloat = (v: unknown, dflt = 0): number => {
  const s = String(v ?? '').trim()
  if (s === '') return dflt
  const n = Number(s)
  return Number.isFinite(n) ? n : dflt
}
const pymod = (a: number, b: number): number => ((a % b) + b) % b

const emptyFC = <T extends Polygon | LineString>(): FeatureCollection<T> => ({
  type: 'FeatureCollection',
  features: [],
})

/**
 * `fieldFrame`, but null for a field whose pivot is BLANK rather than absent.
 *
 * `fieldFrame` parses `""` as 0 (its `toFloat` treats an empty string as a finite
 * zero), so a field that has never had its pivot set yields a perfectly valid
 * frame anchored at 0°N 0°E — off the coast of Africa. Overlays drawn there are
 * worse than no overlays, so every generator here goes through this guard.
 */
function frameFor(field: FieldDict): FieldFrame | null {
  for (const key of ['PP_Latitude', 'PP_Longitude']) {
    const s = String(field?.[key] ?? '').trim()
    if (s === '' || !Number.isFinite(Number(s))) return null
  }
  return fieldFrame(field)
}

/**
 * Hard cap on how many passes we will ever emit. A pathological
 * `Sprayer_width` (say 0.01 ft) would otherwise generate millions of features
 * and wedge the map; better to draw nothing than to hang the browser.
 */
const MAX_PASSES = 4000

// ─────────────────────────────────────────────────────────────────────────────
// The spray frame — a rotation derived from `sprayAngle`, not the planting angle
// ─────────────────────────────────────────────────────────────────────────────

interface SprayRot {
  cos: number
  sin: number
}

/** Rotation for the SPRAY direction, built exactly like `fieldFrame` builds its own. */
function sprayRot(f: FieldFrame): SprayRot {
  const rotate = pymod(0 - f.sprayAngle + 180, 360) - 180
  const r = (rotate * Math.PI) / 180
  return { cos: Math.cos(r), sin: Math.sin(r) }
}

/** (spray lateral, spray along) → ENU metres. No planter shift — see the header. */
function sprayToEnu(s: SprayRot, lateral: number, along: number): [number, number] {
  return [lateral * s.cos - along * s.sin, along * s.cos + lateral * s.sin]
}

/** ENU metres → (spray lateral, spray along). */
function enuToSpray(s: SprayRot, east: number, north: number): [number, number] {
  return [east * s.cos + north * s.sin, -east * s.sin + north * s.cos]
}

/** (spray lateral, spray along) → [lon, lat]. */
function sprayToLonLat(f: FieldFrame, s: SprayRot, lateral: number, along: number): Position {
  const [e, n] = sprayToEnu(s, lateral, along)
  return enuToLonLat(f, e, n)
}

/**
 * The field extent in the SPRAY frame: `[latMin, latMax, alongMin, alongMax]`.
 * Mirrors `frameExtent`, but rotated to the spray heading. Radius-only fields are
 * circles, so ±radius holds in every direction regardless of heading.
 */
function sprayExtent(f: FieldFrame, s: SprayRot): [number, number, number, number] {
  if (!f.boundaryEnu || f.boundaryEnu.length < 3) {
    return [-f.radius, f.radius, -f.radius, f.radius]
  }
  let latMin = Infinity
  let latMax = -Infinity
  let alongMin = Infinity
  let alongMax = -Infinity
  for (const [e, n] of f.boundaryEnu) {
    const [lateral, along] = enuToSpray(s, e, n)
    if (lateral < latMin) latMin = lateral
    if (lateral > latMax) latMax = lateral
    if (along < alongMin) alongMin = along
    if (along > alongMax) alongMax = along
  }
  return [latMin, latMax, alongMin, alongMax]
}

/** The lateral nudge from spec §6.3 "Shift" (metres); 0 when unset. */
const sprayShift = (field: FieldDict): number => toFloat(field['sprayer_shift'], 0)

/**
 * Signed pass indices covering the extent, or null when the geometry is unusable
 * (non-positive width, non-finite extent, or an absurd pass count).
 */
function passRange(
  latMin: number,
  latMax: number,
  width: number,
  shift: number,
): [number, number] | null {
  if (!(width > 0)) return null
  if (![latMin, latMax, shift].every(Number.isFinite)) return null
  const kMin = Math.floor((latMin - shift) / width)
  const kMax = Math.floor((latMax - shift) / width)
  if (!Number.isFinite(kMin) || !Number.isFinite(kMax) || kMax < kMin) return null
  if (kMax - kMin + 1 > MAX_PASSES) return null
  return [kMin, kMax]
}

/** True when every coordinate in a ring/line is finite (a cheap projection guard). */
const allFinite = (coords: Position[]): boolean =>
  coords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))

// ─────────────────────────────────────────────────────────────────────────────
// Inner-boundary clipping for LINES (spec §6.3 "Toggle Pass Through Inner")
//
// The exclusion mask itself (`boundary_inner` + `access_road_boundary`, unioned
// once per call) lives in `bayOverlays.ts` — both overlay families clip against
// exactly the same rings, and building it twice would be a real cost on a field
// with many interior boundaries.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A point ON the path, used to decide whether a split piece is the covered one.
 *
 * The midpoint of the path's MIDDLE SEGMENT, not the average of the endpoints:
 * for the straight two-point pass lines they are the same, but on a split piece
 * of a bent line the endpoint average can leave the line entirely.
 */
function midOfPath(coords: Position[]): Position | null {
  const i = Math.max(0, Math.floor((coords.length - 1) / 2))
  const a = coords[i]
  const b = coords[i + 1] ?? coords[i]
  const m: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return Number.isFinite(m[0]) && Number.isFinite(m[1]) ? m : null
}

/** True for a piece with no length (turf can emit these at a tangent touch). */
const degenerate = (coords: Position[]): boolean =>
  coords.every((c) => c[0] === coords[0][0] && c[1] === coords[0][1])

/**
 * Break one line where it crosses the exclusion mask, dropping the covered part.
 *
 * `lineSplit` only CUTS — it has no notion of inside — so each resulting piece is
 * kept or dropped by testing a point on it against the mask. A line that misses
 * the mask entirely splits into nothing (turf returns an empty collection), which
 * is why the untouched line is the fallback; a line wholly inside a hole survives
 * that fallback and is then dropped by the inside test.
 *
 * Every surviving piece carries a copy of the input's properties.
 */
function clipLineFeature(
  feat: Feature<LineString>,
  holes: Feature<Polygon | MultiPolygon>,
): Feature<LineString>[] {
  let parts: Feature<LineString>[]
  try {
    const split = turfLineSplit(feat, holes)
    parts = split?.features?.length ? split.features : [feat]
  } catch {
    return [feat] // never lose geometry to a boolean-op hiccup
  }

  const out: Feature<LineString>[] = []
  for (const part of parts) {
    const coords = part?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) continue
    if (!allFinite(coords) || degenerate(coords)) continue
    const mid = midOfPath(coords)
    if (!mid) continue
    try {
      if (booleanPointInPolygon(mid, holes)) continue // this piece is covered
    } catch {
      /* keep the piece rather than silently lose it */
    }
    out.push({
      type: 'Feature',
      properties: { ...feat.properties },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Sprayer pass centre lines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sprayer pass CENTRE lines (spec §6.3 `show_passes`) — one line per pass at
 * `Sprayer_width` spacing across the field, running along the SPRAY direction and
 * spanning the field extent.
 *
 * Properties: `{ kind: 'sprayer_pass', index }` where `index` is the signed pass
 * number (pass `k` spans lateral `[k·W, (k+1)·W]`).
 *
 * Spec §6.3 "Toggle Pass Through Inner": unless `sprayer_routes_around_inner` is
 * turned OFF (it defaults ON), each line is BROKEN where it crosses an inner
 * boundary or the access road — one pass can therefore emit several segments,
 * all carrying the same `index`, and a pass swallowed by a hole emits none. A
 * field with no inner rings does no boolean work and emits what it always did.
 */
export function sprayerPassLines(field: FieldDict): FeatureCollection<LineString> {
  try {
    const f = frameFor(field)
    if (!f) return emptyFC<LineString>()
    const w = f.sprayerWidthM
    const s = sprayRot(f)
    const [latMin, latMax, alongMin, alongMax] = sprayExtent(f, s)
    const shift = sprayShift(field)
    const range = passRange(latMin, latMax, w, shift)
    if (!range) return emptyFC<LineString>()

    const features: Feature<LineString>[] = []
    for (let k = range[0]; k <= range[1]; k++) {
      const lateral = (k + 0.5) * w + shift
      const coords: Position[] = [
        sprayToLonLat(f, s, lateral, alongMin),
        sprayToLonLat(f, s, lateral, alongMax),
      ]
      if (!allFinite(coords)) continue
      features.push({
        type: 'Feature',
        properties: { kind: 'sprayer_pass', index: k },
        geometry: { type: 'LineString', coordinates: coords },
      })
    }

    // Spans the bounding box by design; the map trims with `clipToField`
    // (see the note in bayOverlays — clipping here would make the geometry lossy).
    const out = features

    if (!fieldBool(field['sprayer_routes_around_inner'], true)) {
      return { type: 'FeatureCollection', features: out }
    }
    const holes = innerExclusionUnion(field)
    if (!holes) return { type: 'FeatureCollection', features: out }
    try {
      const clipped: Feature<LineString>[] = []
      for (const line of out) clipped.push(...clipLineFeature(line, holes))
      return { type: 'FeatureCollection', features: clipped }
    } catch {
      return { type: 'FeatureCollection', features: out }
    }
  } catch {
    return emptyFC<LineString>()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Outer sprayer limit (boundary inset by one sprayer width)
// ─────────────────────────────────────────────────────────────────────────────

/** Twice the signed area of an ENU ring (shoelace); sign gives the winding. */
function ringArea2(ring: Array<[number, number]>): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  }
  return a
}

/** Squared distance from (px,py) to segment ab. */
function distSqToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/** Shortest distance from a point to a closed ENU ring's perimeter. */
function distToRing(ring: Array<[number, number]>, px: number, py: number): number {
  let best = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = distSqToSeg(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1])
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/** Drop the closing duplicate and any zero-length edges. */
function cleanRing(ring: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [e, n] of ring) {
    if (!Number.isFinite(e) || !Number.isFinite(n)) continue
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - e) < 1e-9 && Math.abs(last[1] - n) < 1e-9) continue
    out.push([e, n])
  }
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 &&
    Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9
  ) {
    out.pop()
  }
  return out
}

/**
 * Inset a closed ENU ring by `d` metres (offset every edge inward, then intersect
 * adjacent offset edges).
 *
 * Naive edge-offsetting is only exact for convex polygons: at a sharp concave
 * corner, or anywhere the polygon is narrower than `2·d`, the offset edges cross
 * each other and produce "spikes" that stick back OUT of the original shape. So
 * every candidate vertex is validated before it is kept — it must lie inside the
 * original ring AND be at least `d` from its perimeter. What survives is the real
 * inset; if fewer than 3 vertices survive, or the winding flips, or the area does
 * not shrink, the inset has collapsed and we return null (draw nothing) rather
 * than an inverted polygon.
 *
 * Returns an OPEN ring (no repeated closing point).
 */
function insetRingEnu(input: Array<[number, number]>, d: number): Array<[number, number]> | null {
  if (!(d > 0)) return null
  const ring = cleanRing(input)
  const n = ring.length
  if (n < 3) return null

  const area2 = ringArea2(ring)
  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-9) return null
  const wind = area2 > 0 ? 1 : -1

  // Offset line per edge i (from ring[i] to ring[i+1]): a point + a direction.
  const ax: number[] = []
  const ay: number[] = []
  const ux: number[] = []
  const uy: number[] = []
  for (let i = 0; i < n; i++) {
    const [px, py] = ring[i]
    const [qx, qy] = ring[(i + 1) % n]
    const dx = qx - px
    const dy = qy - py
    const len = Math.hypot(dx, dy)
    if (!(len > 0)) return null
    // Inward normal: left of travel for a CCW ring, right for a CW one.
    const nx = (-wind * dy) / len
    const ny = (wind * dx) / len
    ax.push(px + nx * d)
    ay.push(py + ny * d)
    ux.push(dx)
    uy.push(dy)
  }

  const tol = 1e-4 // metres of slack for the "≥ d from the boundary" check
  const kept: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + n - 1) % n // the edge arriving at vertex i
    const cross = ux[j] * uy[i] - uy[j] * ux[i]
    let vx: number
    let vy: number
    if (Math.abs(cross) < 1e-12) {
      // Collinear edges: the two offset lines coincide, so the offset start point
      // of edge i is already the vertex. (An exact 180° spike lands here too and
      // is thrown out by the validation below.)
      vx = ax[i]
      vy = ay[i]
    } else {
      const t = ((ax[i] - ax[j]) * uy[i] - (ay[i] - ay[j]) * ux[i]) / cross
      vx = ax[j] + t * ux[j]
      vy = ay[j] + t * uy[j]
    }
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue
    if (!pointInEnuRing(ring, vx, vy)) continue
    if (distToRing(ring, vx, vy) < d - tol) continue
    const last = kept[kept.length - 1]
    if (last && Math.abs(last[0] - vx) < 1e-6 && Math.abs(last[1] - vy) < 1e-6) continue
    kept.push([vx, vy])
  }
  const out = cleanRing(kept)
  if (out.length < 3) return null

  const newArea2 = ringArea2(out)
  if (!Number.isFinite(newArea2)) return null
  if (newArea2 === 0) return null
  if (newArea2 > 0 !== area2 > 0) return null // winding flipped ⇒ inverted
  if (Math.abs(newArea2) >= Math.abs(area2)) return null // didn't actually shrink
  return out
}

/**
 * The "outer sprayer limit" (spec §6.3) — the field boundary inset by ONE sprayer
 * width, drawn bright green and NOT gated by the passes toggle.
 *
 * Two cases:
 *  • **Boundary fields** — a true polygon inset in ENU metres (see
 *    {@link insetRingEnu}). A boundary narrower than one sprayer width collapses,
 *    and we return empty rather than an inside-out polygon.
 *  • **Radius-only (pivot) fields** — there is no boundary polygon to inset, so we
 *    fall back to the natural equivalent: a 96-sided circle of
 *    `radius − sprayerWidth` about the pivot. Empty when that radius is ≤ 0.
 *
 * Properties: `{ kind: 'sprayer_limit' }`.
 */
export function outerSprayerLimit(field: FieldDict): FeatureCollection<Polygon> {
  try {
    const f = frameFor(field)
    if (!f) return emptyFC<Polygon>()
    const w = f.sprayerWidthM
    if (!(w > 0)) return emptyFC<Polygon>()

    let ringEnu: Array<[number, number]> | null
    if (f.boundaryEnu && f.boundaryEnu.length >= 3) {
      ringEnu = insetRingEnu(f.boundaryEnu, w)
    } else {
      const r = f.radius - w
      if (!(r > 0)) return emptyFC<Polygon>()
      const steps = 96
      ringEnu = []
      for (let i = 0; i < steps; i++) {
        const a = (2 * Math.PI * i) / steps
        ringEnu.push([r * Math.cos(a), r * Math.sin(a)])
      }
    }
    if (!ringEnu) return emptyFC<Polygon>()

    const coords: Position[] = ringEnu.map(([e, n]) => enuToLonLat(f, e, n))
    if (coords.length < 3 || !allFinite(coords)) return emptyFC<Polygon>()
    coords.push(coords[0]) // close

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { kind: 'sprayer_limit' },
          geometry: { type: 'Polygon', coordinates: [coords] },
        },
      ],
    }
  } catch {
    return emptyFC<Polygon>()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tire & edge zones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The field outline inset by `d` metres, in ENU.
 *
 * One helper for both field shapes, so everything built on the perimeter agrees
 * about where it is: a boundary polygon is inset by {@link insetRingEnu}, and a
 * radius-only pivot field falls back to a circle of `radius − d` — the same
 * substitution {@link outerSprayerLimit} already makes. `d = 0` is the outline
 * itself. Returns null when the inset collapses the shape.
 */
function outlineAtInset(f: FieldFrame, d: number): Array<[number, number]> | null {
  if (!Number.isFinite(d) || d < 0) return null
  if (f.boundaryEnu && f.boundaryEnu.length >= 3) {
    if (d === 0) {
      const ring = cleanRing(f.boundaryEnu)
      return ring.length >= 3 ? ring : null
    }
    return insetRingEnu(f.boundaryEnu, d)
  }
  const r = f.radius - d
  if (!(r > 0)) return null
  const steps = 96
  const out: Array<[number, number]> = []
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

/** An ENU ring → a closed [lon,lat] ring, or null if anything is unusable. */
function ringToLonLat(f: FieldFrame, ring: Array<[number, number]>): Position[] | null {
  const coords: Position[] = ring.map(([e, n]) => enuToLonLat(f, e, n))
  if (coords.length < 3 || !allFinite(coords)) return null
  coords.push(coords[0])
  return coords
}

/**
 * The ring-shaped band between two insets — a polygon with a hole.
 *
 * `dOuter` is the shallower inset (nearer the boundary). If the inner inset
 * collapses, the band simply runs to the middle of the field, which is the
 * truthful answer for a band wider than the field is across.
 */
function insetBand(
  f: FieldFrame,
  dOuter: number,
  dInner: number,
  properties: Record<string, unknown>,
): Feature<Polygon> | null {
  const outer = outlineAtInset(f, Math.max(0, dOuter))
  if (!outer) return null
  const outerRing = ringToLonLat(f, outer)
  if (!outerRing) return null
  const inner = dInner > dOuter ? outlineAtInset(f, dInner) : null
  const innerRing = inner ? ringToLonLat(f, inner) : null
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: innerRing ? [outerRing, innerRing] : [outerRing] },
  }
}

/** Split a boolean-op result back into plain Polygon features. */
function explode(
  hit: Feature<Polygon | MultiPolygon> | null,
  properties: Record<string, unknown>,
): Feature<Polygon>[] {
  if (!hit?.geometry) return []
  const piece = (coordinates: Position[][]): Feature<Polygon> => ({
    type: 'Feature',
    properties: { ...properties },
    geometry: { type: 'Polygon', coordinates },
  })
  if (hit.geometry.type === 'Polygon') return [piece(hit.geometry.coordinates)]
  if (hit.geometry.type === 'MultiPolygon') return hit.geometry.coordinates.map(piece)
  return []
}

/** Keep only the part of `feat` inside `region`. Passes it through on failure. */
function clipToRegion(feat: Feature<Polygon>, region: Feature<Polygon>): Feature<Polygon>[] {
  try {
    return explode(
      turfIntersect(turfFeatureCollection<Polygon>([feat, region])),
      feat.properties ?? {},
    )
  } catch {
    return [feat]
  }
}

/** Remove `cut` from `feat`. Passes it through on failure. */
function subtract(
  feat: Feature<Polygon>,
  cut: Feature<Polygon | MultiPolygon>,
): Feature<Polygon>[] {
  try {
    return explode(
      turfDifference(turfFeatureCollection<Polygon | MultiPolygon>([feat, cut])),
      feat.properties ?? {},
    )
  } catch {
    return [feat]
  }
}

/** A lateral band `[latA, latB]` × the along extent, as a closed [lon,lat] ring. */
function bandRing(
  f: FieldFrame,
  s: SprayRot,
  latA: number,
  latB: number,
  alongMin: number,
  alongMax: number,
): Position[] | null {
  const ring: Position[] = [
    sprayToLonLat(f, s, latA, alongMin),
    sprayToLonLat(f, s, latB, alongMin),
    sprayToLonLat(f, s, latB, alongMax),
    sprayToLonLat(f, s, latA, alongMax),
  ]
  if (!allFinite(ring)) return null
  ring.push(ring[0])
  return ring
}

/**
 * Spec §6.3 "Toggle Tire & Edge Zone" — the shelter section-control aid.
 *
 *  • **tire** (spec Part 13 "tire zone" red) — a band `tire_width_ft` wide
 *    (default 14) centred down each pass CENTRE: where the sprayer's wheels run.
 *  • **edge** (spec Part 13 "edge zone" green) — a band `pass_edge_buffer_ft` wide
 *    (default 25) centred on each pass EDGE: the seam a shelter may sit against.
 *
 * Note on the edge band: the placement engine expresses the same number as an
 * intrusion allowance (`passDeadHalf = W/2 − buffer`, so a shelter is legal only
 * within `buffer` of an edge), which makes the *legal* strip straddling a shared
 * edge `2·buffer` wide. This overlay draws a single `buffer`-wide marker band
 * centred on the edge, matching the desktop app's zone drawing — it is a visual
 * aid, not the exclusion test.
 *
 * Both run along the SPRAY direction and span the field extent. One band per pass
 * (tire) / per edge (edge), indexed by the same signed pass number.
 *
 * ── The perimeter pass ───────────────────────────────────────────────────────
 *
 * The sprayer's lap around the outside of the field is a pass too, so it gets
 * the same zones: a tire band on its centre (inset `W/2`) and an edge band on
 * each of its seams — the boundary, and the limit ring at inset `W` that
 * {@link outerSprayerLimit} draws. These carry `perimeter: true` and a null
 * `index`, since they belong to no numbered pass.
 *
 * ── Two rules about overlap ──────────────────────────────────────────────────
 *
 *  1. **Interior zones stop at the perimeter pass — except the wheels.** An
 *     interior band spans the whole frame extent, so it is clipped. EDGE bands
 *     stop at the limit ring, since past it the seams are the perimeter pass's
 *     own. TIRE bands carry on to the perimeter pass's wheel track, because the
 *     sprayer has to drive in across the outside lap to start an interior pass
 *     and those wheels really do run over that ground.
 *
 *  2. **Tire beats edge.** Where the two would overlap, the tire band is cut out
 *     of the edge band. A shelter may legally sit in an edge zone, so an edge
 *     zone overlapping a wheel track invites the sprayer to drive over one.
 *
 * Both rules are applied HERE rather than in the map layer, because Field Mode
 * (`features/field/ShelterPlacement.tsx`) draws the same zones from the same
 * function and the crew must not see a different field from the office.
 */
export function tireAndEdgeZones(field: FieldDict): {
  tire: FeatureCollection<Polygon>
  edge: FeatureCollection<Polygon>
} {
  const empty = { tire: emptyFC<Polygon>(), edge: emptyFC<Polygon>() }
  try {
    const f = frameFor(field)
    if (!f) return empty
    const w = f.sprayerWidthM
    const s = sprayRot(f)
    const [latMin, latMax, alongMin, alongMax] = sprayExtent(f, s)
    const shift = sprayShift(field)
    const range = passRange(latMin, latMax, w, shift)
    if (!range) return empty

    const tireW = toFloat(field['tire_width_ft'], 14) * FT_TO_M
    const edgeW = toFloat(field['pass_edge_buffer_ft'], 25) * FT_TO_M

    const tire: Feature<Polygon>[] = []
    const edge: Feature<Polygon>[] = []
    for (let k = range[0]; k <= range[1]; k++) {
      if (tireW > 0) {
        const c = (k + 0.5) * w + shift
        const ring = bandRing(f, s, c - tireW / 2, c + tireW / 2, alongMin, alongMax)
        if (ring) {
          tire.push({
            type: 'Feature',
            properties: { kind: 'tire', index: k },
            geometry: { type: 'Polygon', coordinates: [ring] },
          })
        }
      }
      if (edgeW > 0) {
        // Edges are shared, so emit the LEADING edge of every pass plus the
        // trailing edge of the last one — no duplicate band on a shared seam.
        const edges = k === range[1] ? [k, k + 1] : [k]
        for (const ei of edges) {
          const e = ei * w + shift
          const ring = bandRing(f, s, e - edgeW / 2, e + edgeW / 2, alongMin, alongMax)
          if (ring) {
            edge.push({
              type: 'Feature',
              properties: { kind: 'edge', index: ei },
              geometry: { type: 'Polygon', coordinates: [ring] },
            })
          }
        }
      }
    }

    // ── The perimeter pass ────────────────────────────────────────────────
    //
    // The sprayer's lap around the outside of the field occupies the ring
    // between the boundary and the boundary inset by one sprayer width — the
    // same ring `outerSprayerLimit` draws the inner edge of. It has wheels and
    // seams like any other pass, so it gets the same two zones:
    //
    //   tire  — centred on the pass centre, at inset W/2
    //   edge  — on each of its seams: the boundary itself, and the limit ring
    //
    // The band on the boundary seam is drawn INWARD only. Its outward half is
    // off the field, and would be trimmed by the display clip anyway.
    const limitRing = w > 0 ? outlineAtInset(f, w) : null
    const limitCoords = limitRing ? ringToLonLat(f, limitRing) : null
    const limitPoly: Feature<Polygon> | null = limitCoords
      ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [limitCoords] } }
      : null

    if (w > 0) {
      if (tireW > 0) {
        const b = insetBand(f, w / 2 - tireW / 2, w / 2 + tireW / 2, {
          kind: 'tire',
          index: null,
          perimeter: true,
        })
        if (b) tire.push(b)
      }
      if (edgeW > 0) {
        const boundarySeam = insetBand(f, 0, edgeW / 2, {
          kind: 'edge',
          index: null,
          perimeter: true,
          seam: 'boundary',
        })
        if (boundarySeam) edge.push(boundarySeam)
        const limitSeam = insetBand(f, w - edgeW / 2, w + edgeW / 2, {
          kind: 'edge',
          index: null,
          perimeter: true,
          seam: 'limit',
        })
        if (limitSeam) edge.push(limitSeam)
      }
    }

    // ── Where the interior zones stop ─────────────────────────────────────
    //
    // An interior band is generated across the whole frame extent, so without a
    // clip it runs out through the perimeter pass and off the field entirely.
    // The two kinds stop in different places, because they mean different
    // things:
    //
    //  • EDGE bands stop at the limit ring. An edge zone marks a seam a shelter
    //    may sit against, and past the limit ring the seams are the perimeter
    //    pass's own — which get their own bands above.
    //
    //  • TIRE bands carry ON, out to the perimeter pass's wheel track. To start
    //    an interior pass the sprayer has to drive in across the outside lap,
    //    so those wheels really do run over that ground. Stopping the track at
    //    the limit ring drew a machine that teleports onto its pass.
    //
    // The tire band reaches exactly the inner side of the perimeter tire band
    // (inset `W/2 + tireW/2`), so the two meet without a seam or an overlap.
    const tireReachRing = w > 0 && tireW > 0 ? outlineAtInset(f, Math.max(0, w / 2 + tireW / 2)) : null
    const tireReachCoords = tireReachRing ? ringToLonLat(f, tireReachRing) : null
    const tireReachPoly: Feature<Polygon> | null = tireReachCoords
      ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [tireReachCoords] } }
      : null

    // With no ring to clip against — a field narrower than one sprayer width, so
    // the perimeter pass IS the whole field — there is nothing to stay inside,
    // and the bands are left for the display clip to trim.
    const clipInterior = (
      fs: Feature<Polygon>[],
      region: Feature<Polygon> | null,
    ): Feature<Polygon>[] =>
      region ? fs.flatMap((x) => (x.properties?.perimeter ? [x] : clipToRegion(x, region))) : fs

    const tireOut = clipInterior(tire, tireReachPoly)
    let edgeOut = clipInterior(edge, limitPoly)

    // ── Tire wins where the two overlap ───────────────────────────────────
    //
    // A shelter may legally sit in an edge zone, so an edge zone that overlaps
    // a tire zone would invite the sprayer to drive over one. Cutting the tire
    // band out of the edge band leaves the edge zone meaning what it should:
    // "you may put a shelter here", with the wheel tracks removed.
    if (tireOut.length > 0 && edgeOut.length > 0) {
      try {
        const merged =
          tireOut.length === 1
            ? (tireOut[0] as Feature<Polygon | MultiPolygon>)
            : turfUnion(turfFeatureCollection<Polygon>(tireOut))
        if (merged) edgeOut = edgeOut.flatMap((e) => subtract(e, merged))
      } catch {
        // Leave the edge bands whole rather than lose them — an overlapping
        // band is a worse drawing, but a missing one is a worse map.
      }
    }

    // Interior bands span the frame extent by design; the map still trims the
    // result with `clipToField` so nothing spills past the boundary.
    return {
      tire: { type: 'FeatureCollection', features: tireOut },
      edge: { type: 'FeatureCollection', features: edgeOut },
    }
  } catch {
    return empty
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Shelter buffer squares
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spec §6.5 "Toggle Shelter Buffer Zone" — the `shelter_buffer_m` (default 1.524 m
 * = 5 ft) square around each shelter, exported to John Deere as a section-control
 * no-spray box.
 *
 * Half-width is `shelter_buffer_m`, so the square is `2 × shelter_buffer_m` on a
 * side. Unlike the pass overlays these are aligned to the PLANTING frame (the
 * crop rows the machine follows and the crew flags to), not to north and not to
 * the spray heading — hence `latAlongToLonLat`, which carries the planter's
 * calibration shift.
 *
 * Properties: `{ kind: 'shelter_buffer', shelter: i + 1 }`, keeping the shelter's
 * 1-based number from the input order even if some entries are unusable.
 */
export function shelterBufferSquares(
  shelters: Array<{ lat: number; lng: number }>,
  field: FieldDict,
): FeatureCollection<Polygon> {
  try {
    if (!Array.isArray(shelters) || shelters.length === 0) return emptyFC<Polygon>()
    const f = frameFor(field)
    if (!f) return emptyFC<Polygon>()
    const h = toFloat(field['shelter_buffer_m'], 1.524)
    if (!(h > 0)) return emptyFC<Polygon>()

    const features: Feature<Polygon>[] = []
    for (let i = 0; i < shelters.length; i++) {
      const sh = shelters[i]
      const lat = Number(sh?.lat)
      const lng = Number(sh?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const [[e, n]] = latlonListToEnu([[lat, lng]], f.pivotLon, f.pivotLat)
      const [lateral, along] = enuToLatAlong(f, e, n)
      const ring: Position[] = [
        latAlongToLonLat(f, lateral - h, along - h),
        latAlongToLonLat(f, lateral + h, along - h),
        latAlongToLonLat(f, lateral + h, along + h),
        latAlongToLonLat(f, lateral - h, along + h),
      ]
      if (!allFinite(ring)) continue
      ring.push(ring[0]) // close
      features.push({
        type: 'Feature',
        properties: { kind: 'shelter_buffer', shelter: i + 1 },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    }
    return { type: 'FeatureCollection', features }
  } catch {
    return emptyFC<Polygon>()
  }
}
