import { describe, it, expect } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { firstPolygonRingLngLat, toLatLonRing, ringAcres, geojsonToBoundary } from './importBoundary'

// ~a quarter-section-ish square near Grassy Lake, AB, as [lon,lat] closed ring.
const SQUARE_LNGLAT: [number, number][] = [
  [-111.6, 49.83],
  [-111.594, 49.83],
  [-111.594, 49.836],
  [-111.6, 49.836],
  [-111.6, 49.83],
]

const fc = (geom: object): FeatureCollection =>
  ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geom }] }) as FeatureCollection

describe('firstPolygonRingLngLat', () => {
  it('digs the outer ring out of a FeatureCollection → Feature → Polygon', () => {
    const ring = firstPolygonRingLngLat(fc({ type: 'Polygon', coordinates: [SQUARE_LNGLAT] }))
    expect(ring).toHaveLength(5)
    expect(ring![0]).toEqual([-111.6, 49.83])
  })
  it('handles MultiPolygon', () => {
    const ring = firstPolygonRingLngLat(fc({ type: 'MultiPolygon', coordinates: [[SQUARE_LNGLAT]] }))
    expect(ring).toHaveLength(5)
  })
  it('returns null when there is no polygon', () => {
    expect(firstPolygonRingLngLat(fc({ type: 'LineString', coordinates: SQUARE_LNGLAT }))).toBeNull()
    expect(firstPolygonRingLngLat(null)).toBeNull()
  })
})

describe('toLatLonRing', () => {
  it('flips [lon,lat]→[lat,lon] and drops the closing point', () => {
    const r = toLatLonRing(SQUARE_LNGLAT)
    expect(r).toHaveLength(4) // closing dup removed
    expect(r[0]).toEqual([49.83, -111.6])
  })
})

describe('ringAcres', () => {
  it('measures a ~0.006°×0.006° box in a sane acre range', () => {
    const acres = ringAcres(toLatLonRing(SQUARE_LNGLAT))
    // ~430m E-W × ~667m N-S ≈ 28.6 ha ≈ ~70 acres — assert a generous window.
    expect(acres).toBeGreaterThan(40)
    expect(acres).toBeLessThan(110)
  })
  it('is zero for a degenerate ring', () => {
    expect(ringAcres([[49.83, -111.6]])).toBe(0)
  })
})

describe('geojsonToBoundary', () => {
  it('returns a stored [lat,lon] ring + rounded acres', () => {
    const b = geojsonToBoundary(fc({ type: 'Polygon', coordinates: [SQUARE_LNGLAT] }))
    expect(b).not.toBeNull()
    expect(b!.ring[0]).toEqual([49.83, -111.6])
    expect(b!.ring).toHaveLength(4)
    expect(b!.acres).toBeGreaterThan(0)
    expect(Number.isFinite(b!.acres)).toBe(true)
  })
  it('returns null without a polygon', () => {
    expect(geojsonToBoundary(fc({ type: 'Point', coordinates: [-111.6, 49.83] }))).toBeNull()
  })
})
