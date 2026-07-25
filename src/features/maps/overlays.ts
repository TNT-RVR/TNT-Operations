import { circle as turfCircle } from '@turf/turf'
import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson'
import type { FieldGeometry } from '@/data/types'

/**
 * Pure geometry → GeoJSON helpers for the shelter-map OVERLAYS the old desktop
 * app drew but the port was missing: pivot wheel tracks, inner/access/wet
 * exclusion zones, corner-arm exclusions, and entrance/parking/home pins.
 *
 * All stored coordinates are [lat, lon] (old-app convention); GeoJSON wants
 * [lon, lat], so every point is flipped here. Radii/exclusions are metres.
 */

const num = (v: unknown): number => Number(v)
const FT_TO_M = 0.3048

const emptyFC = <T extends Polygon | LineString>(): FeatureCollection<T> => ({
  type: 'FeatureCollection',
  features: [],
})

/** [lat, lon] → [lon, lat], or null if not a finite pair. */
function toLngLat(p: unknown): Position | null {
  if (!Array.isArray(p) || p.length < 2) return null
  const lat = num(p[0])
  const lon = num(p[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return [lon, lat]
}

/** A [lat,lon] ring → a closed [lon,lat] ring (≥3 distinct points), else null. */
function toRing(r: unknown): Position[] | null {
  if (!Array.isArray(r) || r.length < 3) return null
  const out: Position[] = []
  for (const p of r) {
    const c = toLngLat(p)
    if (c) out.push(c)
  }
  if (out.length < 3) return null
  out.push(out[0]) // close
  return out
}

/**
 * Normalise a value that may be a single ring (`[[lat,lon],…]`) or a list of
 * rings (`[[[lat,lon],…],…]`) into an array of closed [lon,lat] rings.
 */
function toRingList(v: unknown): Position[][] {
  if (!Array.isArray(v) || v.length === 0) return []
  const first = v[0] as unknown
  const isSingleRing = Array.isArray(first) && typeof (first as unknown[])[0] === 'number'
  const rings = isSingleRing ? [v] : (v as unknown[])
  const out: Position[][] = []
  for (const r of rings) {
    const rr = toRing(r)
    if (rr) out.push(rr)
  }
  return out
}

function pivotCenter(geom: FieldGeometry): Position | null {
  const lon = num(geom.PP_Longitude)
  const lat = num(geom.PP_Latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return [lon, lat]
}

/**
 * Pivot wheel-track rings: for each track radius r (metres), the r±exclusion
 * ring pair, matching the old app's red track bands. Rendered as polygon
 * outlines via a line layer.
 */
export function trackRings(geom: FieldGeometry): FeatureCollection<Polygon> {
  const c = pivotCenter(geom)
  const tracks = (Array.isArray(geom.pivot_tracks) ? (geom.pivot_tracks as unknown[]) : [])
    .map(num)
    .filter((r) => Number.isFinite(r) && r > 0)
  if (!c || tracks.length === 0) return emptyFC<Polygon>()
  const exclM = (Number.isFinite(num(geom.track_exclusion_ft)) ? num(geom.track_exclusion_ft) : 10) * FT_TO_M
  const feats: Feature<Polygon>[] = []
  for (const r of tracks) {
    for (const rr of [r - exclM, r + exclM]) {
      if (rr <= 0) continue
      feats.push(turfCircle(c, rr / 1000, { steps: 96, units: 'kilometers' }) as Feature<Polygon>)
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

/** Ring-list value (inner boundary, access road, wet zones) → filled polygons. */
export function ringPolygons(v: unknown): FeatureCollection<Polygon> {
  const rings = toRingList(v)
  return {
    type: 'FeatureCollection',
    features: rings.map((r) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [r] },
    })),
  }
}

/** Corner-arm exclusions: `path` arms → red polylines, `circle` arms → red rings. */
export function cornerArms(geom: FieldGeometry): {
  lines: FeatureCollection<LineString>
  circles: FeatureCollection<Polygon>
} {
  const arms = Array.isArray(geom.corner_arms) ? (geom.corner_arms as unknown[]) : []
  const lines: Feature<LineString>[] = []
  const circles: Feature<Polygon>[] = []
  for (const armRaw of arms) {
    if (typeof armRaw !== 'object' || armRaw === null) continue
    const arm = armRaw as Record<string, unknown>
    if (arm.type === 'path') {
      const pts = Array.isArray(arm.pts) ? (arm.pts as unknown[]) : []
      const coords: Position[] = []
      for (const p of pts) {
        const c = toLngLat(p)
        if (c) coords.push(c)
      }
      if (coords.length >= 2) {
        lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
      }
    } else if (arm.type === 'circle') {
      const lon = num(arm.lon)
      const lat = num(arm.lat)
      const rad = num(arm.radius_m)
      if (Number.isFinite(lon) && Number.isFinite(lat) && rad > 0) {
        circles.push(turfCircle([lon, lat], rad / 1000, { steps: 64, units: 'kilometers' }) as Feature<Polygon>)
      }
    }
  }
  return {
    lines: { type: 'FeatureCollection', features: lines },
    circles: { type: 'FeatureCollection', features: circles },
  }
}

export type PinKind = 'entrance' | 'parking' | 'home'
export interface OverlayPin {
  kind: PinKind
  lng: number
  lat: number
}

/** Entrance / parking / home marker pins (each stored as a single [lat,lon]). */
export function overlayPins(geom: FieldGeometry): OverlayPin[] {
  const out: OverlayPin[] = []
  const spec: Array<[string, PinKind]> = [
    ['entrance_pin', 'entrance'],
    ['parking_pin', 'parking'],
    ['home_pin', 'home'],
  ]
  for (const [key, kind] of spec) {
    const c = toLngLat(geom[key])
    if (c) out.push({ kind, lng: c[0], lat: c[1] })
  }
  return out
}

/** True when a geometry carries ANY overlay data (drives the legend). */
export function hasOverlays(geom: FieldGeometry | undefined): boolean {
  if (!geom) return false
  const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0
  return (
    nonEmpty(geom.pivot_tracks) ||
    nonEmpty(geom.boundary_inner) ||
    nonEmpty(geom.access_road_boundary) ||
    nonEmpty(geom.wet_zones) ||
    nonEmpty(geom.corner_arms) ||
    overlayPins(geom).length > 0
  )
}
