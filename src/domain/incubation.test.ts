import { describe, it, expect } from 'vitest'
import { incubationProgress, DEFAULT_INCUBATION_DAYS } from './incubation'

describe('incubationProgress', () => {
  it('reports idle when there is no start date', () => {
    const p = incubationProgress(null, '2026-07-22T00:00:00Z')
    expect(p.stage).toBe('idle')
    expect(p.pct).toBe(0)
    expect(p.daysRemaining).toBe(DEFAULT_INCUBATION_DAYS)
  })

  it('is 0% on the start instant', () => {
    const p = incubationProgress('2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
    expect(p.pct).toBe(0)
    expect(p.stage).toBe('early')
  })

  it('is ~50% halfway through a 21-day cycle', () => {
    const p = incubationProgress('2026-07-01T00:00:00Z', '2026-07-11T12:00:00Z')
    expect(p.pct).toBe(50)
    expect(p.stage).toBe('mid')
  })

  it('flags emergence in the last stretch', () => {
    const p = incubationProgress('2026-07-01T00:00:00Z', '2026-07-19T00:00:00Z') // 18/21 ≈ 86%
    expect(p.stage).toBe('emergence')
  })

  it('caps at 100% / complete when overdue', () => {
    const p = incubationProgress('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')
    expect(p.pct).toBe(100)
    expect(p.daysRemaining).toBe(0)
    expect(p.stage).toBe('complete')
  })
})
