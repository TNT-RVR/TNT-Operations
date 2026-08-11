/**
 * Tests for the Alberta Township System geocoder.
 *
 * Two halves. The first pins the survey's STRUCTURE — section numbering,
 * quarter placement, meridians — where a mistake puts a parcel miles away and
 * still looks plausible on a map. The second measures ACCURACY against fifteen
 * real TNT fields whose surveyed pivot coordinates are known, so the claim made
 * in the UI ("within a few hundred metres") is a measurement rather than a
 * hope.
 */
import { describe, it, expect } from 'vitest'
import realFields from './__fixtures__/atsRealFields.json'
import {
  MERIDIANS,
  TYPICAL_ERROR_M,
  atsBox,
  contains,
  distanceM,
  sectionGridPosition,
  toGeoJson,
  townshipSouthLat,
} from './ats'
import { parseLld } from './lld'

const box = (lld: string) => {
  const p = parseLld(lld)
  if (!p) throw new Error(`unparseable: ${lld}`)
  return atsBox({ ...p, meridian: p.meridian ?? 4 })!
}

// ═══════════════════════════════════════════════════════════════════════════
// Structure
// ═══════════════════════════════════════════════════════════════════════════

describe('sectionGridPosition', () => {
  it('puts section 1 in the SOUTH-EAST corner', () => {
    // The serpentine starts at the south-east. Getting this backwards mirrors
    // the whole township — six miles out, and it still looks like a section.
    expect(sectionGridPosition(1)).toEqual({ colFromWest: 5, rowFromSouth: 0 })
  })

  it('puts 6 in the south-west, 31 in the north-west, 36 in the north-east', () => {
    expect(sectionGridPosition(6)).toEqual({ colFromWest: 0, rowFromSouth: 0 })
    expect(sectionGridPosition(31)).toEqual({ colFromWest: 0, rowFromSouth: 5 })
    expect(sectionGridPosition(36)).toEqual({ colFromWest: 5, rowFromSouth: 5 })
  })

  it('reverses direction every row', () => {
    // 6 and 7 are stacked, as are 12 and 13 — that is what serpentine means.
    expect(sectionGridPosition(7)?.colFromWest).toBe(sectionGridPosition(6)?.colFromWest)
    expect(sectionGridPosition(13)?.colFromWest).toBe(sectionGridPosition(12)?.colFromWest)
  })

  it('rejects a section outside 1–36', () => {
    for (const s of [0, 37, -1, 1.5, NaN]) expect(sectionGridPosition(s)).toBeNull()
  })
})

describe('townshipSouthLat', () => {
  it('starts at the international boundary', () => {
    expect(townshipSouthLat(1)).toBe(49)
  })

  it('climbs about six miles a township', () => {
    const step = townshipSouthLat(2) - townshipSouthLat(1)
    // 6 miles plus road allowance ≈ 0.0874°.
    expect(step).toBeGreaterThan(0.085)
    expect(step).toBeLessThan(0.09)
  })

  it('reaches roughly the right latitude far north', () => {
    // Township 100 is up near Peace River, around 57°N.
    const lat = townshipSouthLat(100)
    expect(lat).toBeGreaterThan(55.5)
    expect(lat).toBeLessThan(58.5)
  })
})

