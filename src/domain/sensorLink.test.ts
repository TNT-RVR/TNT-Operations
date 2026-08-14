import { describe, it, expect } from 'vitest'
import { sensorLinkChip, readingStaleness } from './sensorLink'

const NOW = Date.parse('2026-08-14T12:00:00Z')
const agoMin = (m: number) => new Date(NOW - m * 60_000).toISOString()

describe('sensorLinkChip', () => {
  it('says nothing about an incubator with no sensor linked', () => {
    // Not instrumented is not the same as broken.
    const chip = sensorLinkChip({ goveeLinked: false, sensorOnline: false }, NOW)
    expect(chip.state).toBe('none')
    expect(chip.tone).toBe('neutral')
  })

  it('admits when a linked sensor has never been checked', () => {
    // Every incubator looks like this the day this ships. Saying "online"
    // here would be the false comfort the watchdog exists to prevent.
    const chip = sensorLinkChip({ goveeLinked: true, sensorOnline: null }, NOW)
    expect(chip.state).toBe('unknown')
    expect(chip.label).toBe('Sensor: not checked')
  })

  it('reports a reachable sensor with when it was checked', () => {
    const chip = sensorLinkChip(
      { goveeLinked: true, sensorOnline: true, sensorCheckedAt: agoMin(12) },
      NOW,
    )
    expect(chip.state).toBe('online')
    expect(chip.tone).toBe('green')
    expect(chip.detail).toBe('Checked 12 min ago')
  })

  it('measures an outage from when the sensor was last seen', () => {
    const chip = sensorLinkChip(
      { goveeLinked: true, sensorOnline: false, sensorSeenAt: agoMin(3 * 24 * 60) },
      NOW,
    )
    expect(chip.state).toBe('offline')
    expect(chip.tone).toBe('red')
    expect(chip.detail).toBe('Last seen 3 days ago')
  })

  it('says plainly when a sensor has never been seen at all', () => {
    const chip = sensorLinkChip({ goveeLinked: true, sensorOnline: false }, NOW)
    expect(chip.detail).toBe('Never seen on the network')
  })

  it.each([
    [10, '10 min ago'],
    [120, '2 h ago'],
    [60 * 60, '3 days ago'],
  ])('phrases an age of %i minutes as %s', (min, expected) => {
    const chip = sensorLinkChip(
      { goveeLinked: true, sensorOnline: false, sensorSeenAt: agoMin(min) },
      NOW,
    )
    expect(chip.detail).toBe(`Last seen ${expected}`)
  })

  it('does not say a clock-skewed timestamp was in the future', () => {
    const chip = sensorLinkChip(
      { goveeLinked: true, sensorOnline: true, sensorCheckedAt: agoMin(-5) },
      NOW,
    )
    expect(chip.detail).toBe('Checked just now')
  })
})

describe('sensorLinkChip with a last reading to fall back on', () => {
  it('dates the outage from a reading when nothing was ever seen', () => {
    const chip = sensorLinkChip({ goveeLinked: true, sensorOnline: false }, NOW, agoMin(27 * 60))
    expect(chip.detail).toBe('Last seen 27 h ago')
  })

  it('prefers whichever evidence is more recent', () => {
    const inc = { goveeLinked: true, sensorOnline: false, sensorSeenAt: agoMin(300) }
    expect(sensorLinkChip(inc, NOW, agoMin(60)).detail).toBe('Last seen 60 min ago')
    expect(sensorLinkChip(inc, NOW, agoMin(900)).detail).toBe('Last seen 5 h ago')
  })

  it('still admits when there is no evidence at all', () => {
    const chip = sensorLinkChip({ goveeLinked: true, sensorOnline: false }, NOW, null)
    expect(chip.detail).toBe('Never seen on the network')
  })
})

describe('readingStaleness', () => {
  it('leaves a fresh reading alone on a running incubator', () => {
    expect(readingStaleness(agoMin(20), true, NOW)).toEqual({ stale: false, label: null })
  })

  it('calls an hour-old reading stale while a run is on', () => {
    // Running polls every 15 minutes; an hour is four missed cycles.
    expect(readingStaleness(agoMin(90), true, NOW).stale).toBe(true)
  })

  it('gives an idle incubator until a day before saying so', () => {
    // Idle polls every 6 hours, so a few hours quiet is normal, not news.
    expect(readingStaleness(agoMin(5 * 60), false, NOW).stale).toBe(false)
    expect(readingStaleness(agoMin(25 * 60), false, NOW).stale).toBe(true)
  })

  it('dates a stale reading in words', () => {
    expect(readingStaleness(agoMin(27 * 60), false, NOW).label).toBe('27 h ago')
    expect(readingStaleness(agoMin(4 * 24 * 60), false, NOW).label).toBe('4 days ago')
  })

  it('says nothing about an incubator that has never reported', () => {
    expect(readingStaleness(null, true, NOW)).toEqual({ stale: false, label: null })
    expect(readingStaleness('nonsense', true, NOW)).toEqual({ stale: false, label: null })
  })
})
