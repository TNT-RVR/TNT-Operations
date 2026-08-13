/**
 * Guide lines down the male bays that actually have shelters in them.
 *
 * A crew at the headland has to pick which bay to turn down. Every pass line
 * on the map is noise — most of them have no shelters — and the crew route is a
 * driving path with headland links, which answers a different question. What
 * identifies a bay is a line down its middle, running the length of the field
 * and out past the boundary so it is visible from outside.
 *
 * Built from `maleBayBands()`, so these are the same bays the office plans and
 * the crew route drives; nothing here re-derives the geometry.
 */

import { maleBayBands } from './bayOverlays'
import type { FieldDict } from './tentGrid'

export interface BayGuide {
  /** The band's pass index, as the office numbers it. */
  pass: number
  /** [[lng, lat], [lng, lat]] — the bay's centreline. */
  coordinates: [[number, number], [number, number]]
  /** Midpoint, for a label. */
  label: [number, number]
}

const M_PER_DEG_LAT = 111_320
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/** Perpendicular distance in metres from a point to an infinite line. */
export function distToLineM(
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const latMid = (a[1] + b[1]) / 2
  const sx = mPerDegLng(latMid)
  const ax = a[0] * sx
  const ay = a[1] * M_PER_DEG_LAT
  const bx = b[0] * sx
  const by = b[1] * M_PER_DEG_LAT
  const px = p.lng * sx
  const py = p.lat * M_PER_DEG_LAT
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return Math.hypot(px - ax, py - ay)
  // |cross product| / |direction| — distance to the LINE, not the segment,
  // because a bay runs the length of the field and a shelter near either end
  // still belongs to it.
  return Math.abs(dx * (ay - py) - (ax - px) * dy) / len
}

/**
 * Centreline of every male bay that has shelters beside it.
 *
 * NEAREST-centreline, not containment. A male bay here is about 1.1 m wide and
 * the shelters sit roughly 2 m off it — beside the male rows, not on them — so
 * testing whether a shelter falls inside the band finds nothing at all. Each
 * shelter is therefore assigned to the closest bay, which is the same
 * assignment crewRoute() makes when it groups shelters into bays to drive.
 *
 * `extendM` is measured past the FIELD BOUNDARY, not past the bay.
 *
 * The bands only span the pivot's own extent — its circle — so on a quarter
 * with a square boundary around a circular pivot, extending past the band left
 * the line finishing well inside the field, nowhere near the headland someone
 * is standing on. Each guide is therefore stretched to cover the boundary's
 * full reach along its own direction, and then the margin is added.
 */
