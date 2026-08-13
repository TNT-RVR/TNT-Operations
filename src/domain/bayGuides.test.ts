import { describe, it, expect } from 'vitest'
import { bayGuides, distToLineM } from './bayGuides'
import { getTentPositions } from './tentGrid'
import { maleBayBands } from './bayOverlays'

/** The same realistic pivot the bay-overlay tests use: 400 m, 8F/2M centred. */
const pivot = {
  PP_Latitude: '49.83',
  PP_Longitude: '-111.6',
  Radius: '400',
  Sprayer_width: '133',
  use_bays: true,
  num_female_rows: '8',
  num_male_rows: '2',
  total_rows: '20',
  row_layout: 'centered',
  row_spacing_in: '22',
  Planting_angle: '0',
}

describe('distToLineM', () => {
  // A due-north line at -111.6; a point 2 m east of it.
  const a: [number, number] = [-111.6, 49.82]
  const b: [number, number] = [-111.6, 49.84]
  const east2m = { lat: 49.83, lng: -111.6 + 2 / (111_320 * Math.cos((49.83 * Math.PI) / 180)) }

  it('measures perpendicular metres', () => {
    expect(distToLineM(east2m, a, b)).toBeCloseTo(2, 1)
  })

  it('measures to the LINE, not the segment', () => {
    // A shelter beyond the end of a bay still belongs to that bay: the bay
    // runs the length of the field.
    expect(distToLineM({ lat: 49.90, lng: east2m.lng }, a, b)).toBeCloseTo(2, 1)
  })

  it('is zero on the line', () => {
    expect(distToLineM({ lat: 49.83, lng: -111.6 }, a, b)).toBeCloseTo(0, 3)
  })
})

describe('bayGuides', () => {
  const shelters = getTentPositions(pivot)

  it('produces a guide only for the bays being worked', () => {
    const guides = bayGuides(pivot, shelters)
    const bandCount = maleBayBands(pivot).features.length
    expect(guides.length).toBeGreaterThan(0)
    // The whole point: far fewer lines than bays. Drawing every bay is the
    // noise this replaces — most of them have no shelters beside them.
    expect(guides.length).toBeLessThan(bandCount)
  })

  it('gives no guides when no shelters have been placed', () => {
    expect(bayGuides(pivot, [])).toEqual([])
  })

  it('assigns shelters to the NEAREST bay, not the one they sit inside', () => {
    // Shelters sit ~2 m off the male rows, and a male bay is ~1.1 m wide, so
    // containment finds nothing at all. This is the bug that made the first
    // version draw no lines.
    const guides = bayGuides(pivot, shelters)
    expect(guides.length).toBeGreaterThan(0)
  })

  it('extends past the ends of the bay', () => {
    // Compared against the band's own centreline: the guide must be LONGER,
    // because the line has to be visible from outside the field.
    const [guide] = bayGuides(pivot, shelters, 40)
    const band = maleBayBands(pivot).features.find(
      (b) => (b.properties as { pass?: number })?.pass === guide.pass,
    )!
    const ring = band.geometry.coordinates[0] as Array<[number, number]>
    const bandLen = Math.hypot(
      ((ring[2][0] + ring[3][0]) / 2 - (ring[0][0] + ring[1][0]) / 2) * 71_700,
      ((ring[2][1] + ring[3][1]) / 2 - (ring[0][1] + ring[1][1]) / 2) * 111_320,
    )
    const guideLen = Math.hypot(
      (guide.coordinates[1][0] - guide.coordinates[0][0]) * 71_700,
      (guide.coordinates[1][1] - guide.coordinates[0][1]) * 111_320,
    )
    expect(guideLen).toBeGreaterThan(bandLen + 60)
  })

  it('puts the label between the ends', () => {
    const [guide] = bayGuides(pivot, shelters)
    const [x0, y0] = guide.coordinates[0]
    const [x1, y1] = guide.coordinates[1]
    expect(guide.label[0]).toBeGreaterThan(Math.min(x0, x1))
    expect(guide.label[0]).toBeLessThan(Math.max(x0, x1))
    expect(guide.label[1]).toBeGreaterThan(Math.min(y0, y1))
    expect(guide.label[1]).toBeLessThan(Math.max(y0, y1))
  })

  it('carries the office pass number, so the cab and the map agree', () => {
    const guides = bayGuides(pivot, shelters)
    const passes = new Set(
      maleBayBands(pivot).features.map((b) => (b.properties as { pass?: number })?.pass),
    )
    for (const g of guides) expect(passes.has(g.pass)).toBe(true)
  })

  it('produces finite coordinates', () => {
    for (const g of bayGuides(pivot, shelters)) {
      for (const [lng, lat] of g.coordinates) {
        expect(Number.isFinite(lng)).toBe(true)
        expect(Number.isFinite(lat)).toBe(true)
      }
    }
  })

  it('returns nothing rather than throwing on a field it cannot frame', () => {
    expect(bayGuides({}, shelters)).toEqual([])
  })
})
