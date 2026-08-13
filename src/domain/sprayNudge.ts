/**
 * Lining the sprayer passes up with where the sprayer actually drove.
 *
 * Same idea as the male-bay button: the pass lines are computed from a width
 * and an angle, the sprayer drove where it drove. Park on a track, press once,
 * and the nearest pass line moves onto the vehicle.
 *
 * Unlike the bay shift — two numbers, east and north — the sprayer's offset is
 * a single lateral scalar, `sprayer_shift`, which the overlay generators
 * already apply. So this returns the NEW value for that field, not a delta.
 */

import { sprayerPassLines } from './sprayOverlays'
import type { FieldDict } from './tentGrid'

const M_PER_DEG_LAT = 111_320
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/** Perpendicular distance in metres from a point to a segment's infinite line. */
function distToLineM(
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const sx = mPerDegLng((a[1] + b[1]) / 2)
  const ax = a[0] * sx
  const ay = a[1] * M_PER_DEG_LAT
  const bx = b[0] * sx
  const by = b[1] * M_PER_DEG_LAT
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return Infinity
  return Math.abs(dx * (ay - p.lat * M_PER_DEG_LAT) - (ax - p.lng * sx) * dy) / len
}

/** How far the nearest pass line is from a point, and which pass it is. */
export function nearestPass(
  field: FieldDict,
  at: { lat: number; lng: number },
): { index: number; distM: number } | null {
  let lines
  try {
    lines = sprayerPassLines(field)
  } catch {
    return null
  }
  let best: { index: number; distM: number } | null = null
  for (const f of lines.features) {
    const c = f.geometry?.coordinates
    if (!Array.isArray(c) || c.length < 2) continue
    const d = distToLineM(at, c[0] as [number, number], c[c.length - 1] as [number, number])
    if (!Number.isFinite(d)) continue
    if (!best || d < best.distM) {
      best = { index: Number((f.properties as { index?: number } | null)?.index ?? 0), distM: d }
    }
  }
  return best
}

/**
 * The `sprayer_shift` that puts a pass line under where you are parked.
 *
 * The sign is found by TRYING it rather than deriving it. The lateral axis's
 * direction depends on the spray angle, the rotation convention and which way
 * the frame was built — three places to get a minus sign wrong, and the
 * failure mode is silent: the lines move the wrong way by exactly the right
 * amount. Applying each candidate and keeping whichever lands closer cannot be
 * wrong about that, and costs two geometry evaluations on a button press.
 */
export function shiftToParkedSprayPass(
  field: FieldDict,
  at: { lat: number; lng: number },
): { sprayerShiftM: number; movedM: number; index: number } | null {
  const before = nearestPass(field, at)
  if (!before) return null

  const current = Number(field['sprayer_shift'] ?? 0) || 0
  const candidates = [current + before.distM, current - before.distM]

  let best: { shift: number; dist: number; index: number } | null = null
  for (const shift of candidates) {
    const trial = nearestPass({ ...field, sprayer_shift: shift }, at)
    if (!trial) continue
    if (!best || trial.distM < best.dist) best = { shift, dist: trial.distM, index: trial.index }
  }
  if (!best) return null

  return {
    sprayerShiftM: Math.round(best.shift * 1000) / 1000,
    movedM: before.distM,
    index: best.index,
  }
}
