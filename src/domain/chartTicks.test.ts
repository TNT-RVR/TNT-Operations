import { describe, it, expect } from 'vitest'
import { niceStep, niceTicks, tickDecimals } from './chartTicks'

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
