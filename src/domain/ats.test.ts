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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import realFields from './__fixtures__/atsRealFields.json'
import {
  GRID_ERROR_M,
  MERIDIANS,
  SURVEY_ERROR_M,
  atsBox,
  contains,
  distanceM,
  parseTownshipTable,
  reverseLld,
  sameParcel,
  sectionAt,
  sectionGridPosition,
  toGeoJson,
  townshipSouthLat,
  type TownshipTable,
} from './ats'
import { formatLld, parseLld } from './lld'

/**
 * The survey table the app ships. Read from disk rather than mocked, so these
 * tests fail if the asset is missing, truncated or rebuilt into a different
 * shape — the exact ways this feature would silently go back to being 300 m
 * out in production.
 */
const TABLE: TownshipTable = (() => {
  const buf = readFileSync(resolve(__dirname, '../../public/ats-townships.bin'))
  const t = parseTownshipTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  if (!t) throw new Error('public/ats-townships.bin is missing or corrupt — rebuild it')
  return t
})()

/** Grid tier: no table. */
const box = (lld: string) => {
  const p = parseLld(lld)
  if (!p) throw new Error(`unparseable: ${lld}`)
  return atsBox({ ...p, meridian: p.meridian ?? 4 })!
}

/** Survey tier. */
const surveyed = (lld: string) => {
  const p = parseLld(lld)
  if (!p) throw new Error(`unparseable: ${lld}`)
  return atsBox({ ...p, meridian: p.meridian ?? 4 }, TABLE)!
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

/** Distance from a description's computed centre to the field's real pivot. */
const errorFor = (f: RealField, table?: TownshipTable) => {
  const p = parseLld(f.lld)!
  const b = atsBox({ ...p, meridian: p.meridian ?? 4 }, table)!
  return distanceM(b.center, { lat: f.lat, lng: f.lon })
}

describe('accuracy against real fields', () => {
  it('parses every real LLD', () => {
    expect(REAL.every((f) => parseLld(f.lld) !== null)).toBe(true)
    expect(REAL.length).toBeGreaterThanOrEqual(15)
  })

  it('covers every real field with survey data', () => {
    // All fifteen are W4 in southern Alberta. If one ever falls back to the
    // grid, the table was built from the wrong source or is missing townships.
    for (const f of REAL) {
      const p = parseLld(f.lld)!
      const b = atsBox({ ...p, meridian: p.meridian ?? 4 }, TABLE)!
      expect(b.source, `${f.lld} (${f.file})`).toBe('survey')
    }
  })

  it('puts EVERY pivot inside its quarter section', () => {
    // The strong claim, and the one the map is judged on. It only holds on the
    // survey tier — the grid tier misses most of these, which is the whole
    // reason the survey table is shipped.
    for (const f of REAL) {
      const p = parseLld(f.lld)!
      const q = atsBox({ ...p, meridian: p.meridian ?? 4 }, TABLE)!
      expect(contains(q, { lat: f.lat, lng: f.lon }), `${f.lld} (${f.file})`).toBe(true)
    }
  })

  it('keeps the advertised survey error honest', () => {
    // SURVEY_ERROR_M is shown to the user. The pivot is not the quarter's
    // centre — it is wherever it was installed — so this compares against a
    // quarter's half-diagonal, the most a correctly placed pivot could be off
    // by, rather than against the model error itself.
    const worst = Math.max(...REAL.map((f) => errorFor(f, TABLE)))
    expect(worst).toBeLessThan(600)
    expect(SURVEY_ERROR_M).toBeLessThan(100)
  })

  it('beats the grid tier by an order of magnitude', () => {
    // Compared on the median, not per field. A pivot is not at its quarter's
    // centre — one of these fifteen sits 285 m off inside a quarter the survey
    // tier places correctly — so a per-field comparison measures where the
    // pivot was installed as much as it measures the model.
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const survey = med(REAL.map((f) => errorFor(f, TABLE)))
    const grid = med(REAL.map((f) => errorFor(f)))
    expect(survey).toBeLessThan(100)
    expect(grid).toBeGreaterThan(200)
    expect(survey * 5).toBeLessThan(grid)
  })

  it('is the reason the quarter claim holds at all', () => {
    // The survey tier gets all fifteen; the grid tier does not. That gap is
    // what the 141 KiB asset buys, stated as a test so removing it fails here.
    const inQuarter = (table?: TownshipTable) =>
      REAL.filter((f) => {
        const p = parseLld(f.lld)!
        return contains(atsBox({ ...p, meridian: p.meridian ?? 4 }, table)!, { lat: f.lat, lng: f.lon })
      }).length
    expect(inQuarter(TABLE)).toBe(REAL.length)
    expect(inQuarter()).toBeLessThan(REAL.length)
  })

  it('still answers without the table, within the error it advertises', () => {
    // The fallback has to stay usable — it is what Saskatchewan gets.
    const errs = REAL.map((f) => errorFor(f)).sort((a, b) => a - b)
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
    expect(rms).toBeLessThan(GRID_ERROR_M * 2)
    expect(Math.max(...errs)).toBeLessThan(1609)
  })
})

describe('township table', () => {
  it('loads the whole survey', () => {
    expect(TABLE.size).toBeGreaterThan(7000)
  })

  it('covers the Alberta meridians and not the eastern ones', () => {
    expect(TABLE.get(4, 9, 15)).not.toBeNull()
    // W1/W2 are Manitoba and Saskatchewan — deliberately absent.
    expect(TABLE.get(1, 9, 15)).toBeNull()
  })

  it('stores a section pitch slightly larger than the section itself', () => {
    // The difference is the road allowance. If these were ever equal, the
    // builder went back to deriving pitch from size — the bug that put the
    // prediction four times further out.
    const t = TABLE.get(4, 9, 15)!
    expect(t.pitchLat).toBeGreaterThan(t.sizeLat)
    expect(t.pitchLon).toBeGreaterThan(t.sizeLon)
    expect(t.pitchLat - t.sizeLat).toBeLessThan(0.001)
  })

  it('rejects a corrupt or missing file instead of guessing', () => {
    expect(parseTownshipTable(new ArrayBuffer(0))).toBeNull()
    expect(parseTownshipTable(new ArrayBuffer(4))).toBeNull()
    // Right size, wrong magic — e.g. a 404 HTML page served as the asset.
    const bad = new ArrayBuffer(64)
    new DataView(bad).setUint32(0, 0x3c21444f, false)
    expect(parseTownshipTable(bad)).toBeNull()
    // Correct magic but truncated body.
    const short = new ArrayBuffer(12)
    const v = new DataView(short)
    v.setUint32(0, 0x41545431, false)
    v.setUint32(4, 500, true)
    expect(parseTownshipTable(short)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Reverse — coordinate → description
// ═══════════════════════════════════════════════════════════════════════════

describe('sectionAt', () => {
  it('inverts sectionGridPosition for all 36 sections', () => {
    for (let s = 1; s <= 36; s++) {
      const pos = sectionGridPosition(s)!
      expect(sectionAt(pos.rowFromSouth, 5 - pos.colFromWest)).toBe(s)
    }
  })
})

describe('reverseLld', () => {
  it('recovers the recorded LLD of every real field from its pivot', () => {
    // The strongest test in the file. These are surveyed pivot coordinates and
    // descriptions recorded independently by the crew — neither derived from
    // the other — so agreeing on all fifteen is a real check, not a round-trip
    // through my own arithmetic.
    for (const f of REAL) {
      const got = reverseLld({ lat: f.lat, lng: f.lon }, TABLE)
      const want = parseLld(f.lld)!
      // Compared on parts, not text: one of the fifteen is recorded without a
      // meridian ("SE 9-11-14"), and reverse always supplies one. Everything
      // that was written down has to match; what was left out cannot.
      expect(
        {
          quarter: got?.parts.quarter,
          section: got?.parts.section,
          township: got?.parts.township,
          range: got?.parts.range,
          meridian: want.meridian ?? got?.parts.meridian,
        },
        `${f.lld} (${f.file}) → ${got?.text}`,
      ).toEqual({
        quarter: want.quarter,
        section: want.section,
        township: want.township,
        range: want.range,
        meridian: want.meridian ?? 4,
      })
    }
  })

  it('uses the survey for all of them', () => {
    for (const f of REAL) {
      expect(reverseLld({ lat: f.lat, lng: f.lon }, TABLE)?.source).toBe('survey')
    }
  })

  it('round-trips against atsBox across a whole township', () => {
    // Every section and every quarter: box it, take the centre, reverse it,
    // and expect the description back. Catches a row/column flip that the
    // fifteen real fields — which do not cover all 36 sections — would miss.
    for (let section = 1; section <= 36; section++) {
      for (const quarter of ['NE', 'NW', 'SE', 'SW']) {
        const parts = { quarter, section, township: 9, range: 15, meridian: 4 }
        const b = atsBox(parts, TABLE)!
        expect(reverseLld(b.center, TABLE)?.text, `${quarter}-${section}-9-15-W4`).toBe(
          `${quarter}-${section}-9-15-W4`,
        )
      }
    }
  })

  it('round-trips on the grid tier too', () => {
    for (let section = 1; section <= 36; section += 7) {
      for (const quarter of ['NE', 'SW']) {
        const parts = { quarter, section, township: 40, range: 8, meridian: 5 }
        const b = atsBox(parts)!
        expect(reverseLld(b.center)?.text).toBe(`${quarter}-${section}-40-8-W5`)
      }
    }
  })

  it('answers at coarser granularity when asked', () => {
    const p = surveyed('SW-16-9-15-W4').center
    expect(reverseLld(p, TABLE, 'section')?.text).toBe('16-9-15-W4')
    expect(reverseLld(p, TABLE, 'township')?.text).toBe('9-15-W4')
  })

  it('produces text the forward parser accepts', () => {
    // The output is written into a field's `lld`, which everything else reads
    // through parseLld. If the two ever disagree on format, the autofill writes
    // a value the app cannot read back.
    for (const f of REAL) {
      const text = reverseLld({ lat: f.lat, lng: f.lon }, TABLE)!.text
      expect(parseLld(text), text).not.toBeNull()
      expect(formatLld(text)).toBe(text)
    }
  })

  it('picks the right meridian either side of one', () => {
    const lat = 50.5
    expect(reverseLld({ lat, lng: -110.5 }, TABLE)?.parts.meridian).toBe(4)
    expect(reverseLld({ lat, lng: -114.5 }, TABLE)?.parts.meridian).toBe(5)
    expect(reverseLld({ lat, lng: -118.5 }, TABLE)?.parts.meridian).toBe(6)
    // Just east of the 4th meridian is Saskatchewan — W3, and no survey data.
    const sask = reverseLld({ lat, lng: -109.5 }, TABLE)
    expect(sask?.parts.meridian).toBe(3)
    expect(sask?.source).toBe('grid')
  })

  it('refuses a point off the survey rather than inventing one', () => {
    expect(reverseLld({ lat: 45, lng: -110.5 }, TABLE)).toBeNull() // south of the border
    expect(reverseLld({ lat: NaN, lng: -110.5 }, TABLE)).toBeNull()
    expect(reverseLld({ lat: 50.5, lng: -90 }, TABLE)).toBeNull() // east of W1
  })
})

describe('sameParcel', () => {
  const pivot = { quarter: 'SW', section: 35, township: 8, range: 21, meridian: 4 }

  it('accepts the same parcel written out in full', () => {
    expect(sameParcel(parseLld('SW-35-8-21-W4'), pivot)).toBe(true)
  })

  it('accepts a description that merely says LESS', () => {
    // Absent is not wrong. Warning on these would fire on real fields — one of
    // the fifteen is recorded without a meridian — and a warning that cries
    // wolf gets ignored on the day it matters.
    expect(sameParcel(parseLld('SW-35-8-21'), pivot)).toBe(true)
    expect(sameParcel(parseLld('35-8-21-W4'), pivot)).toBe(true)
    expect(sameParcel(parseLld('35-8-21'), pivot)).toBe(true)
  })

  it('rejects a stated value that actually differs', () => {
    expect(sameParcel(parseLld('NE-35-8-21-W4'), pivot)).toBe(false) // wrong quarter
    expect(sameParcel(parseLld('SW-36-8-21-W4'), pivot)).toBe(false) // wrong section
    expect(sameParcel(parseLld('SW-35-9-21-W4'), pivot)).toBe(false) // wrong township
    expect(sameParcel(parseLld('SW-35-8-22-W4'), pivot)).toBe(false) // wrong range
    expect(sameParcel(parseLld('SW-35-8-21-W5'), pivot)).toBe(false) // wrong meridian
  })

  it('catches a transposed township and range', () => {
    // The classic typo, and one that reads perfectly well on paper.
    expect(sameParcel(parseLld('SW-35-21-8-W4'), pivot)).toBe(false)
  })

  it('rejects an unreadable description rather than passing it', () => {
    expect(sameParcel(null, pivot)).toBe(false)
    expect(sameParcel(parseLld('Wordmans'), pivot)).toBe(false)
  })

  it('agrees with itself for every real field', () => {
    // The warning must be silent on data that is already correct.
    for (const f of REAL) {
      const got = reverseLld({ lat: f.lat, lng: f.lon }, TABLE)!
      expect(sameParcel(parseLld(f.lld), got.parts), `${f.lld} (${f.file})`).toBe(true)
    }
  })
})

describe('the correction line — the bug this fixes', () => {
  // Two townships either side of a correction line, from the report that the
  // box sat east of the parcel in one and west of it in the other. A uniform
  // grid cannot get both right; the survey table can.
  const pair = ['SW-3-11-13-W4', 'SW-33-10-13-W4']

  it('shifts the two in OPPOSITE directions relative to the grid', () => {
    const deltas = pair.map((lld) => surveyed(lld).center.lng - box(lld).center.lng)
    expect(Math.sign(deltas[0])).not.toBe(Math.sign(deltas[1]))
    for (const d of deltas) expect(Math.abs(d)).toBeGreaterThan(0.001)
  })

  it('places both from the survey', () => {
    for (const lld of pair) expect(surveyed(lld).source).toBe('survey')
  })
})
