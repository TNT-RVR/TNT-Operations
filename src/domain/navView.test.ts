import { describe, it, expect } from 'vitest'
import { headingDelta, nextHeading, cameraFor, shouldMoveCamera, MOVING_MPS } from './navView'

describe('headingDelta', () => {
  it('turns the short way across north', () => {
    // The bug this prevents: 350° to 10° sweeping 340° backwards through south.
    expect(headingDelta(350, 10)).toBe(20)
    expect(headingDelta(10, 350)).toBe(-20)
  })

  it('is zero for the same heading', () => {
    expect(headingDelta(180, 180)).toBe(0)
  })

  it('resolves a half-turn consistently', () => {
    // Either answer is 'correct'; picking one stops the view oscillating.
    expect(headingDelta(0, 180)).toBe(180)
    expect(headingDelta(180, 0)).toBe(180)
  })
})

describe('nextHeading', () => {
  it('takes the first heading whole, once actually moving', () => {
    expect(nextHeading(null, { heading: 90, speed: 3 })).toBe(90)
  })

  it('holds the last heading while stopped', () => {
    // A GPS fix at a standstill wanders, and its reported course spins with it.
    // A map that turns while the tractor sits still is unusable.
    expect(nextHeading(90, { heading: 250, speed: 0 })).toBe(90)
    expect(nextHeading(90, { heading: 250, speed: MOVING_MPS - 0.01 })).toBe(90)
  })

  it('holds when no course is reported', () => {
    expect(nextHeading(90, { heading: null, speed: 5 })).toBe(90)
    expect(nextHeading(90, { speed: 5 })).toBe(90)
  })

  it('eases toward a new heading rather than snapping', () => {
    const h = nextHeading(0, { heading: 90, speed: 5 })!
    expect(h).toBeGreaterThan(0)
    expect(h).toBeLessThan(90)
  })

  it('eases across north without spinning the long way', () => {
    const h = nextHeading(350, { heading: 10, speed: 5 })!
    // Should move forwards past 350 — either just under 360 or just over 0.
    expect(h > 350 || h < 10).toBe(true)
  })

  it('normalises a heading of 360 to 0', () => {
    expect(nextHeading(null, { heading: 360, speed: 5 })).toBe(0)
  })

  it('stays null until the first usable fix', () => {
    expect(nextHeading(null, { heading: 90, speed: 0 })).toBeNull()
  })
})

describe('cameraFor', () => {
  const base = { lng: -111.6, lat: 49.83, currentBearing: 42 }

  it('tilts and turns with travel in drive mode', () => {
    const c = cameraFor({ ...base, heading: 120, mode: 'drive' })
    expect(c.pitch).toBeGreaterThan(45)
    expect(c.bearing).toBe(120)
    expect(c.zoom).toBeGreaterThan(17)
  })

  it('keeps the current bearing when the heading is unknown', () => {
    // Snapping to north the moment you stop throws away the view you were using.
    const c = cameraFor({ ...base, heading: null, mode: 'drive' })
    expect(c.bearing).toBe(42)
  })

  it('is flat and north-up overhead', () => {
    const c = cameraFor({ ...base, heading: 120, mode: 'overhead' })
    expect(c).toMatchObject({ pitch: 0, bearing: 0 })
  })
})

describe('shouldMoveCamera', () => {
  const at = (lng: number, lat: number, bearing = 0) => ({ center: [lng, lat] as [number, number], bearing })
  const target = (lng: number, lat: number, bearing = 0) => ({
    center: [lng, lat] as [number, number],
    zoom: 17.5,
    pitch: 60,
    bearing,
  })

  it('ignores a fix that has barely moved', () => {
    // ~0.3 m. Animating every one of these judders the map and eats battery.
    expect(shouldMoveCamera(at(-111.6, 49.83), target(-111.6, 49.830003))).toBe(false)
  })

  it('follows a real step forward', () => {
    // ~5 m north.
    expect(shouldMoveCamera(at(-111.6, 49.83), target(-111.6, 49.83005))).toBe(true)
  })

  it('follows a turn even when standing still', () => {
    expect(shouldMoveCamera(at(-111.6, 49.83, 10), target(-111.6, 49.83, 40))).toBe(true)
  })

  it('ignores a turn small enough to be noise', () => {
    expect(shouldMoveCamera(at(-111.6, 49.83, 10), target(-111.6, 49.83, 11))).toBe(false)
  })
})
