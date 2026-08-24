/**
 * The season's fields, in the shape every screen already speaks.
 *
 * Field Mode, the scanners and the map all take a `Field` — a place plus one
 * geometry dict. The new model keeps those apart on purpose (the boundary is
 * the field's, the layout is the season's), so this puts them back together for
 * the year being worked, and hands back exactly what those screens expect.
 *
 * ── Why it falls back ────────────────────────────────────────────────────────
 *
 * A season that has been through Season Setup is authoritative. A season that
 * has not falls back to the map's own list, so nothing depends on a migration
 * finishing before it can work. 2026 keeps running off `shelter_fields` while
 * 2027 runs off `field_seasons`, and neither knows about the other.
 *
 * ── The id matters more than it looks ────────────────────────────────────────
 *
 * Block placements and shelter scans carry `field_id`, a foreign key into
 * `shelter_fields`. So a season that came from a map row keeps THAT id — a crew
 * scanning a block must land on the same field the office sees. A season with
 * no map row yet is handed its own id, and cannot receive scans until one
 * exists; `ensureMapRow` in the provider is what closes that gap.
 */
import type { Field, FieldSeason } from '@/data/types'

/** One season → the `Field` the screens want. */
export function seasonAsField(season: FieldSeason): Field | null {
  const place = season.field
  if (!place) return null
  const geometry: Record<string, unknown> = {
    // Layout first, then the FIELD's boundary over it — the same order as
    // `layoutDict` in seasonLayout.ts, and for the same reason: a season
    // copied forward carries the whole of last year's dict, boundary keys
    // included, and that stale outline must not win over the field's real one.
    // The two must agree, or the layout preview and Field Mode would draw
    // different shapes for one field.
    ...season.geometry,
    ...place.boundary,
    year: season.year,
    company: season.company,
    crop: season.crop,
    lld: place.lld,
  }
  if (season.acres != null) geometry.acres = String(season.acres)

  return {
    id: season.shelterFieldId ?? season.id,
    name: place.name,
    client: season.company || place.grower,
    region: place.region,
    shapeType: place.boundary.boundary_polygon ? 'polygon' : 'pivot',
    shelterCount: season.plannedShelters ?? 0,
    updatedAt: new Date().toISOString(),
    geometry,
  }
}

/**
 * The fields to work for `year`.
 *
 * `seasons` is every season loaded; `mapFields` is the map's own list. Returns
 * the season's fields when that season exists, and the map's otherwise.
 */
export function seasonFields(year: string, seasons: FieldSeason[], mapFields: Field[]): Field[] {
  const forYear = seasons.filter((s) => s.year === year && s.field)
  if (forYear.length > 0) {
    return forYear
      .map(seasonAsField)
      .filter((f): f is Field => f !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  // No season set up: the map's list, restricted to that year when its rows say
  // which year they are for. A map row with no year at all is kept rather than
  // hidden — it is somebody's unfinished work, not another season's.
  const stamped = mapFields.filter((f) => String(f.geometry?.year ?? '').trim() === year)
  return (stamped.length > 0 ? stamped : mapFields.filter((f) => !String(f.geometry?.year ?? '').trim()))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Whether a season's field can take crew scans yet.
 *
 * A field declared in Season Setup but never given a map row has no
 * `shelter_fields` id, and every scan table's foreign key points there — so a
 * crew scanning it would fail at the database rather than in the app, which is
 * the worst place to find out.
 */
export function canReceiveScans(season: FieldSeason): boolean {
  return Boolean(season.shelterFieldId)
}
