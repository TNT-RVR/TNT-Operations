import { describe, expect, it } from 'vitest'
import { describeLayout, layoutDict, previewLayout } from './seasonLayout'

/** A 400 m pivot with 8F/2M bays — the shape of the seeded demo field. */
const PIVOT_GEOMETRY = {
  Radius: '400',
  Sprayer_width: '120',
  num_female_rows: '8',
  num_male_rows: '2',
  row_spacing_in: '22',
  total_rows: '10',
  planting_angle: '0',
  shelter_mode: 'total',
  num_structures: '24',
  use_bays: true,
}
const PIVOT_BOUNDARY = { PP_Longitude: '-111.6', PP_Latitude: '49.83', Radius: '400' }

const SQUARE = [
  [49.82, -111.62],
  [49.82, -111.6],
  [49.84, -111.6],
  [49.84, -111.62],
] as Array<[number, number]>

describe('layoutDict', () => {
  // The two are stored apart precisely so the field's outline is authoritative:
  // a season copied from a year when the boundary was smaller must not shrink
  // the field it is being applied to.
  it('lets the field boundary win over the old season', () => {
    const d = layoutDict({ Radius: '500' }, { Radius: '400', row_spacing_in: '22' })
    expect(d.Radius).toBe('500')
    expect(d.row_spacing_in).toBe('22')
  })
})

describe('previewLayout', () => {
  it('places shelters from last season on this field', () => {
    const p = previewLayout(PIVOT_BOUNDARY, PIVOT_GEOMETRY)
    expect(p.problem).toBeNull()
    expect(p.shelters).toBeGreaterThan(0)
    expect(p.pins).toHaveLength(p.shelters)
    expect(p.pins[0]).toHaveProperty('lat')
  })

  it('reports acres per shelter when the boundary is a ring', () => {
    const p = previewLayout({ boundary_polygon: SQUARE }, { ...PIVOT_GEOMETRY, Radius: undefined })
    if (p.shelters > 0) {
      expect(p.acres).toBeGreaterThan(0)
      expect(p.acresPerShelter).toBeCloseTo(p.acres! / p.shelters, 6)
    }
  })

  // Every one of these is a state the Season Setup screen can be in, and each
  // has to say something a person can act on rather than render an empty map.
  it('says when there is no layout to copy', () => {
    expect(previewLayout(PIVOT_BOUNDARY, {}).problem).toMatch(/No layout recorded/i)
  })

  it('says when the field has no boundary', () => {
    expect(previewLayout({}, PIVOT_GEOMETRY).problem).toMatch(/no boundary/i)
  })

  it('says when the settings place nothing, rather than showing a blank map', () => {
    const p = previewLayout(PIVOT_BOUNDARY, { ...PIVOT_GEOMETRY, num_structures: '0', shelter_mode: 'total' })
    expect(p.shelters === 0 ? p.problem : 'ok').toBeTruthy()
  })

  it('never throws, whatever the stored geometry looks like', () => {
    expect(() => previewLayout(PIVOT_BOUNDARY, { total_rows: 'not a number', boundary_polygon: 'nonsense' })).not.toThrow()
    expect(() => previewLayout({ boundary_polygon: [[1, 2]] }, PIVOT_GEOMETRY)).not.toThrow()
  })
})

describe('describeLayout', () => {
  it('describes a layout in the terms someone would ask about', () => {
    expect(describeLayout(PIVOT_GEOMETRY)).toEqual([
      '8F / 2M bays',
      '22" row spacing',
      '0° planting angle',
      'total count',
    ])
  })

  it('falls back to a row count when there are no bays', () => {
    expect(describeLayout({ total_rows: '12', row_spacing_in: '20' })).toEqual(['12 rows', '20" row spacing'])
  })

  it('says nothing about values that are not recorded', () => {
    expect(describeLayout({})).toEqual([])
  })
})

describe('acreage on a pivot', () => {
  // Most TNT fields are pivots, and a pivot carries no ring to measure. Without
  // this the acres-per-shelter figure — the number growers argue about — is "—"
  // on nearly every field.
  it('computes the circle when nothing is recorded', () => {
    const p = previewLayout(PIVOT_BOUNDARY, PIVOT_GEOMETRY)
    const expected = (Math.PI * 400 * 400) / 4046.8564224 // ~124 acres
    expect(p.acres).toBeCloseTo(expected, 1)
    expect(p.acresPerShelter).toBeCloseTo(expected / p.shelters, 6)
  })

  it('prefers a recorded acreage, which accounts for corners and exclusions', () => {
    const p = previewLayout(PIVOT_BOUNDARY, { ...PIVOT_GEOMETRY, acres: '96' })
    expect(p.acres).toBe(96)
  })
})
