import { describe, expect, it } from 'vitest'
import {
  CHECKLIST_STEPS,
  cellKey,
  cellState,
  checklistCalendarEntries,
  checklistProgress,
  daysLate,
  indexCells,
} from './fieldChecklist'

const cell = (over: Partial<Parameters<typeof cellState>[0]> & Record<string, unknown> = {}) => ({
  year: '2026',
  fieldName: 'BASF Stolk',
  step: 'flag',
  plannedDate: null,
  completedDate: null,
  note: '',
  ...over,
})

describe('cellState', () => {
  it('reads empty, planned and done apart', () => {
    expect(cellState(null)).toBe('empty')
    expect(cellState(cell())).toBe('empty')
    expect(cellState(cell({ plannedDate: '2026-06-08' }))).toBe('planned')
    expect(cellState(cell({ completedDate: '2026-06-11' }))).toBe('done')
  })

  // The whole reason for two columns: the spreadsheet loses the plan the moment
  // the work happens, because both live in one cell.
  it('stays done when a plan is also recorded', () => {
    expect(cellState(cell({ plannedDate: '2026-06-08', completedDate: '2026-06-11' }))).toBe('done')
  })
})

describe('daysLate', () => {
  it('counts days between the plan and the doing', () => {
    expect(daysLate(cell({ plannedDate: '2026-06-08', completedDate: '2026-06-11' }))).toBe(3)
    expect(daysLate(cell({ plannedDate: '2026-06-08', completedDate: '2026-06-08' }))).toBe(0)
    expect(daysLate(cell({ plannedDate: '2026-06-08', completedDate: '2026-06-05' }))).toBe(-3)
  })

  it('crosses a month boundary without drifting', () => {
    expect(daysLate(cell({ plannedDate: '2026-06-28', completedDate: '2026-07-02' }))).toBe(4)
  })

  // Unplanned work is not late. Reporting 0 would read as "bang on schedule".
  it('says nothing when either date is missing', () => {
    expect(daysLate(cell({ completedDate: '2026-06-11' }))).toBeNull()
    expect(daysLate(cell({ plannedDate: '2026-06-08' }))).toBeNull()
    expect(daysLate(null)).toBeNull()
  })
})

describe('checklistProgress', () => {
  const fields = ['BASF Stolk', 'Corteva Stolk']

  it('counts against every field × step, not just the marked ones', () => {
    const p = checklistProgress(
      [
        cell({ fieldName: 'BASF Stolk', step: 'flag', completedDate: '2026-06-11' }),
        cell({ fieldName: 'BASF Stolk', step: 'bees_in', plannedDate: '2026-07-02' }),
      ],
      fields,
    )
    expect(p.total).toBe(fields.length * CHECKLIST_STEPS.length)
    expect(p).toMatchObject({ done: 1, planned: 1 })
    expect(p.pct).toBe(Math.round((1 / p.total) * 100))
  })

  it('ignores marks for fields not in this season', () => {
    const p = checklistProgress([cell({ fieldName: 'Old 2024 Field', completedDate: '2024-06-01' })], fields)
    expect(p.done).toBe(0)
  })

  it('has nothing to divide by with no fields', () => {
    expect(checklistProgress([], [])).toMatchObject({ total: 0, pct: 0 })
  })
})

describe('indexCells', () => {
  it('keys by field and step so the grid can look one up', () => {
    const m = indexCells([cell({ step: 'flag' }), cell({ step: 'bees_in', fieldName: 'Corteva Stolk' })])
    expect(m.get(cellKey('BASF Stolk', 'flag'))?.step).toBe('flag')
    expect(m.get(cellKey('Corteva Stolk', 'bees_in'))?.fieldName).toBe('Corteva Stolk')
    expect(m.get(cellKey('BASF Stolk', 'bees_in'))).toBeUndefined()
  })
})

describe('checklistCalendarEntries', () => {
  const c = (over: Record<string, unknown>) => ({
    year: '2026',
    fieldName: 'BASF Stolk',
    step: 'bees_in',
    plannedDate: null,
    completedDate: null,
    note: '',
    ...over,
  })

  it('places a planned step on its planned day', () => {
    const [e] = checklistCalendarEntries([c({ plannedDate: '2026-07-02' })])
    expect(e).toMatchObject({ date: '2026-07-02', kind: 'planned', stepLabel: 'Bees In' })
  })

  it('places a completed step on the day it was done', () => {
    const [e] = checklistCalendarEntries([c({ completedDate: '2026-07-05' })])
    expect(e).toMatchObject({ date: '2026-07-05', kind: 'done' })
  })

  // A diary of work, not of intentions: once it is done, the plan is history
  // and the checklist is where the gap between them is read.
  it('shows only the completed day when a cell has both', () => {
    const out = checklistCalendarEntries([c({ plannedDate: '2026-07-02', completedDate: '2026-07-05' })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ date: '2026-07-05', kind: 'done' })
  })

  it('ignores a mark with no date at all (a note-only cell)', () => {
    expect(checklistCalendarEntries([c({ note: 'Most in June 29th' })])).toEqual([])
  })

  it('sorts by day, then field, then step', () => {
    const out = checklistCalendarEntries([
      c({ fieldName: 'Zed', plannedDate: '2026-07-02' }),
      c({ fieldName: 'Alpha', plannedDate: '2026-07-02' }),
      c({ fieldName: 'Mid', plannedDate: '2026-06-30' }),
    ])
    expect(out.map((e) => e.fieldName)).toEqual(['Mid', 'Alpha', 'Zed'])
  })
})
