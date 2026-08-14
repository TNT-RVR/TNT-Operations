import { describe, it, expect } from 'vitest'
import { buildWorkOrder, workOrderTitle, clashesFor, type WorkOrderDraft } from './workOrder'

const draft = (over: Partial<WorkOrderDraft> = {}): WorkOrderDraft => ({
  crewId: 'c1',
  task: 'shelter',
  fieldId: 'f1',
  startDate: '2026-08-20',
  ...over,
})

describe('workOrderTitle', () => {
  it('names the job and the field', () => {
    expect(workOrderTitle('shelter', 'Bow Island NW')).toBe('Shelters — Bow Island NW')
    expect(workOrderTitle('tray', 'Bow Island NW')).toBe('Trays — Bow Island NW')
  })

  it('does not produce a dangling dash when the field has no name', () => {
    expect(workOrderTitle('tray', '')).toBe('Trays — field')
  })
})

describe('buildWorkOrder', () => {
  it('builds a saveable event from a complete draft', () => {
    const r = buildWorkOrder(draft(), 'Bow Island NW')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input).toMatchObject({
      title: 'Shelters — Bow Island NW',
      crewId: 'c1',
      task: 'shelter',
      fieldId: 'f1',
      startDate: '2026-08-20',
      endDate: null,
      category: 'work',
    })
  })

  it('keeps a title somebody typed', () => {
    const r = buildWorkOrder(draft({ title: '  Finish the west half  ' }), 'Bow Island NW')
    expect(r.ok && r.input.title).toBe('Finish the west half')
  })

  it('keeps an end date that is genuinely later', () => {
    const r = buildWorkOrder(draft({ endDate: '2026-08-22' }), 'F')
    expect(r.ok && r.input.endDate).toBe('2026-08-22')
  })

  it('stores a same-day end as null rather than repeating the start', () => {
    const r = buildWorkOrder(draft({ endDate: '2026-08-20' }), 'F')
    expect(r.ok && r.input.endDate).toBe(null)
  })

  // The three things that make it a work order rather than a diary entry.
  it.each([
    ['crew', { crewId: '' }, 'Pick a crew.'],
    ['task', { task: '' as const }, 'Pick shelters or trays.'],
    ['field', { fieldId: '' }, 'Pick a field.'],
  ])('refuses a draft with no %s', (_what, over, message) => {
    const r = buildWorkOrder(draft(over), 'F')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain(message)
  })

  it('reports every problem at once', () => {
    const r = buildWorkOrder({ crewId: '', task: '', fieldId: '', startDate: '' }, 'F')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(4)
  })

  it('refuses a missing or malformed date', () => {
    expect(buildWorkOrder(draft({ startDate: '' }), 'F').ok).toBe(false)
    expect(buildWorkOrder(draft({ startDate: '20-08-2026' }), 'F').ok).toBe(false)
  })

  it('refuses an end date before the start', () => {
    const r = buildWorkOrder(draft({ endDate: '2026-08-19' }), 'F')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('The last day is before the first day.')
  })
})

describe('clashesFor', () => {
  const events = [
    { id: 'e1', crewId: 'c1', startDate: '2026-08-20', endDate: null, title: 'Shelters — A' },
    { id: 'e2', crewId: 'c2', startDate: '2026-08-20', endDate: null, title: 'Shelters — B' },
    { id: 'e3', crewId: 'c1', startDate: '2026-08-24', endDate: '2026-08-26', title: 'Trays — C' },
  ]

  it('finds another booking on the same day for the same crew', () => {
    expect(clashesFor(events, 'c1', '2026-08-20', null)).toEqual([{ id: 'e1', title: 'Shelters — A' }])
  })

  it('ignores other crews', () => {
    expect(clashesFor(events, 'c3', '2026-08-20', null)).toEqual([])
  })

  it('sees a day that falls inside a multi-day booking', () => {
    expect(clashesFor(events, 'c1', '2026-08-25', null).map((c) => c.id)).toEqual(['e3'])
  })

  it('sees a new range that overlaps an existing one at the edge', () => {
    expect(clashesFor(events, 'c1', '2026-08-26', '2026-08-28').map((c) => c.id)).toEqual(['e3'])
  })

  it('says nothing about a free day', () => {
    expect(clashesFor(events, 'c1', '2026-08-21', '2026-08-23')).toEqual([])
  })

  it('holds its tongue until there is a crew and a date to check', () => {
    expect(clashesFor(events, '', '2026-08-20', null)).toEqual([])
    expect(clashesFor(events, 'c1', '', null)).toEqual([])
  })
})
