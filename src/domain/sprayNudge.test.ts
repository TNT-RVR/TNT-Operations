import { describe, it, expect } from 'vitest'
import { nearestPass, shiftToParkedSprayPass } from './sprayNudge'
import { sprayerPassLines } from './sprayOverlays'

/** The same realistic pivot the overlay tests use. */
const FIELD = {
  PP_Latitude: '49.83',
  PP_Longitude: '-111.6',
  Radius: '400',
  Sprayer_width: '133',
  use_bays: true,
  num_female_rows: '8',
  num_male_rows: '2',
  total_rows: '20',
  row_layout: 'centered',
  row_spacing_in: '22',
  Planting_angle: '0',
}

const sx = 111_320 * Math.cos((49.83 * Math.PI) / 180)

/** A point on the first pass line, and one offset east of it. */
const onPass = (offsetM = 0) => {
  const line = sprayerPassLines(FIELD).features[0]
  const [[lng0, lat0], [lng1, lat1]] = line.geometry.coordinates as Array<[number, number]>
  return { lat: (lat0 + lat1) / 2, lng: (lng0 + lng1) / 2 + offsetM / sx }
}

describe('nearestPass', () => {
  it('finds a pass under the point', () => {
    const r = nearestPass(FIELD, onPass())!
    expect(r.distM).toBeLessThan(0.01)
  })

  it('measures how far off a point is', () => {
    const r = nearestPass(FIELD, onPass(5))!
    expect(r.distM).toBeCloseTo(5, 0)
  })

  it('returns null for a field with no frame', () => {
    expect(nearestPass({}, { lat: 49.83, lng: -111.6 })).toBeNull()
  })
})

describe('shiftToParkedSprayPass', () => {
  it('puts a pass line under the parked point', () => {
    // The property that matters, and the reason the sign is found by trying:
    // apply what it returns and the nearest pass now runs through you.
    const parked = onPass(6)
    const r = shiftToParkedSprayPass(FIELD, parked)!
    const after = nearestPass({ ...FIELD, sprayer_shift: r.sprayerShiftM }, parked)!
    expect(after.distM).toBeLessThan(0.05)
  })

  it('reports how far it moved', () => {
    const r = shiftToParkedSprayPass(FIELD, onPass(6))!
    expect(r.movedM).toBeCloseTo(6, 0)
  })

  it('works in both directions', () => {
    for (const off of [-9, -3, 3, 9]) {
      const parked = onPass(off)
      const r = shiftToParkedSprayPass(FIELD, parked)!
      const after = nearestPass({ ...FIELD, sprayer_shift: r.sprayerShiftM }, parked)!
      expect(after.distM).toBeLessThan(0.05)
    }
  })

  it('builds on an existing shift rather than replacing it', () => {
    // A field already nudged once must not jump back to zero when nudged again.
    const started = { ...FIELD, sprayer_shift: 4 }
    const parked = onPass(2)
    const r = shiftToParkedSprayPass(started, parked)!
    const after = nearestPass({ ...started, sprayer_shift: r.sprayerShiftM }, parked)!
    expect(after.distM).toBeLessThan(0.05)
  })

  it('is a no-op when already parked on a pass', () => {
    const r = shiftToParkedSprayPass(FIELD, onPass())!
    expect(r.movedM).toBeLessThan(0.01)
  })

  it('returns null for a field it cannot frame', () => {
    expect(shiftToParkedSprayPass({}, { lat: 49.83, lng: -111.6 })).toBeNull()
  })
})