describe('atsBox geometry', () => {
  it('makes a quarter about half a mile square', () => {
    const b = box('SW-16-9-15-W4')
    const width = distanceM({ lat: b.bounds.south, lng: b.bounds.west }, { lat: b.bounds.south, lng: b.bounds.east })
    const height = distanceM({ lat: b.bounds.south, lng: b.bounds.west }, { lat: b.bounds.north, lng: b.bounds.west })
    expect(width).toBeGreaterThan(780)
    expect(width).toBeLessThan(830)
    expect(height).toBeGreaterThan(780)
    expect(height).toBeLessThan(830)
  })

  it('makes a whole section when no quarter is given', () => {
    const b = box('16-9-15-W4')
    const width = distanceM({ lat: b.bounds.south, lng: b.bounds.west }, { lat: b.bounds.south, lng: b.bounds.east })
    expect(width).toBeGreaterThan(1570)
    expect(width).toBeLessThan(1660)
  })

  it('places the four quarters of a section correctly relative to each other', () => {
    const ne = box('NE-16-9-15-W4').center
    const nw = box('NW-16-9-15-W4').center
    const se = box('SE-16-9-15-W4').center
    const sw = box('SW-16-9-15-W4').center
    expect(ne.lat).toBeGreaterThan(se.lat)
    expect(nw.lat).toBeGreaterThan(sw.lat)
    expect(ne.lng).toBeGreaterThan(nw.lng)
    expect(se.lng).toBeGreaterThan(sw.lng)
    // Quarter centres are half a mile apart.
    expect(distanceM(sw, se)).toBeGreaterThan(760)
    expect(distanceM(sw, se)).toBeLessThan(850)
  })

  it('moves WEST as the range increases', () => {
    expect(box('SW-16-9-16-W4').center.lng).toBeLessThan(box('SW-16-9-15-W4').center.lng)
  })

  it('moves NORTH as the township increases', () => {
    expect(box('SW-16-10-15-W4').center.lat).toBeGreaterThan(box('SW-16-9-15-W4').center.lat)
  })

  it('puts range 1 just west of its meridian', () => {
    const b = box('SW-6-1-1-W4')
    expect(b.bounds.east).toBeLessThan(MERIDIANS[4])
    expect(MERIDIANS[4] - b.bounds.east).toBeLessThan(0.15)
  })

  it('separates the meridians', () => {
    const w4 = box('SW-16-9-15-W4').center.lng
    const p5 = parseLld('SW-16-9-15-W5')!
    const w5 = atsBox({ ...p5, meridian: 5 })!.center.lng
    expect(w5).toBeLessThan(w4)
    expect(w4 - w5).toBeGreaterThan(3.5)
  })

  it('refuses an impossible description rather than guessing', () => {
    expect(atsBox({ quarter: 'SW', section: 40, township: 9, range: 15, meridian: 4 })).toBeNull()
    expect(atsBox({ quarter: 'SW', section: 16, township: 0, range: 15, meridian: 4 })).toBeNull()
    expect(atsBox({ quarter: 'SW', section: 16, township: 9, range: 99, meridian: 4 })).toBeNull()
    expect(atsBox({ quarter: 'SW', section: 16, township: 9, range: 15, meridian: 9 })).toBeNull()
  })

  it('produces a closed GeoJSON ring', () => {
    const f = toGeoJson(box('SW-16-9-15-W4'), 'test')
    const ring = f.geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
    expect(f.properties?.label).toBe('test')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Accuracy, against real surveyed fields
// ═══════════════════════════════════════════════════════════════════════════

interface RealField {
  lld: string
  lat: number
  lon: number
  file: string
}

/**
 * Fifteen TNT fields with both a legal land description and the surveyed
 * coordinate of their pivot, taken from the desktop app's field files.
 *
 * The pivot is not exactly the quarter's centre — it is wherever the pivot was
 * installed — so a perfect geocoder would still show a few hundred metres of
 * scatter here. These thresholds are set from the MEASURED distribution, not
 * from what would be nice.
 */
const REAL = realFields as RealField[]

describe('accuracy against real fields', () => {
  const errors = REAL.map((f) => {
    const p = parseLld(f.lld)!
    const b = atsBox({ ...p, meridian: p.meridian ?? 4 })!
    return { ...f, box: b, error: distanceM(b.center, { lat: f.lat, lng: f.lon }) }
  })

  it('parses every real LLD', () => {
    expect(REAL.every((f) => parseLld(f.lld) !== null)).toBe(true)
    expect(REAL.length).toBeGreaterThanOrEqual(15)
  })

  it('lands within half a kilometre of the pivot, typically', () => {
    const sorted = [...errors].map((e) => e.error).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median).toBeLessThan(500)
  })

  it('is never wildly wrong — no field is a section away', () => {
    // The failure that matters is landing on the wrong parcel. A mile is the
    // width of a section, so anything beyond that is a different piece of land.
    for (const e of errors) {
      expect(e.error, `${e.lld} (${e.file})`).toBeLessThan(1609)
    }
  })

  it('puts most pivots inside the computed SECTION', () => {
    // Quarter-level containment is too strict given the pivots are not centred,
    // but the section is the unit someone actually navigates to.
    let inside = 0
    for (const f of REAL) {
      const p = parseLld(f.lld)!
      const section = atsBox({ ...p, quarter: null, meridian: p.meridian ?? 4 })!
      if (contains(section, { lat: f.lat, lng: f.lon })) inside++
    }
    expect(inside / REAL.length).toBeGreaterThanOrEqual(0.6)
  })

  it('keeps the advertised error honest', () => {
    // TYPICAL_ERROR_M is shown to users. If the geometry changes such that the
    // real error drifts away from it, this fails and the number gets updated —
    // rather than the UI quietly claiming an accuracy it no longer has.
    const rms = Math.sqrt(errors.reduce((s, e) => s + e.error ** 2, 0) / errors.length)
    expect(rms).toBeGreaterThan(TYPICAL_ERROR_M * 0.5)
    expect(rms).toBeLessThan(TYPICAL_ERROR_M * 2)
  })
})
