import { area as turfArea } from '@turf/turf'
import type { Feature, FeatureCollection, GeoJsonObject, Geometry, Polygon, Position } from 'geojson'

/**
 * Boundary import + geometry helpers for field authoring. Reads KML / KMZ /
 * zipped-shapefile files (or a freehand-drawn ring) and produces the stored
 * boundary format: an array of [lat, lon] points (old-app convention). Also
 * computes acreage so the per-acre / tray placement modes work immediately.
 *
 * The GeoJSON-shaped helpers are pure and unit-tested; the file/XML parsers run
 * in the browser (DOMParser + async unzip) and are exercised at runtime.
 */

const M2_PER_ACRE = 4046.8564224

type LatLon = [number, number]

/** Depth-first search for the first Polygon/MultiPolygon outer ring ([lon,lat]). */
export function firstPolygonRingLngLat(gj: GeoJsonObject | null | undefined): Position[] | null {
  if (!gj) return null
  const g = gj as { type?: string }
  switch (g.type) {
    case 'FeatureCollection': {
      for (const f of (gj as FeatureCollection).features) {
        const r = firstPolygonRingLngLat(f)
        if (r) return r
      }
      return null
    }
    case 'Feature':
      return firstPolygonRingLngLat((gj as Feature).geometry as GeoJsonObject)
    case 'GeometryCollection': {
      for (const geom of (gj as unknown as { geometries: Geometry[] }).geometries) {
        const r = firstPolygonRingLngLat(geom)
        if (r) return r
      }
      return null
    }
    case 'Polygon': {
      const coords = (gj as Polygon).coordinates
      return coords && coords[0] && coords[0].length >= 4 ? coords[0] : null
    }
    case 'MultiPolygon': {
      const coords = (gj as unknown as { coordinates: Position[][][] }).coordinates
      for (const poly of coords) {
        if (poly[0] && poly[0].length >= 4) return poly[0]
      }
      return null
    }
    default:
      return null
  }
}

/** [lon,lat] ring → stored [lat,lon] ring, dropping a duplicate closing point. */
export function toLatLonRing(ring: Position[]): LatLon[] {
  const out: LatLon[] = ring.map((p) => [Number(p[1]), Number(p[0])] as LatLon)
  if (out.length > 1) {
    const a = out[0]
    const b = out[out.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) out.pop()
  }
  return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

/** Acres enclosed by a stored [lat,lon] ring. */
export function ringAcres(ringLatLon: LatLon[]): number {
  if (ringLatLon.length < 3) return 0
  const lngLat: Position[] = ringLatLon.map(([lat, lon]) => [lon, lat])
  lngLat.push(lngLat[0]) // close for turf
  const poly: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [lngLat] } }
  return turfArea(poly) / M2_PER_ACRE
}

export interface BoundaryResult {
  /** Outer ring as stored [lat,lon] points (not closed). */
  ring: LatLon[]
  /** Acres, rounded to 2 dp. */
  acres: number
}

/** Compose a boundary result from any GeoJSON object, or null if no polygon. */
export function geojsonToBoundary(gj: GeoJsonObject | null | undefined): BoundaryResult | null {
  const ringLngLat = firstPolygonRingLngLat(gj)
  if (!ringLngLat) return null
  const ring = toLatLonRing(ringLngLat)
  if (ring.length < 3) return null
  return { ring, acres: Math.round(ringAcres(ring) * 100) / 100 }
}

/** Parse a KML string (browser DOMParser) → boundary, or null. */
export async function parseKmlText(text: string): Promise<BoundaryResult | null> {
  const { kml } = await import('@tmcw/togeojson')
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  return geojsonToBoundary(kml(doc) as unknown as GeoJsonObject)
}

/** Parse a KMZ (zipped KML) ArrayBuffer → boundary. */
export async function parseKmz(buf: ArrayBuffer): Promise<BoundaryResult | null> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const entry = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.kml'))
  if (!entry) return null
  const text = await zip.files[entry].async('text')
  return parseKmlText(text)
}

/** Parse a zipped shapefile (.zip with .shp/.dbf) ArrayBuffer → boundary. */
export async function parseShapefileZip(buf: ArrayBuffer): Promise<BoundaryResult | null> {
  const shp = (await import('shpjs')).default
  const gj = (await shp(buf)) as unknown as GeoJsonObject | GeoJsonObject[]
  const one = Array.isArray(gj) ? ({ type: 'FeatureCollection', features: gj.flatMap((c) => (c as FeatureCollection).features ?? []) } as FeatureCollection) : gj
  return geojsonToBoundary(one)
}

/** Read a user-picked file (.kml/.kmz/.zip/.shp) into a boundary. Throws on unsupported/empty. */
export async function boundaryFromFile(file: File): Promise<BoundaryResult> {
  const name = file.name.toLowerCase()
  let result: BoundaryResult | null = null
  if (name.endsWith('.kml')) result = await parseKmlText(await file.text())
  else if (name.endsWith('.kmz')) result = await parseKmz(await file.arrayBuffer())
  else if (name.endsWith('.zip') || name.endsWith('.shp')) result = await parseShapefileZip(await file.arrayBuffer())
  else throw new Error(`Unsupported file type: ${file.name}. Use .kml, .kmz, or a zipped shapefile (.zip).`)
  if (!result) throw new Error(`No polygon boundary found in ${file.name}.`)
  return result
}
