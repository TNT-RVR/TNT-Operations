import { describe, it, expect } from 'vitest'
import { fieldWarnings } from './fieldWarnings'

const GOOD = {
  use_bays: true,
  num_female_rows: '8',
  num_male_rows: '2',
  row_spacing_in: '22',
  bay_gap_in: '0',
  total_rows: '20',
  row_layout: 'centered',
}

describe('fieldWarnings (ported from maketentgrid.field_warnings)', () => {
  it('clean field → no warnings', () => {
    expect(fieldWarnings(GOOD)).toEqual([])
  })
  it('flags a <3-point boundary', () => {
    expect(fieldWarnings({ ...GOOD, boundary_polygon: [[49, -111], [49.1, -111]] })[0]).toMatch(/fewer than 3 points/)
  })
  it('blanket-planted fields skip bay checks', () => {
    expect(fieldWarnings({ use_bays: false, num_male_rows: '0' })).toEqual([])
    expect(fieldWarnings({ use_bays: 'No', num_male_rows: '0' })).toEqual([])
  })
  it('flags non-numeric bay params', () => {
    expect(fieldWarnings({ ...GOOD, row_spacing_in: 'abc' })[0]).toMatch(/aren't numeric/)
  })
  it('flags zero row spacing, no male rows, negative female rows', () => {
    const w = fieldWarnings({ ...GOOD, row_spacing_in: '0', num_male_rows: '0', num_female_rows: '-1' })
    expect(w.join(' ')).toMatch(/Row spacing is 0/)
    expect(w.join(' ')).toMatch(/No male rows/)
    expect(w.join(' ')).toMatch(/negative/)
  })
  it('flags total_rows smaller than one bay unit', () => {
    expect(fieldWarnings({ ...GOOD, total_rows: '6' })[0]).toMatch(/smaller than one bay unit/)
  })
  it('flags a custom mask length mismatch', () => {
    const w = fieldWarnings({ ...GOOD, row_layout: 'custom', custom_row_mask: 'MFFFM' })
    expect(w[0]).toMatch(/Custom mask is 5 rows but Total rows is 20/)
  })
  it('flags a bay gap as wide as the female bay (the Wordmans/Carrots bug class)', () => {
    // nf=3, rs=22 → female bay 66 in; gap 33 each side → 2*33 >= 66
    const w = fieldWarnings({ ...GOOD, num_female_rows: '3', bay_gap_in: '33', total_rows: '20' })
    expect(w[0]).toMatch(/Bay gap .* as wide as the female bay/)
  })
})
