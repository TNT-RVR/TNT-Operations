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
 * `extendM` pushes each end past the field's along-extent, because the bands
 * already span it: without the extra, the line stops exactly where the crop
 * does, which is the one place it needs to be visible from.
 */
export function bayGuides(
  field: FieldDict,
  shelters: Array<{ lat: number; lng: number }>,
  extendM = 40,
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

    const dLng = ((dxM / len) * extendM) / mPerDegLng(latMid)
    const dLat = ((dyM / len) * extendM) / M_PER_DEG_LAT

    out.push({
      pass,
      coordinates: [
        [startLng - dLng, startLat - dLat],
        [endLng + dLng, endLat + dLat],
      ],
      label: [(startLng + endLng) / 2, (startLat + endLat) / 2],
    })
  }
  return out
}
