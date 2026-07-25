import { describe, it, expect } from 'vitest'
import { shelterCsv, sheltersKml, fieldGeoJson, slug } from './exports'

const POS = [
  { lat: 49.83, lng: -111.6 },
  { lat: 49.831, lng: -111.599 },
]
const GEOM = {
  boundary_polygon: [
    [49.83, -111.6],
    [49.832, -111.6],
    [49.832, -111.598],
  ],
}

describe('shelterCsv', () => {
  it('emits a header + one row per shelter, 1-indexed', () => {
    const csv = shelterCsv(POS)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('shelter,latitude,longitude')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('1,49.8300000,-111.6000000')
  })
})

describe('sheltersKml', () => {
  it('includes a placemark per shelter and a boundary polygon', () => {
    const kml = sheltersKml('BASF Test', POS, GEOM)
    expect(kml).toContain('<kml')
    expect((kml.match(/<Point>/g) || []).length).toBe(2)
    expect(kml).toContain('<Polygon>')
    // KML coordinates are lon,lat,0
    expect(kml).toContain('-111.6,49.83,0')
  })
  it('escapes the field name and omits boundary when absent', () => {
    const kml = sheltersKml('A & B <x>', POS)
    expect(kml).toContain('A &amp; B &lt;x&gt;')
    expect(kml).not.toContain('<Polygon>')
  })
})

describe('fieldGeoJson', () => {
  it('produces a FeatureCollection with a boundary + shelter points', () => {
    const gj = JSON.parse(fieldGeoJson('F1', POS, GEOM))
    expect(gj.type).toBe('FeatureCollection')
    const kinds = gj.features.map((f: { properties: { kind: string } }) => f.properties.kind)
    expect(kinds.filter((k: string) => k === 'shelter')).toHaveLength(2)
    expect(kinds).toContain('boundary')
    const pt = gj.features.find((f: { properties: { kind: string } }) => f.properties.kind === 'shelter')
    expect(pt.geometry.coordinates).toEqual([-111.6, 49.83]) // [lon,lat]
  })
})

describe('slug', () => {
  it('makes a filesystem-safe lowercase slug', () => {
    expect(slug('BASF 1st Test Plot')).toBe('basf_1st_test_plot')
    expect(slug('')).toBe('field')
  })
})
