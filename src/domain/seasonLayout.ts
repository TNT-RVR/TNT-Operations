/**
 * "Use last year's layout on this field?" — answered with numbers, not faith.
 *
 * A season carries its own placement geometry because rows, angles and spacing
 * change with the crop and the company; the boundary does not, so it lives on
 * the field. Copying a season forward therefore leaves the layout empty on
 * purpose, and this is what fills it: take last year's parameters, apply them
 * to the field's boundary, and report what would actually be placed.
 *
 * The point is that the preview is the SAME computation the map runs. If it
 * says 132 shelters, the map will place 132 shelters — a preview that
 * approximated would be worse than none, because it would be believed.
 */
import { getTentPositions, NotPortedError, type FieldDict } from './tentGrid'
import { ringAcres } from '@/features/maps/importBoundary'

export interface LayoutPreview {
  /** Pins the engine would place, ready to draw. */
  pins: Array<{ lat: number; lng: number }>
  shelters: number
  acres: number | null
  /** Acres per shelter — the number growers and crews argue about. */
  acresPerShelter: number | null
  /** Why there is nothing to show, when there isn't. */
  problem: string | null
}

const EMPTY: LayoutPreview = { pins: [], shelters: 0, acres: null, acresPerShelter: null, problem: null }

/** The dict the engine wants: last year's parameters over this field's outline. */
export function layoutDict(
  boundary: Record<string, unknown>,
  geometry: Record<string, unknown>,
): Record<string, unknown> {
  // Boundary last: the field's outline wins over whatever the old season
  // happened to carry, which is the whole reason the two are stored apart.
  return { ...geometry, ...boundary }
}

/**
 * What last season's layout would do on this field.
 *
 * Never throws. A field can hit placement modes that were never ported
 * (`NotPortedError`), and a preview that crashes the setup screen would make
 * the season unfinishable — so an unsupported field says so and offers the
 * alternative, which is drawing it on the map.
 */
export function previewLayout(
  boundary: Record<string, unknown>,
  geometry: Record<string, unknown>,
): LayoutPreview {
  if (!geometry || Object.keys(geometry).length === 0) {
    return { ...EMPTY, problem: 'No layout recorded for that season.' }
  }
  const dict = layoutDict(boundary, geometry)
  // Checked on the BOUNDARY, not the merged dict: an old season carries its own
  // Radius, so merging first would let last year's outline stand in for a field
  // that has none — which is the one thing storing the two apart is meant to
  // prevent. It also produced a misleading "places no shelters" instead of
  // "draw a boundary".
  const hasOutline =
    Array.isArray((boundary as { boundary_polygon?: unknown }).boundary_polygon) ||
    (Number((boundary as { Radius?: unknown }).Radius) > 0 &&
      Number.isFinite(Number((boundary as { PP_Latitude?: unknown }).PP_Latitude)))
  if (!hasOutline) return { ...EMPTY, problem: 'This field has no boundary yet — draw one on the map first.' }

  let pins: Array<{ lat: number; lng: number }> = []
  try {
    pins = getTentPositions(dict as FieldDict)
  } catch (e) {
    if (e instanceof NotPortedError) {
      return { ...EMPTY, problem: 'This field uses planter-pass placement, which the map still has to do.' }
    }
    return { ...EMPTY, problem: e instanceof Error ? e.message : 'The layout could not be computed.' }
  }

  const ring = (dict as { boundary_polygon?: Array<[number, number]> }).boundary_polygon
  const acres = Array.isArray(ring) && ring.length >= 3 ? ringAcres(ring) : readAcres(dict)

  return {
    pins,
    shelters: pins.length,
    acres,
    acresPerShelter: acres && pins.length > 0 ? acres / pins.length : null,
    problem: pins.length === 0 ? 'These settings place no shelters on this boundary.' : null,
  }
}

const SQ_M_PER_ACRE = 4046.8564224

/**
 * A pivot has no ring to measure, so its area comes from its radius — most of
 * TNT's fields are pivots, and without this the acres-per-shelter figure, which
 * is the one growers actually argue about, reads "—" on nearly every field.
 *
 * A recorded acreage wins: a pivot is rarely a whole circle once corners and
 * exclusions are taken out, and someone who typed a number measured the field.
 */
function readAcres(dict: Record<string, unknown>): number | null {
  const recorded = Number(dict.acres)
  if (Number.isFinite(recorded) && recorded > 0) return recorded
  const r = Number(dict.Radius)
  if (Number.isFinite(r) && r > 0) return (Math.PI * r * r) / SQ_M_PER_ACRE
  return null
}

/**
 * How last year's layout differs from what is recorded now, in the terms
 * someone would ask about. Used to explain a preview rather than just show it.
 */
export function describeLayout(geometry: Record<string, unknown>): string[] {
  const out: string[] = []
  // Absent and zero are different: 0 rows means nothing, but a 0° planting
  // angle is north–south and is the commonest setting on these fields.
  const n = (k: string) => {
    const v = Number(geometry[k])
    return Number.isFinite(v) && v !== 0 ? v : null
  }
  const angleOf = (k: string) => {
    const raw = geometry[k]
    if (raw === undefined || raw === null || raw === '') return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  }
  const rows = n('total_rows')
  const female = n('num_female_rows')
  const male = n('num_male_rows')
  const spacing = n('row_spacing_in')
  const angle = angleOf('planting_angle')
  if (female && male) out.push(`${female}F / ${male}M bays`)
  else if (rows) out.push(`${rows} rows`)
  if (spacing) out.push(`${spacing}" row spacing`)
  if (angle !== null) out.push(`${angle}° planting angle`)
  const mode = String(geometry.shelter_mode ?? '')
  if (mode) out.push(`${mode} count`)
  return out
}
