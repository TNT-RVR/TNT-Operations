import { describe, it, expect } from 'vitest'
import { fieldSupplies, supplyLines, jobsForCrew, jobsInWindow } from './supplies'

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

describe('jobsInWindow', () => {
  const ev = (over: Partial<Parameters<typeof jobsForCrew>[0][number]> = {}) => ({
    id: 'e1',
    title: 'Shelters \u2014 Bow Island',
    startDate: '2026-08-20',
    endDate: null,
    crewId: 'c1',
    task: 'shelter' as const,
    fieldId: 'f1',
    ...over,
  })

  const WIN = ['2026-08-14', '2026-09-03'] as const

  it('lists a multi-day job ONCE, not once per day', () => {
    // The whole point: a three-day booking is one work order.
    const out = jobsInWindow([ev({ endDate: '2026-08-22' })], ['c1'], ...WIN)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ startDate: '2026-08-20', lastDate: '2026-08-22' })
  })

  it('files a job under the day it starts', () => {
    expect(jobsInWindow([ev()], ['c1'], ...WIN)[0].showOn).toBe('2026-08-20')
  })

  it('files a job already under way under the first day of the window', () => {
    // Started last week, still running: it belongs at the top, not in the past.
    const out = jobsInWindow([ev({ startDate: '2026-08-10', endDate: '2026-08-16' })], ['c1'], ...WIN)
    expect(out[0].showOn).toBe('2026-08-14')
    expect(out[0].startDate).toBe('2026-08-10')
  })

  it('takes every crew asked for and no others', () => {
    const events = [ev(), ev({ id: 'e2', crewId: 'c2' }), ev({ id: 'e3', crewId: 'c3' })]
    expect(jobsInWindow(events, ['c1', 'c2'], ...WIN).map((j) => j.crewId)).toEqual(['c1', 'c2'])
  })

  it('drops jobs wholly outside the window on either side', () => {
    const before = ev({ startDate: '2026-07-01', endDate: '2026-07-04' })
    const after = ev({ id: 'e2', startDate: '2026-10-01' })
    expect(jobsInWindow([before, after], ['c1'], ...WIN)).toHaveLength(0)
  })

  it('keeps a job that straddles the whole window', () => {
    const long = ev({ startDate: '2026-07-01', endDate: '2026-10-01' })
    expect(jobsInWindow([long], ['c1'], ...WIN)).toHaveLength(1)
  })

  it('still ignores ordinary calendar entries', () => {
    const delivery = { id: 'd', title: 'Delivery', startDate: '2026-08-20', endDate: null, crewId: 'c1' }
    expect(jobsInWindow([delivery], ['c1'], ...WIN)).toHaveLength(0)
  })

  it('orders by the day it shows on', () => {
    const later = ev({ id: 'e2', startDate: '2026-08-25' })
    const sooner = ev({ id: 'e3', startDate: '2026-08-15' })
    expect(jobsInWindow([later, sooner], ['c1'], ...WIN).map((j) => j.eventId)).toEqual(['e3', 'e2'])
  })
})
