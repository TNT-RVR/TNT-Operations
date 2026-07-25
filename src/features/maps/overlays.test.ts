import { describe, it, expect } from 'vitest'
import { trackRings, ringPolygons, cornerArms, overlayPins, hasOverlays } from './overlays'

const PIVOT = { PP_Latitude: '49.86', PP_Longitude: '-111.52' }

describe('trackRings', () => {
  it('emits a ring pair (r±exclusion) per track radius', () => {
    const fc = trackRings({ ...PIVOT, pivot_tracks: [60, 120], track_exclusion_ft: '10' })
    expect(fc.features).toHaveLength(4) // 2 tracks × (inner + outer)
    expect(fc.features[0].geometry.type).toBe('Polygon')
  })
  it('drops an inner ring that would collapse past the centre', () => {
    // r=2 m with ~3 m exclusion → inner radius negative, only the outer ring survives
    const fc = trackRings({ ...PIVOT, pivot_tracks: [2], track_exclusion_ft: '10' })
    expect(fc.features).toHaveLength(1)
  })
  it('is empty without a pivot centre or tracks', () => {
    expect(trackRings({ pivot_tracks: [60] }).features).toHaveLength(0)
    expect(trackRings({ ...PIVOT, pivot_tracks: [] }).features).toHaveLength(0)
  })
})

describe('ringPolygons', () => {
  const ring = [
    [49.86, -111.52],
    [49.861, -111.52],
    [49.861, -111.519],
  ]
  it('accepts a single ring and closes it', () => {
    const fc = ringPolygons(ring)
    expect(fc.features).toHaveLength(1)
    const coords = fc.features[0].geometry.coordinates[0]
    expect(coords).toHaveLength(4) // 3 pts + closing point
    expect(coords[0]).toEqual(coords[coords.length - 1])
    expect(coords[0]).toEqual([-111.52, 49.86]) // flipped to [lon,lat]
  })
  it('accepts a list of rings', () => {
    expect(ringPolygons([ring, ring]).features).toHaveLength(2)
  })
  it('ignores empty / undersized input', () => {
    expect(ringPolygons(undefined).features).toHaveLength(0)
    expect(ringPolygons([[[49.86, -111.52]]]).features).toHaveLength(0)
  })
})

describe('cornerArms', () => {
  it('splits path arms into lines and circle arms into rings', () => {
    const { lines, circles } = cornerArms({
      corner_arms: [
        { type: 'path', pts: [[49.86, -111.52], [49.861, -111.521]] },
        { type: 'circle', lat: 49.86, lon: -111.52, radius_m: 25 },
      ],
    })
    expect(lines.features).toHaveLength(1)
    expect(lines.features[0].geometry.type).toBe('LineString')
    expect(circles.features).toHaveLength(1)
  })
})

describe('overlayPins & hasOverlays', () => {
  it('reads entrance/parking/home points as [lat,lon]', () => {
    const pins = overlayPins({ parking_pin: [49.86, -111.52], home_pin: [49.87, -111.53] })
    expect(pins.map((p) => p.kind)).toEqual(['parking', 'home'])
    expect(pins[0]).toMatchObject({ lng: -111.52, lat: 49.86 })
  })
  it('detects presence of any overlay data', () => {
    expect(hasOverlays({ pivot_tracks: [60] })).toBe(true)
    expect(hasOverlays({ parking_pin: [49.86, -111.52] })).toBe(true)
    expect(hasOverlays({ pivot_tracks: [], corner_arms: [] })).toBe(false)
    expect(hasOverlays(undefined)).toBe(false)
  })
})
