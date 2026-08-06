/**
 * Tests for task scheduling.
 *
 * The interesting cases are all calendar edge cases: month-end clamping, leap
 * years, DST, and the difference between the two recurrence anchors. Those are
 * where a scheduler quietly goes wrong and nobody notices for a season.
 */
import { describe, it, expect } from 'vitest'
import {
  type RecurRule,
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  daysOverdue,
  describeRecurrence,
  dueStatus,
  nextDueDate,
  occurrencesThrough,
  stepProgress,
  todayInTz,
  weekdayOf,
} from './tasks'

const rule = (r: Partial<RecurRule> & Pick<RecurRule, 'unit'>): RecurRule => ({
  interval: 1,
  anchor: 'schedule',
  ...r,
})

// ═══════════════════════════════════════════════════════════════════════════
// Calendar helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('todayInTz', () => {
  it('gives the Edmonton date, not the UTC date', () => {
    // 06:00 UTC on Aug 6 is 00:00 on Aug 6 in Edmonton (UTC−6 in summer) —
    // same day. One hour earlier it is still Aug 5 there.
    expect(todayInTz(new Date('2026-08-06T06:00:00Z'))).toBe('2026-08-06')
    expect(todayInTz(new Date('2026-08-06T05:00:00Z'))).toBe('2026-08-05')
  })

  it('handles the winter offset too (UTC−7)', () => {
    expect(todayInTz(new Date('2026-01-06T07:00:00Z'))).toBe('2026-01-06')
    expect(todayInTz(new Date('2026-01-06T06:00:00Z'))).toBe('2026-01-05')
  })
})

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29], // leap
    [2000, 2, 29], // divisible by 400
    [1900, 2, 28], // divisible by 100 but not 400
    [2026, 4, 30],
  ])('%i-%i has %i days', (y, m, expected) => {
    expect(daysInMonth(y, m)).toBe(expected)
  })
})

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween('2026-08-06', '2026-08-10')).toBe(4)
    expect(daysBetween('2026-08-10', '2026-08-06')).toBe(-4)
    expect(daysBetween('2026-08-06', '2026-08-06')).toBe(0)
  })

  it('crosses a DST boundary without losing a day', () => {
    // Alberta springs forward on 2026-03-08. Naive local-time arithmetic here
    // gives 0.958 days and rounds wrong.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('crosses a year end', () => {
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3)
  })

  it('returns null on a malformed date', () => {
    expect(daysBetween('not-a-date', '2026-08-06')).toBeNull()
    expect(daysBetween('2026-13-01', '2026-08-06')).toBeNull()
  })
})

describe('addMonths', () => {
  it('CLAMPS to the end of a shorter month', () => {
    // The bug this exists to prevent: JS Date rolls Jan 31 + 1 month to Mar 3,
    // and a monthly task then drifts later every short month.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29') // leap year
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })

  it('does not clamp when the day fits', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
  })

  it('rolls over a year boundary', () => {
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
  })

  it('does not compound the clamp when stepping repeatedly', () => {
    // Stepping Jan 31 forward one month at a time lands on each month's last
    // day only if the caller re-anchors; from a clamped Feb 28 the next step is
    // Mar 28. That is the documented behaviour — assert it so it stays known.
    const feb = addMonths('2026-01-31', 1)!
    expect(feb).toBe('2026-02-28')
    expect(addMonths(feb, 1)).toBe('2026-03-28')
  })
})

