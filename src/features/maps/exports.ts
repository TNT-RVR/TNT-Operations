import type { FieldGeometry } from '@/data/types'

/**
 * Field export formatters. Pure string builders (unit-tested) plus a small
 * browser download helper. Produces the interchange formats the old app emitted
 * for field crews and equipment: shelter-pin KML (Google Earth), a GeoJSON
 * bundle (tablet / GIS), and a CSV of coordinates (spreadsheets).
 */

export interface LatLng {
  lat: number
  lng: number
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Stored [lat,lon] boundary ring → closed [lon,lat] list; null if too small. */
function boundaryRing(geom: FieldGeometry | undefined): Array<[number, number]> | null {
  const poly = geom?.boundary_polygon
  if (!Array.isArray(poly) || poly.length < 3) return null
  const ring = poly.map((p) => [Number((p as unknown[])[0]), Number((p as unknown[])[1])] as [number, number])
  return ring.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
}

/** CSV of shelter coordinates (1-indexed). */
export function shelterCsv(positions: LatLng[]): string {
  const rows = positions.map((p, i) => `${i + 1},${p.lat.toFixed(7)},${p.lng.toFixed(7)}`)
  return ['shelter,latitude,longitude', ...rows].join('\n') + '\n'
}

/** KML with a boundary polygon (if any) + numbered shelter placemarks. */
export function sheltersKml(name: string, positions: LatLng[], geom?: FieldGeometry): string {
  const ring = boundaryRing(geom)
  const boundaryKml = ring
    ? `<Placemark><name>Boundary</name><Polygon><outerBoundaryIs><LinearRing><coordinates>` +
      [...ring, ring[0]].map(([lat, lon]) => `${lon},${lat},0`).join(' ') +
      `</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    : ''
  const pins = positions
    .map((p, i) => `<Placemark><name>${i + 1}</name><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`)
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${boundaryKml}${pins}</Document></kml>\n`
  )
}

/** GeoJSON FeatureCollection: boundary polygon + shelter points. */
export function fieldGeoJson(name: string, positions: LatLng[], geom?: FieldGeometry): string {
  const ring = boundaryRing(geom)
  const features: unknown[] = []
  if (ring) {
    features.push({
      type: 'Feature',
      properties: { kind: 'boundary', field: name },
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]].map(([lat, lon]) => [lon, lat])] },
    })
  }
  for (let i = 0; i < positions.length; i++) {
    features.push({
      type: 'Feature',
      properties: { kind: 'shelter', shelter: i + 1 },
      geometry: { type: 'Point', coordinates: [positions[i].lng, positions[i].lat] },
    })
  }
  return JSON.stringify({ type: 'FeatureCollection', name, features }, null, 2)
}

/** Trigger a client-side download of text content. Browser-only. */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Filesystem-safe slug for a field name. */
export function slug(name: string): string {
  return (name || 'field').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'field'
}
