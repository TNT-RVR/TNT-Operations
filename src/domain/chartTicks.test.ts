import { describe, it, expect } from 'vitest'
import { niceStep, niceTicks, tickDecimals, timeTicks } from './chartTicks'

describe('niceStep', () => {
  it.each([
    [10, 3, 5],
    [1, 3, 0.5],
    [0.4, 3, 0.2],
    [100, 4, 25],
  ])('picks a rounded step for a span of %s over %s ticks', (span, count, expected) => {
    expect(niceStep(span, count)).toBeCloseTo(expected, 10)
  })

  it('never returns zero or a negative for nonsense input', () => {
    // A zero step would hang the tick loop; a flat line must still draw.
    expect(niceStep(0, 3)).toBe(1)
    expect(niceStep(-5, 3)).toBe(1)
    expect(niceStep(NaN, 3)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('lands on numbers a person would choose', () => {
    // The whole point: 15 / 17.5 / 20, not 14.87 / 17.43 / 19.99.
    expect(niceTicks(14.2, 20.4, 3)).toEqual([15, 17.5, 20])
  })

  it('keeps every tick inside the range', () => {
    const ticks = niceTicks(2.3, 9.1, 3)
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(2.3)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(9.1)
  })

  it('handles a flat line without spinning', () => {
    // An incubator holding steady gives lo === hi. One tick is the honest
    // answer, and an unguarded loop here would never end.
    expect(niceTicks(30, 30)).toEqual([30])
  })

  it('survives an inverted range', () => {
    expect(niceTicks(20, 10)).toEqual([20])
  })

  it('does not carry floating-point dust into the labels', () => {
    // 17.499999999999996 renders as "17.5" only by luck of rounding.
    for (const t of niceTicks(14.2, 20.4, 3)) {
      expect(Number.isInteger(t * 10)).toBe(true)
    }
  })

  it('returns nothing for values that are not numbers', () => {
    expect(niceTicks(NaN, 10)).toEqual([])
  })
})

describe('tickDecimals', () => {
  it('asks for a decimal only when the step needs one', () => {
    expect(tickDecimals(5)).toBe(0)
    expect(tickDecimals(2.5)).toBe(1)
    expect(tickDecimals(0.25)).toBe(2)
  })
})

describe('timeTicks', () => {
  // Edmonton in summer: six hours behind UTC.
  const MDT = () => -6 * 3600_000
  const utc = (s: string) => Date.parse(s)
  const localHour = (t: number) => new Date(t - 6 * 3600_000).getUTCHours()

  it('labels a week once a day, at local midnight', () => {
    // The screenshot's range: Sep 8 19:00 to Sep 15 18:45, Edmonton time.
    const ticks = timeTicks(utc('2026-09-09T01:00:00Z'), utc('2026-09-16T00:45:00Z'), 8, MDT)
    expect(ticks).toHaveLength(7)
    expect(ticks.every((t) => t.isDay)).toBe(true)
    expect(ticks.every((t) => localHour(t.t) === 0)).toBe(true)
  })

  it('labels a day in round hours', () => {
    const ticks = timeTicks(utc('2026-09-15T14:10:00Z'), utc('2026-09-16T14:10:00Z'), 6, MDT)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(6)
    for (const t of ticks) {
      expect(new Date(t.t).getUTCMinutes()).toBe(0)
      expect(localHour(t.t) % 6).toBe(0)
    }
  })

  it('marks the midnight inside a day-long range as a date', () => {
    const ticks = timeTicks(utc('2026-09-15T14:10:00Z'), utc('2026-09-16T14:10:00Z'), 6, MDT)
    expect(ticks.filter((t) => t.isDay)).toHaveLength(1)
  })

  it('never puts more ticks on the axis than asked for', () => {
    const ticks = timeTicks(utc('2026-08-17T00:00:00Z'), utc('2026-09-16T00:00:00Z'), 6, MDT)
    expect(ticks.length).toBeLessThanOrEqual(6)
    expect(ticks.length).toBeGreaterThan(0)
  })

  it('keeps every tick inside the range', () => {
    const a = utc('2026-09-15T14:10:00Z')
    const b = utc('2026-09-15T20:10:00Z')
    for (const t of timeTicks(a, b, 6, MDT)) {
      expect(t.t).toBeGreaterThanOrEqual(a)
      expect(t.t).toBeLessThanOrEqual(b)
    }
  })

  it('returns nothing for an empty or backwards range', () => {
    expect(timeTicks(10, 10, 5, MDT)).toEqual([])
    expect(timeTicks(20, 10, 5, MDT)).toEqual([])
  })
})
