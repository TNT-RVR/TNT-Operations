import { describe, it, expect } from 'vitest'
import { fieldSupplies, supplyLines, jobsForCrew } from './supplies'

/** A real-shaped field: 111 acres at 3 gal/acre, 2 gal a tray. */
const FIELD = { acres: '111.42', gals_per_acre: '3', gals_per_tray: '2' }

describe('fieldSupplies', () => {
  it('works the tray count out from acres and gallons', () => {
    const s = fieldSupplies(FIELD, 130)
    expect(s.gallons).toBeCloseTo(334.3, 1)
    // 334.26 / 2 = 167.13 → 168. A part tray still has to be carried.
    expect(s.trays).toBe(168)
  })

  it('rounds trays UP', () => {
    // 10 gal at 3 gal a tray is 3.33 trays; a crew that takes 3 runs out.
    const s = fieldSupplies({ acres: '10', gals_per_acre: '1', gals_per_tray: '3' }, 4)
    expect(s.trays).toBe(4)
  })

  it('counts what is still to place, not the whole plan', () => {
    const s = fieldSupplies(FIELD, 130, 40)
    expect(s.shelters).toBe(130)
    expect(s.sheltersRemaining).toBe(90)
  })

  it('never asks for a negative number of shelters', () => {
    // More placed than the grid calls for happens after a re-plan.
    expect(fieldSupplies(FIELD, 10, 14).sheltersRemaining).toBe(0)
  })

  it('says what it could not work out rather than guessing', () => {
    const s = fieldSupplies({ acres: '50' }, 20)
    expect(s.trays).toBeNull()
    expect(s.unknowns).toContain('gallons per acre')
    expect(s.unknowns).toContain('gallons per tray')
  })

  it('survives a field with nothing on it', () => {
    const s = fieldSupplies(undefined, 0)
    expect(s.shelters).toBe(0)
    expect(s.trays).toBeNull()
  })

  it('handles numbers stored as strings with commas', () => {
    // The old app wrote plenty of these as text.
    const s = fieldSupplies({ acres: '1,000', gals_per_acre: '2', gals_per_tray: '2' }, 100)
    expect(s.gallons).toBe(2000)
  })

  it('does not divide by a zero tray size', () => {
    const s = fieldSupplies({ acres: '10', gals_per_acre: '3', gals_per_tray: '0' }, 5)
    expect(s.trays).toBeNull()
    expect(s.unknowns).toContain('gallons per tray')
  })
})

describe('supplyLines', () => {
  it('lists shelters for shelter work', () => {
    const lines = supplyLines('shelter', fieldSupplies(FIELD, 130, 40))
    expect(lines[0]).toMatchObject({ item: 'Shelters', qty: '90' })
    expect(lines[0].note).toContain('already out')
  })

  it('drops the note when nothing has been placed yet', () => {
    const lines = supplyLines('shelter', fieldSupplies(FIELD, 130, 0))
    expect(lines[0].note).toBeUndefined()
  })

  it('lists trays for tray work, with how it got there', () => {
    const lines = supplyLines('tray', fieldSupplies(FIELD, 130))
    expect(lines[0]).toMatchObject({ item: 'Trays', qty: '168' })
    expect(lines[0].note).toContain('gal a tray')
  })

  it('says what is missing rather than showing a made-up count', () => {
    const lines = supplyLines('tray', fieldSupplies({ acres: '50' }, 20))
    expect(lines[0].qty).toBe('—')
    expect(lines[0].note).toContain('Needs acres')
  })
})

describe('jobsForCrew', () => {
  const ev = (over: Partial<Parameters<typeof jobsForCrew>[0][number]> = {}) => ({
    id: 'e1',
    title: 'Shelters — Bow Island',
    startDate: '2026-08-13',
    endDate: null,
    crewId: 'c1',
    task: 'shelter' as const,
    fieldId: 'f1',
    ...over,
  })

  it('finds the crew’s job for the day', () => {
    expect(jobsForCrew([ev()], 'c1', '2026-08-13')).toHaveLength(1)
  })

  it('ignores another crew’s job', () => {
    expect(jobsForCrew([ev()], 'c2', '2026-08-13')).toHaveLength(0)
  })

  it('covers every day of a multi-day job', () => {
    // A two-day quarter is still that crew's work on the second morning.
    const e = [ev({ endDate: '2026-08-15' })]
    expect(jobsForCrew(e, 'c1', '2026-08-14')).toHaveLength(1)
    expect(jobsForCrew(e, 'c1', '2026-08-15')).toHaveLength(1)
    expect(jobsForCrew(e, 'c1', '2026-08-16')).toHaveLength(0)
  })

  it('ignores ordinary calendar entries', () => {
    // A delivery with no task or field must not reassign anyone's day.
    expect(jobsForCrew([ev({ task: null })], 'c1', '2026-08-13')).toHaveLength(0)
    expect(jobsForCrew([ev({ fieldId: null })], 'c1', '2026-08-13')).toHaveLength(0)
    expect(jobsForCrew([ev({ crewId: null })], 'c1', '2026-08-13')).toHaveLength(0)
  })
})
