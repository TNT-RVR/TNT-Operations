import { describe, expect, it } from 'vitest'
import { COMPOSITION_MEMBERS, isDefinitional, metricRelation } from './analysisRelations'
import { METRIC_BY_KEY } from './analysisMetrics'

describe('metricRelation', () => {
  it('is order-independent', () => {
    expect(metricRelation('percent_female', 'percent_male')).toEqual(
      metricRelation('percent_male', 'percent_female'),
    )
    expect(metricRelation('acres', 'num_structures')).toEqual(
      metricRelation('num_structures', 'acres'),
    )
  })

  it('catches the complementary pair that forces r = -1', () => {
    const rel = metricRelation('percent_female', 'percent_male')
    expect(rel?.kind).toBe('complementary')
  })

  it('catches every pair inside the x-ray composition', () => {
    // Verified against the export: these 11 sum to ~100 on 152 of 157 rows,
    // so any pair of them is constrained rather than informative.
    for (const a of COMPOSITION_MEMBERS) {
      for (const b of COMPOSITION_MEMBERS) {
        if (a === b) continue
        expect(metricRelation(a, b)?.kind).toBe('compositional')
      }
    }
  })

  it('flags the strongest real-data pairs that are pure arithmetic', () => {
    // The actual top of the |r| ranking over the 157 exported rows.
    expect(isDefinitional('percent_female', 'percent_male')).toBe(true) // r = -1.000
    expect(isDefinitional('gallons_returned', 'pounds')).toBe(true) // r = +0.974
    expect(isDefinitional('live_prepupae', 'pollen_balls')).toBe(true) // r = -0.948
    expect(isDefinitional('male_rows', 'female_rows')).toBe(true) // r = +0.940
    expect(isDefinitional('male_row_spacing', 'female_row_spacing')).toBe(true) // r = +0.927
    expect(isDefinitional('acres', 'num_structures')).toBe(true) // r = +0.825
    expect(isDefinitional('percent_return', 'gallons_returned')).toBe(true) // r = +0.729
  })

  it('leaves genuine empirical questions unflagged', () => {
    // These are the ones worth actually looking at.
    expect(metricRelation('parasites', 'yield_per_acre')).toBeNull()
    expect(metricRelation('shelters_per_acre', 'live_prepupae')).toBeNull()
    expect(metricRelation('seeding_angle', 'percent_return')).toBeNull()
    expect(metricRelation('avgTemp', 'live_prepupae')).toBeNull()
    expect(metricRelation('flightHours', 'percent_return')).toBeNull()
    expect(metricRelation('blocks_per_shelter', 'parasites')).toBeNull()
  })

  it('treats a metric against itself as related', () => {
    expect(isDefinitional('acres', 'acres')).toBe(true)
  })

  it('only names metrics that exist in the registry', () => {
    // Guards against a rename in analysisMetrics silently disabling a relation.
    for (const key of COMPOSITION_MEMBERS) {
      expect(METRIC_BY_KEY[key], `${key} missing from METRICS`).toBeDefined()
    }
  })
})
