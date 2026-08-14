import { describe, it, expect } from 'vitest'
import { offlineMinutes, isOffline } from './sensorLink.mjs'

const NOW = Date.parse('2026-08-14T12:00:00Z')
const agoMin = (m) => new Date(NOW - m * 60_000).toISOString()

const LIMITS = { runningMin: 45, idleMin: 12 * 60 }

describe('offlineMinutes', () => {
  it('is zero while the sensor is online', () => {
    expect(offlineMinutes({ sensor_online: true, sensor_seen_at: agoMin(500) }, NOW)).toBe(0)
  })

  it('is zero when nothing is known yet', () => {
    // Every incubator looks like this the moment this ships. Treating an
    // unknown as an outage would alert on all of them at once.
    expect(offlineMinutes({}, NOW)).toBe(0)
    expect(offlineMinutes({ sensor_online: null }, NOW)).toBe(0)
  })

  it('measures from the last time it was seen', () => {
    expect(offlineMinutes({ sensor_online: false, sensor_seen_at: agoMin(90) }, NOW)).toBe(90)
  })

  it('is infinite for a sensor that has never once been seen', () => {
    expect(offlineMinutes({ sensor_online: false, sensor_seen_at: null }, NOW)).toBe(Infinity)
  })

  it('does not go negative on a clock that disagrees', () => {
    expect(offlineMinutes({ sensor_online: false, sensor_seen_at: agoMin(-30) }, NOW)).toBe(0)
  })

  it('treats an unparseable timestamp as never seen', () => {
    expect(offlineMinutes({ sensor_online: false, sensor_seen_at: 'nonsense' }, NOW)).toBe(Infinity)
  })
})

describe('isOffline', () => {
  const off = (min) => ({ sensor_online: false, sensor_seen_at: agoMin(min) })

  it('rides out a flicker on a running incubator', () => {
    // One or two missed cycles is a sensor stepping out of range, not a
    // problem — and a 3am push for it is how alerts get ignored.
    expect(isOffline(off(20), { running: true, ...LIMITS }, NOW)).toBe(false)
  })

  it('alerts on a running incubator once it stays gone', () => {
    expect(isOffline(off(60), { running: true, ...LIMITS }, NOW)).toBe(true)
  })

  it('gives an idle incubator a much longer rope', () => {
    expect(isOffline(off(60), { running: false, ...LIMITS }, NOW)).toBe(false)
    expect(isOffline(off(13 * 60), { running: false, ...LIMITS }, NOW)).toBe(true)
  })

  it('says nothing about an online sensor, whatever the mode', () => {
    const on = { sensor_online: true, sensor_seen_at: agoMin(1) }
    expect(isOffline(on, { running: true, ...LIMITS }, NOW)).toBe(false)
    expect(isOffline(on, { running: false, ...LIMITS }, NOW)).toBe(false)
  })

  it('says nothing about an incubator nobody has checked', () => {
    expect(isOffline({}, { running: true, ...LIMITS }, NOW)).toBe(false)
  })

  it('reports a never-seen sensor immediately', () => {
    const never = { sensor_online: false, sensor_seen_at: null }
    expect(isOffline(never, { running: true, ...LIMITS }, NOW)).toBe(true)
    expect(isOffline(never, { running: false, ...LIMITS }, NOW)).toBe(true)
  })
})

describe('falling back to the last reading', () => {
  const off = { sensor_online: false, sensor_seen_at: null }

  it('dates an outage from the last reading when nothing was ever "seen"', () => {
    // Every sensor that dropped off BEFORE this feature shipped looks like
    // this. Calling it "never seen" sends somebody to check the pairing on a
    // sensor that worked for months.
    expect(offlineMinutes(off, NOW, agoMin(27 * 60))).toBe(27 * 60)
  })

  it('still says never seen when there is no evidence at all', () => {
    expect(offlineMinutes(off, NOW, null)).toBe(Infinity)
  })

  it('takes whichever evidence is more recent', () => {
    const inc = { sensor_online: false, sensor_seen_at: agoMin(300) }
    expect(offlineMinutes(inc, NOW, agoMin(60))).toBe(60)
    expect(offlineMinutes(inc, NOW, agoMin(900))).toBe(300)
  })

  it('lets a reading keep an idle incubator below the alert threshold', () => {
    const fresh = agoMin(30)
    expect(isOffline(off, { running: false, ...LIMITS }, NOW, fresh)).toBe(false)
    expect(isOffline(off, { running: false, ...LIMITS }, NOW, agoMin(13 * 60))).toBe(true)
  })
})