export function bayGuides(
  field: FieldDict,
  shelters: Array<{ lat: number; lng: number }>,
  extendM = 40,
  /** Field boundary as [lat, lng] pairs. Without it, the bay's own extent. */
  boundary?: Array<[number, number]> | null,
): BayGuide[] {
  if (shelters.length === 0) return []

  let bands
  try {
    bands = maleBayBands(field)
  } catch {
    // A field whose frame cannot be built gets no guides rather than a crash.
    return []
  }

  // Every bay's centreline first: the ring is [lo,alongMin], [hi,alongMin],
  // [hi,alongMax], [lo,alongMax] — a rotated rectangle — so the centreline
  // joins the midpoints of the two SHORT ends.
  const centres: Array<{ pass: number; a: [number, number]; b: [number, number] }> = []
  for (const band of bands.features) {
    const ring = band.geometry?.coordinates?.[0]
    if (!Array.isArray(ring) || ring.length < 4) continue
    const [c0, c1, c2, c3] = ring as Array<[number, number]>
    centres.push({
      pass: Number((band.properties as { pass?: number } | null)?.pass ?? 0),
      a: [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2],
      b: [(c2[0] + c3[0]) / 2, (c2[1] + c3[1]) / 2],
    })
  }
  if (centres.length === 0) return []

  // Which bays are being worked: the one nearest each shelter.
  const used = new Set<number>()
  for (const s of shelters) {
    let bestI = -1
    let bestD = Infinity
    for (let i = 0; i < centres.length; i++) {
      const d = distToLineM(s, centres[i].a, centres[i].b)
      if (d < bestD) {
        bestD = d
        bestI = i
      }
    }
    if (bestI >= 0) used.add(bestI)
  }

  const out: BayGuide[] = []
  for (const i of [...used].sort((x, y) => x - y)) {
    const { pass, a, b } = centres[i]
    const [startLng, startLat] = a
    const [endLng, endLat] = b

    const latMid = (startLat + endLat) / 2
    const dxM = (endLng - startLng) * mPerDegLng(latMid)
    const dyM = (endLat - startLat) * M_PER_DEG_LAT
    const len = Math.hypot(dxM, dyM)
    if (!Number.isFinite(len) || len < 1) continue

    // How far the line must run to clear the field, measured ALONG its own
    // direction: project every boundary corner onto it and take the extremes.
    const ux = dxM / len
    const uy = dyM / len
    const sx = mPerDegLng(latMid)
    let tMin = 0
    let tMax = len
    if (boundary && boundary.length >= 3) {
      for (const [blat, blng] of boundary) {
        if (!Number.isFinite(blat) || !Number.isFinite(blng)) continue
        const vx = (blng - startLng) * sx
        const vy = (blat - startLat) * M_PER_DEG_LAT
        const t = vx * ux + vy * uy
        if (t < tMin) tMin = t
        if (t > tMax) tMax = t
      }
    }

    const at = (t: number): [number, number] => [
      startLng + ((ux * t) / sx),
      startLat + (uy * t) / M_PER_DEG_LAT,
    ]

    out.push({
      pass,
      coordinates: [at(tMin - extendM), at(tMax + extendM)],
      label: [(startLng + endLng) / 2, (startLat + endLat) / 2],
    })
  }
  return out
}

/**
 * The shift that puts the nearest male bay under where you are parked.
 *
 * The grid is computed from a pivot and an angle; the planter drove where it
 * drove. Rather than measuring that error, park in a bay and say "the line is
 * here" — this returns the east/north shift that makes it so.
 *
 * Snapping to the NEAREST bay is the whole trick: it needs no bay number, no
 * typing, and no decision from someone holding a phone in a field. It is also
 * why the answer is only trustworthy within half a bay spacing — see `movedM`,
 * which the caller should show before applying.
 */
export function shiftToParkedBay(
  field: FieldDict,
  at: { lat: number; lng: number },
): { dEastM: number; dNorthM: number; movedM: number; pass: number } | null {
  let bands
  try {
    bands = maleBayBands(field)
  } catch {
    return null
  }

  let best: { pass: number; a: [number, number]; b: [number, number]; d: number } | null = null
  for (const band of bands.features) {
    const ring = band.geometry?.coordinates?.[0]
    if (!Array.isArray(ring) || ring.length < 4) continue
    const [c0, c1, c2, c3] = ring as Array<[number, number]>
    const a: [number, number] = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2]
    const b: [number, number] = [(c2[0] + c3[0]) / 2, (c2[1] + c3[1]) / 2]
    const d = distToLineM(at, a, b)
    if (!Number.isFinite(d)) continue
    if (!best || d < best.d) {
      best = { pass: Number((band.properties as { pass?: number } | null)?.pass ?? 0), a, b, d }
    }
  }
  if (!best) return null

  // Perpendicular from the line to the parked point, in metres. The SIGN comes
  // from the cross product: which side of the bay you are standing on decides
  // which way the grid moves.
  const latMid = (best.a[1] + best.b[1]) / 2
  const sx = mPerDegLng(latMid)
  const ax = best.a[0] * sx
  const ay = best.a[1] * M_PER_DEG_LAT
  const bx = best.b[0] * sx
  const by = best.b[1] * M_PER_DEG_LAT
  const px = at.lng * sx
  const py = at.lat * M_PER_DEG_LAT

  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null
  const ux = dx / len
  const uy = dy / len

  // Perpendicular unit vector, and the signed distance along it.
  const nx = -uy
  const ny = ux
  const signed = (px - ax) * nx + (py - ay) * ny

  return { dEastM: nx * signed, dNorthM: ny * signed, movedM: Math.abs(signed), pass: best.pass }
}
