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

/** GeoJSON FeatureCollection object: boundary polygon + shelter points. */
export function fieldFeatureCollection(name: string, positions: LatLng[], geom?: FieldGeometry) {
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
  return { type: 'FeatureCollection' as const, name, features }
}

/** GeoJSON FeatureCollection string: boundary polygon + shelter points. */
export function fieldGeoJson(name: string, positions: LatLng[], geom?: FieldGeometry): string {
  return JSON.stringify(fieldFeatureCollection(name, positions, geom), null, 2)
}

/**
 * Printable field PDF: header, metadata lines, and a shelter coordinate table.
 * jsPDF is dynamic-imported so it stays out of the main bundle.
 */
export async function fieldPdf(name: string, metaLines: string[], positions: LatLng[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const M = 48
  let y = M
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(name || 'Field', M, y)
  y += 22
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  for (const line of metaLines) {
    doc.text(line, M, y)
    y += 14
  }
  y += 10
  doc.setTextColor(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(`Shelters (${positions.length})`, M, y)
  y += 16
  doc.setFont('courier', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(40)
  doc.text('#      Latitude        Longitude', M, y)
  y += 12
  const pageH = doc.internal.pageSize.getHeight()
  positions.forEach((p, i) => {
    if (y > pageH - M) {
      doc.addPage()
      y = M
    }
    const num = String(i + 1).padEnd(6)
    doc.text(`${num} ${p.lat.toFixed(7).padStart(13)}  ${p.lng.toFixed(7).padStart(13)}`, M, y)
    y += 11
  })
  return doc.output('blob')
}

/** Zipped shapefile (.zip: shelters points + boundary polygon) for JD / GIS. */
export async function shelterShapefileZip(name: string, positions: LatLng[], geom?: FieldGeometry): Promise<Blob> {
  const shpwrite = await import('@mapbox/shp-write')
  const gj = fieldFeatureCollection(name, positions, geom) as unknown as GeoJSON.FeatureCollection
  const out = await shpwrite.zip<'blob'>(gj, {
    outputType: 'blob',
    compression: 'DEFLATE',
    types: { point: 'shelters', polygon: 'boundary' },
  })
  return out as Blob
}

/** Trigger a client-side download of a Blob. Browser-only. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Trigger a client-side download of text content. Browser-only. */
export function downloadText(filename: string, mime: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: mime }))
}

/** Filesystem-safe slug for a field name. */
export function slug(name: string): string {
  return (name || 'field').trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'field'
}
