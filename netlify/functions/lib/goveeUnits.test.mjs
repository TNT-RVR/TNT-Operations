import { describe, it, expect } from 'vitest'
import { goveeRaw, fToC, v2TempC } from './goveeUnits.mjs'

describe('v2TempC', () => {
  it('converts a reading below 10 °C — the case the old guess got wrong', () => {
    // 49.46 °F is 9.7 °C. The "above 50 means Fahrenheit" rule stored it as
    // 49.46 °C: an incubator in cool storage apparently at blood heat.
    expect(v2TempC(49.46)).toBeCloseTo(9.7, 1)
  })

  it('converts right at the boundary', () => {
    // 50 °F is exactly 10 °C, and the old rule left exactly 50 unconverted —
    // which is why the bad readings topped out at precisely 50.00.
    expect(v2TempC(50)).toBe(10)
  })

  it('still converts warm readings, which the old rule happened to get right', () => {
    expect(v2TempC(86)).toBe(30)
    expect(v2TempC(55.76)).toBeCloseTo(13.2, 1)
  })

  it('handles cool storage temperatures', () => {
    // 39.2 °F is the 4 °C cool-storage target — a value the old rule would
    // have stored as 39.2 °C.
    expect(v2TempC(39.2)).toBe(4)
    expect(v2TempC(32)).toBe(0)
  })

  it('does not mistake a hot plain reading for hundredths', () => {
    // 101 °F is 38.3 °C. With the old line at 100 it became 1.01 °F.
    expect(v2TempC(101)).toBeCloseTo(38.3, 1)
  })

  it('reads values sent in hundredths', () => {
    expect(v2TempC(4946)).toBeCloseTo(9.7, 1)
    expect(v2TempC(8600)).toBe(30)
  })

  it('refuses nonsense rather than inventing a temperature', () => {
    expect(v2TempC('')).toBeNull()
    expect(v2TempC(null)).toBeNull()
    expect(v2TempC(NaN)).toBeNull()
  })
})

describe('helpers', () => {
  it('goveeRaw leaves plain values alone and scales hundredths', () => {
    expect(goveeRaw(49.46)).toBe(49.46)
    expect(goveeRaw(4946)).toBe(49.46)
  })

  it('fToC rounds to the sensor resolution', () => {
    expect(fToC(49.46)).toBe(9.7)
  })
})
