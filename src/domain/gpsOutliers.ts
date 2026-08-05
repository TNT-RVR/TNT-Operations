/**
 * Finding block positions that the GPS got wrong.
 *
 * A handheld fix under cloud, tree cover or beside a truck can land hundreds of
 * metres — occasionally kilometres — from where the block actually was. On an
 * interpolated map one such point doesn't just misplace itself: it drags a
 * whole region of colour with it, because IDW gives it full weight over the
 * empty space around it.
 *
 * Two independent methods, because they fail in different circumstances:
 *
 *   boundary  — if the field's shape is known, anything well outside it is
 *               wrong, full stop. Exact, and needs no assumptions.
 *   spread    — otherwise, judge each point against where the others are,
 *               using MEDIAN and MAD rather than mean and standard deviation.
 *               A mean is dragged by the very outliers we're hunting; a median
 *               is not. This is the standard robust approach.
 *
 * Nothing is deleted. Points are flagged with a distance and a reason so the
 * decision stays visible and reversible — a real block in an odd corner of a
 * field is not the same thing as a bad fix, and only a person can tell.
 */
import { haversineMeters } from './geo'
import { fieldFrame, pointInEnuRing } from './fieldFrame'
import type { FieldDict } from './tentGrid'
import { latlonListToEnu } from './geo'
import type { SamplePoint } from './returnsMap'

export interface OutlierOptions {
  /**
   * How far past the robust spread a point must sit to be called bad.
   * 1.4826·MAD estimates a standard deviation, so this is roughly "sigmas".
   * Lower is more aggressive.
   */
  madK?: number
  /**
   * Never flag anything inside this radius of the cluster centre. Stops a
   * tightly-clustered field from having its own edges trimmed off.
   */
  minRadiusM?: number
  /** Flag anything beyond this from the centre, whatever the statistics say. */
  hardLimitM?: number | null
  /** When clipping to a field, how far outside the boundary is still fine. */
  boundaryBufferM?: number
}

const DEFAULTS: Required<OutlierOptions> = {
  madK: 5,
  minRadiusM: 150,
  hardLimitM: 5000,
  boundaryBufferM: 60,
}

export interface FlaggedPoint {
  sample: SamplePoint
  /** Distance from the cluster centre, metres. */
  distM: number
  reason: 'outside-boundary' | 'far-from-others' | 'beyond-hard-limit'
}

export interface OutlierResult {
  keep: SamplePoint[]
  removed: FlaggedPoint[]
  /** Robust centre used for the distance test. */
  centre: { lat: number; lng: number } | null
  /** Distance past which a point was called bad (spread method only). */
  thresholdM: number | null
}

/** Median of a numeric list. Copies rather than sorting the caller's array. */
function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Flag bad GPS fixes among `samples`.
 *
 * Pass `field` when its geometry is known — the boundary is definitive and the
 * statistics are only a fallback. With fewer than 5 points nothing is flagged
 * by spread: there isn't enough to say what "normal" looks like, and guessing
 * would throw away real data.
 */
export function findGpsOutliers(
  samples: SamplePoint[],
  field?: FieldDict | null,
  opts: OutlierOptions = {},
): OutlierResult {
  const o = { ...DEFAULTS, ...opts }
  if (samples.length === 0) return { keep: [], removed: [], centre: null, thresholdM: null }

  // ── Boundary test, when the field's shape is known ────────────────────────
  const frame = field ? fieldFrame(field) : null
  if (frame && frame.boundaryEnu && frame.boundaryEnu.length >= 3) {
    const enu = latlonListToEnu(
      samples.map((s) => [s.lat, s.lng] as [number, number]),
      frame.pivotLon,
      frame.pivotLat,
    )
    const keep: SamplePoint[] = []
    const removed: FlaggedPoint[] = []
    for (let i = 0; i < samples.length; i++) {
      const [e, n] = enu[i]
      // The buffer forgives a metre or two of GPS noise on a block genuinely
      // sitting on the field edge.
      const inside =
        pointInEnuRing(frame.boundaryEnu, e, n) ||
        nearRing(frame.boundaryEnu, e, n, o.boundaryBufferM)
      if (inside) keep.push(samples[i])
      else removed.push({ sample: samples[i], distM: Math.hypot(e, n), reason: 'outside-boundary' })
    }
    return {
      keep,
      removed,
      centre: { lat: frame.pivotLat, lng: frame.pivotLon },
      thresholdM: null,
    }
  }

  // ── Spread test, using robust statistics ─────────────────────────────────
  // Median position, not mean: the mean is pulled towards the bad fixes we're
  // trying to find, which is how outliers hide themselves.
  const centre = {
    lat: median(samples.map((s) => s.lat)),
    lng: median(samples.map((s) => s.lng)),
  }
  const dists = samples.map((s) => haversineMeters({ lat: centre.lat, lng: centre.lng }, { lat: s.lat, lng: s.lng }))

  if (samples.length < 5) {
    // Too few to characterise the spread; only the absolute limit applies.
    const keep: SamplePoint[] = []
    const removed: FlaggedPoint[] = []
    samples.forEach((s, i) => {
      if (o.hardLimitM != null && dists[i] > o.hardLimitM) {
        removed.push({ sample: s, distM: dists[i], reason: 'beyond-hard-limit' })
      } else keep.push(s)
    })
    return { keep, removed, centre, thresholdM: o.hardLimitM }
  }

  const medDist = median(dists)
  // MAD → sigma. 1.4826 makes it comparable to a standard deviation for
  // normally-distributed data.
  const mad = median(dists.map((d) => Math.abs(d - medDist))) * 1.4826
  const threshold = Math.max(o.minRadiusM, medDist + o.madK * mad)

  const keep: SamplePoint[] = []
  const removed: FlaggedPoint[] = []
  samples.forEach((s, i) => {
    const d = dists[i]
    if (o.hardLimitM != null && d > o.hardLimitM) {
      removed.push({ sample: s, distM: d, reason: 'beyond-hard-limit' })
    } else if (d > threshold) {
      removed.push({ sample: s, distM: d, reason: 'far-from-others' })
    } else keep.push(s)
  })

  return { keep, removed, centre, thresholdM: threshold }
}

/** Whether (e,n) lies within `buffer` metres of a ring's edge. */
function nearRing(ring: Array<[number, number]>, e: number, n: number, buffer: number): boolean {
  if (buffer <= 0) return false
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % ring.length]
    best = Math.min(best, pointSegmentDist(e, n, ax, ay, bx, by))
    if (best <= buffer) return true
  }
  return best <= buffer
}

/** Shortest distance from a point to a line segment. */
function pointSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
