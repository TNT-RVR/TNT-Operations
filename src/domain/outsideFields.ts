/**
 * Blocks whose GPS lands outside every field boundary.
 *
 * Two quite different things get called "missing", and only one of them is a
 * data-entry problem:
 *
 *  - A placement with NO field recorded. The scan never got attributed, which
 *    the returns map already counts.
 *  - A placement filed under a field whose own boundary does not contain the
 *    point. That is this module. It usually means the boundary is missing or
 *    wrong — a quarter drawn from an old survey, a pivot moved, a field never
 *    traced — and it is invisible on a per-field map because the point still
 *    shows up under the field it was filed against.
 *
 * The second kind is worth seeing on a map: a scatter of outside-blocks that
 * all sit in the same shape IS the missing boundary, drawn by the crew's own
 * phones.
 */

import { fieldFrame, pointInEnuRing } from './fieldFrame'
import type { FieldDict } from './tentGrid'
import { latlonListToEnu } from './geo'

export interface FieldLike {
  id: string
  name: string
  geometry?: unknown
}

export interface PlacementLike {
  id: string
  blockId: string
  /** The field the scan was filed under. Null when nothing was recorded. */
  fieldId: string | null
  lat: number | null
  lng: number | null
  season?: number | null
}

export interface OutsidePoint {
  placementId: string
  blockId: string
  lat: number
  lng: number
  /** The field it was filed under, or null when the scan recorded none. */
  filedUnder: string | null
}

export interface OutsideTally {
  /** The field these were filed under; null = no field recorded. */
  fieldId: string | null
  count: number
}

export interface OutsideReport {
  /** Every located placement that falls in no boundary at all. */
  points: OutsidePoint[]
  /** Counts by the field they were filed under, biggest first. */
  byFiledField: OutsideTally[]
  /** How many placements had a location to test in the first place. */
  located: number
  /**
   * Fields that cannot answer the question — no pivot, no boundary.
   *
   * Reported rather than silently treated as "contains nothing", because a
   * field with no boundary makes every block near it look like an orphan and
   * that is a different fix (trace the field) from a bad scan.
   */
  fieldsWithoutBoundary: string[]
}

/**
 * Which located placements fall inside none of the fields.
 *
 * Frames are built once per field rather than once per point: a season can run
 * to 14,000 blocks, and rebuilding a projection for each of them against each
 * field is the difference between instant and a locked-up phone.
 */
export function blocksOutsideFields(
  fields: FieldLike[],
  placements: PlacementLike[],
  season?: number,
): OutsideReport {
  const frames: Array<{ id: string; frame: NonNullable<ReturnType<typeof fieldFrame>> }> = []
  const fieldsWithoutBoundary: string[] = []

  for (const f of fields) {
    const frame = f.geometry ? fieldFrame(f.geometry as FieldDict) : null
    // A frame with no boundary ring falls back to a radius, which is a fair
    // approximation of a pivot but not of a square quarter — still better than
    // calling every block near it an orphan.
    if (frame) frames.push({ id: f.id, frame })
    else fieldsWithoutBoundary.push(f.id)
  }

  const points: OutsidePoint[] = []
  let located = 0

  for (const p of placements) {
    if (season != null && p.season !== season) continue
    if (p.lat == null || p.lng == null) continue
    located++

    let inside = false
    for (const { frame } of frames) {
      const [[e, n]] = latlonListToEnu([[p.lat, p.lng]], frame.pivotLon, frame.pivotLat)
      const ring = frame.boundaryEnu
      const hit =
        ring && ring.length >= 3
          ? pointInEnuRing(ring, e, n)
          : e * e + n * n <= frame.radius * frame.radius
      if (hit) {
        inside = true
        break
      }
    }
    if (inside) continue

    points.push({
      placementId: p.id,
      blockId: p.blockId,
      lat: p.lat,
      lng: p.lng,
      filedUnder: p.fieldId ?? null,
    })
  }

  const counts = new Map<string | null, number>()
  for (const pt of points) counts.set(pt.filedUnder, (counts.get(pt.filedUnder) ?? 0) + 1)

  const byFiledField = [...counts.entries()]
    .map(([fieldId, count]) => ({ fieldId, count }))
    // Biggest first: the field with forty orphans is the one with a boundary
    // problem, and it should not be below the one with a single stray scan.
    .sort((a, b) => b.count - a.count)

  return { points, byFiledField, located, fieldsWithoutBoundary }
}
