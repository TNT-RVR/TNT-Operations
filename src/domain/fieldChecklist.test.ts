import { describe, expect, it } from 'vitest'
import { CHECKLIST_STEPS, cellKey, cellState, checklistProgress, daysLate, indexCells } from './fieldChecklist'

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