describe('weekdayOf', () => {
  it('reads the right weekday', () => {
    expect(weekdayOf('2026-08-06')).toBe(4) // a Thursday
    expect(weekdayOf('2026-08-09')).toBe(0) // Sunday
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Recurrence
// ═══════════════════════════════════════════════════════════════════════════

describe('nextDueDate', () => {
  it('steps daily', () => {
    expect(nextDueDate(rule({ unit: 'daily' }), '2026-08-06')).toBe('2026-08-07')
    expect(nextDueDate(rule({ unit: 'daily', interval: 10 }), '2026-08-06')).toBe('2026-08-16')
  })

  it('steps weekly on the same weekday when no days are given', () => {
    expect(nextDueDate(rule({ unit: 'weekly' }), '2026-08-06')).toBe('2026-08-13')
    expect(nextDueDate(rule({ unit: 'weekly', interval: 2 }), '2026-08-06')).toBe('2026-08-20')
  })

  it('walks through selected weekdays rather than jumping a week each time', () => {
    // Mon/Wed/Fri. From Monday Aug 3 2026 → Wed 5 → Fri 7 → Mon 10.
    const r = rule({ unit: 'weekly', weekdays: [1, 3, 5] })
    expect(nextDueDate(r, '2026-08-03')).toBe('2026-08-05')
    expect(nextDueDate(r, '2026-08-05')).toBe('2026-08-07')
    expect(nextDueDate(r, '2026-08-07')).toBe('2026-08-10')
  })

  it('applies the interval only when wrapping to a new week', () => {
    // Fortnightly Mon/Wed: Mon → Wed same week, Wed → Mon two weeks later.
    const r = rule({ unit: 'weekly', interval: 2, weekdays: [1, 3] })
    expect(nextDueDate(r, '2026-08-03')).toBe('2026-08-05')
    expect(nextDueDate(r, '2026-08-05')).toBe('2026-08-17')
  })

  it('steps monthly and yearly with clamping', () => {
    expect(nextDueDate(rule({ unit: 'monthly' }), '2026-01-31')).toBe('2026-02-28')
    expect(nextDueDate(rule({ unit: 'yearly' }), '2024-02-29')).toBe('2025-02-28')
  })

  it('stops at the until date', () => {
    const r = rule({ unit: 'daily', until: '2026-08-07' })
    expect(nextDueDate(r, '2026-08-06')).toBe('2026-08-07')
    expect(nextDueDate(r, '2026-08-07')).toBeNull()
  })

  it('treats a zero or negative interval as 1 rather than looping forever', () => {
    expect(nextDueDate(rule({ unit: 'daily', interval: 0 }), '2026-08-06')).toBe('2026-08-07')
    expect(nextDueDate(rule({ unit: 'daily', interval: -5 }), '2026-08-06')).toBe('2026-08-07')
  })

  it('returns null on a malformed anchor date', () => {
    expect(nextDueDate(rule({ unit: 'daily' }), 'whenever')).toBeNull()
  })
})

describe('the two anchors', () => {
  // The same rule, the same task, finished a week late — the anchor is the
  // only thing that decides when it comes back.
  const weekly = rule({ unit: 'weekly' })
  const dueDate = '2026-08-03'
  const completedOn = '2026-08-10'

  it('schedule-anchored counts from the DUE date, so the cadence holds', () => {
    expect(nextDueDate({ ...weekly, anchor: 'schedule' }, dueDate)).toBe('2026-08-10')
  })

  it('completion-anchored counts from when it was FINISHED, so it slips', () => {
    expect(nextDueDate({ ...weekly, anchor: 'completion' }, completedOn)).toBe('2026-08-17')
  })
})

describe('occurrencesThrough', () => {
  it('materializes every missed occurrence up to a date', () => {
    const got = occurrencesThrough(rule({ unit: 'daily' }), '2026-08-01', '2026-08-05')
    expect(got).toEqual(['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'])
  })

  it('is empty when nothing is due yet', () => {
    expect(occurrencesThrough(rule({ unit: 'weekly' }), '2026-08-01', '2026-08-05')).toEqual([])
  })

  it('caps output so a long-neglected daily task cannot flood the table', () => {
    const got = occurrencesThrough(rule({ unit: 'daily' }), '2020-01-01', '2026-08-05', 60)
    expect(got).toHaveLength(60)
  })

  it('respects the until date', () => {
    const got = occurrencesThrough(rule({ unit: 'daily', until: '2026-08-03' }), '2026-08-01', '2026-08-10')
    expect(got).toEqual(['2026-08-02', '2026-08-03'])
  })
})

describe('describeRecurrence', () => {
  it.each([
    [rule({ unit: 'daily' }), 'Every day'],
    [rule({ unit: 'daily', interval: 3 }), 'Every 3 days'],
    [rule({ unit: 'monthly' }), 'Every month'],
    [rule({ unit: 'weekly', weekdays: [1, 3, 5] }), 'Every Monday, Wednesday, Friday'],
    [rule({ unit: 'weekly', interval: 2, weekdays: [1] }), 'Every 2 weeks on Monday'],
  ])('reads naturally', (r, expected) => {
    expect(describeRecurrence(r)).toBe(expected)
  })

  it('says when it counts from completion', () => {
    expect(describeRecurrence(rule({ unit: 'monthly', interval: 3, anchor: 'completion' }))).toBe(
      'Every 3 months, after completion',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Status
// ═══════════════════════════════════════════════════════════════════════════

describe('dueStatus', () => {
  const TODAY = '2026-08-06'

  it.each([
    ['2026-08-01', 'overdue'],
    ['2026-08-06', 'due-today'],
    ['2026-08-07', 'due-soon'],
    ['2026-08-20', 'upcoming'],
  ])('due %s is %s', (dueDate, expected) => {
    expect(dueStatus({ dueDate, completedAt: null }, TODAY)).toBe(expected)
  })

  it('is done once completed, even if it was finished late', () => {
    // A list that keeps shouting about finished work trains people to ignore it.
    expect(dueStatus({ dueDate: '2026-01-01', completedAt: '2026-08-05T12:00:00Z' }, TODAY)).toBe('done')
  })

  it('is no-date without a due date', () => {
    expect(dueStatus({ dueDate: null, completedAt: null }, TODAY)).toBe('no-date')
  })

  it('honours a custom reminder lead time', () => {
    const t = { dueDate: '2026-08-11', completedAt: null }
    expect(dueStatus(t, TODAY)).toBe('upcoming') // default 1 day
    expect(dueStatus({ ...t, remindDaysBefore: 7 }, TODAY)).toBe('due-soon')
  })
})

describe('daysOverdue', () => {
  it('counts only when actually overdue', () => {
    expect(daysOverdue({ dueDate: '2026-08-01', completedAt: null }, '2026-08-06')).toBe(5)
    expect(daysOverdue({ dueDate: '2026-08-10', completedAt: null }, '2026-08-06')).toBe(0)
    expect(daysOverdue({ dueDate: '2026-08-01', completedAt: '2026-08-02T00:00:00Z' }, '2026-08-06')).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Progress
// ═══════════════════════════════════════════════════════════════════════════

describe('stepProgress', () => {
  it('counts completed steps', () => {
    const p = stepProgress([
      { completedAt: '2026-08-01T00:00:00Z' },
      { completedAt: null },
      { completedAt: '2026-08-02T00:00:00Z' },
    ])
    expect(p).toEqual({ total: 3, done: 2, fraction: 2 / 3, complete: false })
  })

  it('is complete when every step is ticked', () => {
    expect(stepProgress([{ completedAt: 'x' }, { completedAt: 'y' }]).complete).toBe(true)
  })

  it('reports null — not 100% — for a checklist with no steps', () => {
    // Showing a full bar for an empty template is actively misleading.
    const p = stepProgress([])
    expect(p.fraction).toBeNull()
    expect(p.complete).toBe(false)
  })
})
