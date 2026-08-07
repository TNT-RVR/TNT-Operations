import { describe, it, expect } from 'vitest'
import {
  parseDeviceIds,
  checkTargetF,
  mergeAcState,
  describeAcState,
  targetDisagreesWith,
  fToC,
  cToF,
  MIN_TEMP_F,
  MAX_TEMP_F,
} from './sensibo'

describe('parseDeviceIds', () => {
  it('reads one id', () => {
    expect(parseDeviceIds('QCHyvKUG')).toEqual(['QCHyvKUG'])
  })

  it('reads several, however they were separated', () => {
    // An incubator can have more than one AC unit, and the ids live in one
    // column typed by hand.
    expect(parseDeviceIds('AAA, BBB;CCC\nDDD')).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })

  it('is empty for nothing configured', () => {
    expect(parseDeviceIds('')).toEqual([])
    expect(parseDeviceIds(null)).toEqual([])
    expect(parseDeviceIds('  ,  ')).toEqual([])
  })
})

describe('checkTargetF', () => {
  it('accepts the equipment range', () => {
    expect(checkTargetF(MIN_TEMP_F).ok).toBe(true)
    expect(checkTargetF(72).ok).toBe(true)
    expect(checkTargetF(MAX_TEMP_F).ok).toBe(true)
  })

  it('refuses outside it rather than clamping', () => {
    // Clamping would leave someone believing the incubator is somewhere it
    // isn't, which is worse than being told no.
    expect(checkTargetF(95).ok).toBe(false)
    expect(checkTargetF(40).ok).toBe(false)
    expect(checkTargetF(95).message).toMatch(/62–86/)
  })

  it('refuses fractions and nonsense', () => {
    expect(checkTargetF(72.5).ok).toBe(false)
    expect(checkTargetF(NaN).ok).toBe(false)
  })
})

describe('mergeAcState', () => {
  const current = { on: true, mode: 'heat', targetTemperature: 78, temperatureUnit: 'F', fanLevel: 'low' }

  it('changes only what was asked for', () => {
    // Setting a temperature must not turn a unit on, and a power toggle must
    // not reset a mode someone deliberately chose.
    expect(mergeAcState(current, { targetTemperature: 80 })).toEqual({
      ...current,
      targetTemperature: 80,
    })
    expect(mergeAcState(current, { on: false })).toEqual({ ...current, on: false })
  })

  it('always states the unit when sending a temperature', () => {
    // A target sent without its unit can be read as Celsius — a 40-degree
    // mistake on live bees.
    const out = mergeAcState({ on: true, mode: 'heat', targetTemperature: 78 }, { targetTemperature: 80 })
    expect(out.temperatureUnit).toBe('F')
  })

  it('starts from something sane when nothing is known', () => {
    const out = mergeAcState(null, { on: true })
    expect(out.on).toBe(true)
    expect(out.temperatureUnit).toBe('F')
    expect(out.targetTemperature).toBeGreaterThan(0)
  })

  it('does not invent changes from an empty request', () => {
    expect(mergeAcState(current, {})).toEqual(current)
  })
})

describe('describeAcState', () => {
  it('says what the unit is doing', () => {
    expect(describeAcState({ on: true, mode: 'heat', targetTemperature: 78, temperatureUnit: 'F' })).toBe(
      'On · heat · 78°F',
    )
  })

  it('says Off plainly, without the settings', () => {
    // What it would do if switched on is noise when it isn't running.
    expect(describeAcState({ on: false, mode: 'heat', targetTemperature: 78 })).toBe('Off')
  })

  it('distinguishes no reading from off', () => {
    expect(describeAcState(null)).toBe('No reading')
  })

  it('leaves an automatic fan unmentioned', () => {
    expect(describeAcState({ on: true, mode: 'cool', targetTemperature: 70, fanLevel: 'auto' })).toBe(
      'On · cool · 70°F',
    )
  })
})

describe('targetDisagreesWith', () => {
  // Incubation holds 25–35°C.
  const band: [number, number] = [25, 35]

  it('says nothing when the AC agrees with the mode', () => {
    // 86°F is 30°C, mid-band.
    expect(targetDisagreesWith({ on: true, targetTemperature: 86, temperatureUnit: 'F' }, band)).toBeNull()
  })

  it('flags an AC set below the band', () => {
    // 62°F is ~17°C — the incubator is meant to be at 25–35.
    const msg = targetDisagreesWith({ on: true, targetTemperature: 62, temperatureUnit: 'F' }, band)
    expect(msg).toMatch(/below/)
  })

  it('flags an AC set above the band', () => {
    const msg = targetDisagreesWith({ on: true, targetTemperature: 45, temperatureUnit: 'C' }, band)
    expect(msg).toMatch(/above/)
  })

  it('says nothing about an AC that is off, or a mode with no band', () => {
    expect(targetDisagreesWith({ on: false, targetTemperature: 62 }, band)).toBeNull()
    expect(targetDisagreesWith({ on: true, targetTemperature: 62 }, [null, null])).toBeNull()
  })

  it('never changes anything — it only reports', () => {
    const state = { on: true, targetTemperature: 62, temperatureUnit: 'F' }
    const copy = { ...state }
    targetDisagreesWith(state, band)
    expect(state).toEqual(copy)
  })
})

describe('temperature conversion', () => {
  it('round-trips the equipment range', () => {
    expect(fToC(86)).toBeCloseTo(30, 5)
    expect(cToF(30)).toBe(86)
    expect(fToC(62)).toBeCloseTo(16.67, 1)
  })

  it('gives whole degrees going to F, which is what the units take', () => {
    expect(Number.isInteger(cToF(29.4))).toBe(true)
  })
})
