import { describe, it, expect } from 'vitest'
import type { Feature, Polygon, Position } from 'geojson'
import { area as turfArea, booleanPointInPolygon } from '@turf/turf'
import { maleBayBands, planterPassLines, alignmentLines } from './bayOverlays'
import { fieldFrame, latAlongToLonLat, enuToLatAlong, type FieldFrame } from './fieldFrame'
import { fromLonLat } from './geo'
import type { FieldDict } from './tentGrid'

const IN_TO_M = 0.0254

/** A realistic pivot field: 400 m radius, 8F/2M centred, tiled to 20 rows. */
const FIELD: FieldDict = {
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

const withGap = (gapIn: string): FieldDict => ({ ...FIELD, bay_gap_in: gapIn })

const RS_M = 22 * IN_TO_M
const MALE_RUN_ROWS = 2 // "FFFFMMFFFF" tiled → every male run is 2 rows wide

/** [lon,lat] → the frame's lateral coordinate (the exact inverse of the draw path). */
function toLateral(f: FieldFrame, p: Position): number {
  const [e, n] = fromLonLat(p[0], p[1], f.pivotLon)
  return enuToLatAlong(f, e - f.easting, n - f.northing)[0]
}

/** [lon,lat] → the frame's ALONG coordinate. Companion to `toLateral`. */
function toAlong(f: FieldFrame, p: Position): number {
  const [e, n] = fromLonLat(p[0], p[1], f.pivotLon)
  return enuToLatAlong(f, e - f.easting, n - f.northing)[1]
}

const allFinite = (coords: Position[]): boolean =>
  coords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))

describe('maleBayBands', () => {
  it('emits bands for a real pivot field, all coordinates finite', () => {
    const fc = maleBayBands(FIELD)
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features.length).toBeGreaterThan(0)
    for (const feat of fc.features) {
      expect(feat.geometry.type).toBe('Polygon')
      const ring = feat.geometry.coordinates[0]
      expect(ring).toHaveLength(5) // 4 corners + closing point
      expect(ring[0]).toEqual(ring[4])
      expect(allFinite(ring)).toBe(true)
      expect(feat.properties).toMatchObject({ kind: 'male_bay' })
      expect(Number.isInteger((feat.properties as { pass: number }).pass)).toBe(true)
    }
  })

  // The §5.3 invariant: a male run (s,e) is EXACTLY (e-s)·rs_m wide because the
  // gap is inserted between bays, never inside one. This is the Wordmans/Carrots
  // regression — bay_gap_in used to be subtracted from the band.
  it.each(['0', '6', '12', '33'])('band width is nm·row_spacing with bay_gap_in=%s', (gapIn) => {
    const field = withGap(gapIn)
    const f = fieldFrame(field)!
    const fc = maleBayBands(field)
    expect(fc.features.length).toBeGreaterThan(0)
    const expected = MALE_RUN_ROWS * RS_M
    for (const feat of fc.features) {
      const corners = feat.geometry.coordinates[0].slice(0, 4).map((c) => toLateral(f, c))
      const width = Math.max(...corners) - Math.min(...corners)
      expect(Math.abs(width - expected)).toBeLessThan(1e-6)
    }
  })

  it('a gap widens the PASS but never the band', () => {
    const f0 = fieldFrame(withGap('0'))!
    const f6 = fieldFrame(withGap('6'))!
    // gap lands at the 4 mask changes of "FFFFMMFFFFFFFFMMFFFF"
    expect(f0.passW).toBeCloseTo(20 * RS_M, 9)
    expect(f6.passW).toBeCloseTo(20 * RS_M + 4 * 6 * IN_TO_M, 9)
    expect(f6.passW).toBeGreaterThan(f0.passW)

    const widthOf = (field: FieldDict, f: FieldFrame) => {
      const ring = maleBayBands(field).features[0].geometry.coordinates[0]
      const lat = ring.slice(0, 4).map((c) => toLateral(f, c))
      return Math.max(...lat) - Math.min(...lat)
    }
    expect(widthOf(withGap('0'), f0)).toBeCloseTo(widthOf(withGap('6'), f6), 6)
  })

  it('honours the snake: even and odd passes mirror each other', () => {
    const f = fieldFrame(FIELD)!
    const fc = maleBayBands(FIELD)
    const lows = new Map<number, number[]>()
    for (const feat of fc.features) {
      const pass = (feat.properties as { pass: number }).pass
      const lat = feat.geometry.coordinates[0].slice(0, 4).map((c) => toLateral(f, c))
      const rel = Math.min(...lat) - (pass + 0.5) * f.passW + f.passW / 2
      if (!lows.has(pass)) lows.set(pass, [])
      lows.get(pass)!.push(rel)
    }
    const even = lows.get(0)!.slice().sort((a, b) => a - b)
    const odd = lows.get(1)!.slice().sort((a, b) => a - b)
    // "FFFFMMFFFFFFFFMMFFFF" is a palindrome-by-run mask, so forward and reversed
    // runs land on the same offsets — the snake must not shift the bands.
    expect(odd[0]).toBeCloseTo(even[0], 6)
    expect(odd[1]).toBeCloseTo(even[1], 6)
  })

  it('is empty for degenerate input, never throws', () => {
    expect(maleBayBands({}).features).toHaveLength(0) // nothing at all
    // non-numeric pivot → fieldFrame returns null
    expect(maleBayBands({ ...FIELD, PP_Latitude: 'n/a' }).features).toHaveLength(0)
    expect(maleBayBands({ ...FIELD, use_bays: false }).features).toHaveLength(0)
    expect(maleBayBands({ ...FIELD, row_spacing_in: '0' }).features).toHaveLength(0)
    // empty mask (no rows at all)
    expect(
      maleBayBands({ ...FIELD, num_female_rows: '0', num_male_rows: '0', total_rows: '0' }).features,
    ).toHaveLength(0)
    // all-female mask → no male runs
    expect(maleBayBands({ ...FIELD, num_male_rows: '0' }).features).toHaveLength(0)
  })

  // ── spec §6.4 "Toggle Bays Through Inner" (`bays_through_inner`, default off) ──
  describe('inner-boundary clipping', () => {
    const f = fieldFrame(FIELD)!
    // Pass 0's FIRST male band: rows 4–5 of "FFFFMMFFFFFFFFMMFFFF".
    const BAND_LO = 4 * RS_M
    const BAND_HI = 6 * RS_M
    const BAND_MID = (BAND_LO + BAND_HI) / 2

    /** An inner ring over the frame rectangle [latA,latB] × [alongA,alongB], stored [lat,lon]. */
    const holeRing = (
      latA: number,
      latB: number,
      alongA: number,
      alongB: number,
    ): Array<[number, number]> =>
      (
        [
          [latA, alongA],
          [latB, alongA],
          [latB, alongB],
          [latA, alongB],
        ] as Array<[number, number]>
      ).map(([lateral, along]) => {
        const [lng, lat] = latAlongToLonLat(f, lateral, along)
        return [lat, lng] as [number, number]
      })

    /** A hole straddling the middle of the field: every band through it loses its centre. */
    const CROSSING = holeRing(-30, 30, -40, 40)
    /** A hole that covers the whole along-extent of pass 0's first band: swallows it. */
    const SWALLOWING = holeRing(BAND_LO - 0.2, BAND_HI + 0.2, -450, 450)

    const totalArea = (fc: { features: Feature<Polygon>[] }) =>
      fc.features.reduce((a, x) => a + turfArea(x), 0)
    const passesOf = (fc: { features: Feature<Polygon>[] }, pass: number) =>
      fc.features.filter((x) => (x.properties as { pass: number }).pass === pass)

    const BASE = maleBayBands(FIELD)

    // THE regression guard: a field with no inner rings must be untouched.
    it('does no clipping — and changes nothing — without inner rings', () => {
      expect(maleBayBands({ ...FIELD, boundary_inner: [] })).toEqual(BASE)
      expect(maleBayBands({ ...FIELD, access_road_boundary: [] })).toEqual(BASE)
      expect(
        maleBayBands({ ...FIELD, boundary_inner: [], access_road_boundary: [] }),
      ).toEqual(BASE)
      // byte-identical, not merely deep-equal
      expect(JSON.stringify(maleBayBands({ ...FIELD, boundary_inner: [] }))).toBe(
        JSON.stringify(BASE),
      )
    })

    it('cuts the covered part out of a band that crosses an inner ring', () => {
      const clipped = maleBayBands({ ...FIELD, boundary_inner: [CROSSING] })
      const hit = latAlongToLonLat(f, BAND_MID, 0) // dead centre of the hole, on a band

      expect(BASE.features.some((x) => booleanPointInPolygon(hit, x))).toBe(true)
      expect(clipped.features.some((x) => booleanPointInPolygon(hit, x))).toBe(false)

      // Bands split in two, so there are MORE features covering LESS ground.
      expect(clipped.features.length).toBeGreaterThan(BASE.features.length)
      expect(totalArea(clipped)).toBeLessThan(totalArea(BASE))
      expect(totalArea(clipped)).toBeGreaterThan(0)
      for (const feat of clipped.features) {
        expect(allFinite(feat.geometry.coordinates[0])).toBe(true)
      }
    })

    it('clips against the access road as well as interior boundaries', () => {
      const viaAccess = maleBayBands({ ...FIELD, access_road_boundary: [CROSSING] })
      const viaInner = maleBayBands({ ...FIELD, boundary_inner: [CROSSING] })
      expect(totalArea(viaAccess)).toBeCloseTo(totalArea(viaInner), 6)
      expect(totalArea(viaAccess)).toBeLessThan(totalArea(BASE))
      // Both lists at once still clips (union of the two).
      const both = maleBayBands({
        ...FIELD,
        boundary_inner: [CROSSING],
        access_road_boundary: [SWALLOWING],
      })
      expect(totalArea(both)).toBeLessThan(totalArea(viaInner))
    })

    it('a band swallowed by a hole disappears entirely', () => {
      expect(passesOf(BASE, 0)).toHaveLength(2) // two male runs per pass
      const clipped = maleBayBands({ ...FIELD, boundary_inner: [SWALLOWING] })
      const left = passesOf(clipped, 0)
      expect(left).toHaveLength(1)
      // The survivor is the OTHER run (rows 14–15), not the swallowed one.
      const lateral = left[0].geometry.coordinates[0]
        .slice(0, 4)
        .map((c) => toLateral(f, c))
      expect(Math.min(...lateral)).toBeGreaterThan(BAND_HI)
    })

    it('keeps kind + pass on every piece a split band becomes', () => {
      const clipped = maleBayBands({ ...FIELD, boundary_inner: [CROSSING] })
      for (const feat of clipped.features) {
        expect(feat.properties).toMatchObject({ kind: 'male_bay' })
        expect(Number.isInteger((feat.properties as { pass: number }).pass)).toBe(true)
      }
      // Pass 0's two bands both straddle the hole ⇒ 4 pieces, all labelled pass 0.
      const p0 = passesOf(clipped, 0)
      expect(p0.length).toBeGreaterThan(passesOf(BASE, 0).length)
      for (const feat of p0) {
        expect(feat.properties).toEqual({ kind: 'male_bay', pass: 0 })
      }
      // Every pass that existed before still exists after (nothing loses its label).
      const before = new Set(BASE.features.map((x) => (x.properties as { pass: number }).pass))
      const after = new Set(clipped.features.map((x) => (x.properties as { pass: number }).pass))
      expect([...before].every((p) => after.has(p))).toBe(true)
    })

    it('bays_through_inner runs the bands straight through', () => {
      for (const on of [true, 'true', 'True', 'yes', 1]) {
        expect(
          maleBayBands({ ...FIELD, boundary_inner: [CROSSING], bays_through_inner: on }),
        ).toEqual(BASE)
      }
      // …and an explicit false (or a blank) still clips.
      for (const off of [false, 'false', '', undefined]) {
        const clipped = maleBayBands({
          ...FIELD,
          boundary_inner: [CROSSING],
          bays_through_inner: off,
        })
        expect(totalArea(clipped)).toBeLessThan(totalArea(BASE))
      }
    })

    it('ignores malformed inner rings instead of throwing', () => {
      const junk = {
        ...FIELD,
        boundary_inner: [
          [
            [49.83, -111.6],
            [49.84, -111.6],
          ], // only 2 points
          [
            ['a', 'b'],
            [49.83, -111.6],
            [49.84, -111.59],
            [49.84, -111.6],
          ], // non-numeric corner
          [], // empty
          'not a ring',
          null,
        ],
        access_road_boundary: [[[49.83, -111.6]], undefined],
      }
      expect(() => maleBayBands(junk)).not.toThrow()
      expect(maleBayBands(junk)).toEqual(BASE)

      // A good ring alongside the junk still clips.
      const mixed = maleBayBands({ ...junk, access_road_boundary: [null, CROSSING] })
      expect(totalArea(mixed)).toBeLessThan(totalArea(BASE))
    })

    it('is deterministic once clipped', () => {
      const field = { ...FIELD, boundary_inner: [CROSSING] }
      expect(JSON.stringify(maleBayBands(field))).toBe(JSON.stringify(maleBayBands(field)))
    })
  })
})

describe('planterPassLines', () => {
  it('emits two-point lines spanning the field', () => {
    const fc = planterPassLines(FIELD)
    expect(fc.features.length).toBeGreaterThan(0)
    for (const feat of fc.features) {
      expect(feat.geometry.type).toBe('LineString')
      expect(feat.geometry.coordinates).toHaveLength(2)
      expect(allFinite(feat.geometry.coordinates)).toBe(true)
      expect(feat.properties).toMatchObject({ kind: 'planter_pass' })
    }
  })

  const numbers = (field: FieldDict) =>
    planterPassLines(field).features.map((f) => (f.properties as { number: number }).number)

  it('numbers west +, east −, with no duplicates', () => {
    const ns = numbers(FIELD)
    expect(new Set(ns).size).toBe(ns.length)
    const f = fieldFrame(FIELD)!
    const feats = planterPassLines(FIELD).features
    for (const feat of feats) {
      const n = (feat.properties as { number: number }).number
      const lateral = toLateral(f, feat.geometry.coordinates[0])
      if (n > 0) expect(lateral).toBeLessThan(1e-6) // west of the pivot
      if (n < 0) expect(lateral).toBeGreaterThan(-1e-6) // east of the pivot
    }
  })

  it('is symmetric around the pivot, and skips #0 when the pivot sits on a boundary', () => {
    const ns = numbers(FIELD)
    expect(ns).not.toContain(0) // no shift → pivot is exactly on a pass boundary
    for (const n of ns) expect(ns).toContain(-n)
  })

  it('gives the pivot pass #0 when the pivot is ≥5 ft inside it', () => {
    const f = fieldFrame(FIELD)!
    // Planting angle 0 → lateral = east; shift the bays half a pass west so the
    // pivot lands dead centre of a pass.
    const shifted = { ...FIELD, bay_shift_e_m: String(-f.passW / 2) }
    const ns = numbers(shifted)
    expect(ns).toContain(0)
    expect(new Set(ns).size).toBe(ns.length)
    for (const n of ns) expect(ns).toContain(-n)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(planterPassLines(FIELD))).toBe(JSON.stringify(planterPassLines(FIELD)))
  })

  it('is empty for degenerate input, never throws', () => {
    expect(planterPassLines({}).features).toHaveLength(0)
    expect(planterPassLines({ ...FIELD, PP_Longitude: 'n/a' }).features).toHaveLength(0)
    expect(planterPassLines({ ...FIELD, use_bays: false }).features).toHaveLength(0)
    expect(planterPassLines({ ...FIELD, row_spacing_in: '0' }).features).toHaveLength(0)
  })
})

describe('alignmentLines', () => {
  const f = fieldFrame(FIELD)!
  /** Build pins on a (lateral, along) grid, optionally staggering odd columns. */
  const grid = (stagger = 0) => {
    const pins: Array<{ lat: number; lng: number }> = []
    ;[-40.5, 0, 40.5].forEach((lateral, i) => {
      for (const along of [-100, 0, 100]) {
        const [lng, lat] = latAlongToLonLat(f, lateral, along + (i % 2 ? stagger : 0))
        pins.push({ lat, lng })
      }
    })
    return pins
  }

  it('needs at least 3 pins', () => {
    expect(alignmentLines([], FIELD).features).toHaveLength(0)
    expect(alignmentLines(grid().slice(0, 2), FIELD).features).toHaveLength(0)
  })

  /** Features of one family. Axis is explicit so this need not count vertices. */
  const axis = (fc: ReturnType<typeof alignmentLines>, want: string) =>
    fc.features.filter((x) => x.properties?.axis === want)

  it('draws a row line per rank, and no column lines at all', () => {
    const fc = alignmentLines(grid(), FIELD)
    const feats = fc.features
    expect(feats.length).toBeGreaterThan(0)
    for (const feat of feats) {
      expect(feat.geometry.type).toBe('LineString')
      expect(allFinite(feat.geometry.coordinates)).toBe(true)
      expect(feat.properties?.kind).toBe('alignment')
      expect(['row', 'diagonal']).toContain(feat.properties?.axis)
    }
    // A column runs the way the planter does, so the crop rows already are that
    // guide — drawing one on top of them adds nothing.
    expect(axis(fc, 'column')).toHaveLength(0)
    expect(axis(fc, 'row')).toHaveLength(3) // one across each rank
    // On an UNSTAGGERED grid the neighbour level with a pin lies on that pin's
    // row, so every diagonal is collinear with a row line and collapses into
    // it. Drawing the same line twice under two labels would be a bug.
    expect(axis(fc, 'diagonal')).toHaveLength(0)
  })

  it('draws each guide as one straight line, not a path through the pins', () => {
    // The point of the change: a guide is a line, so it has two ends and no
    // kinks. A polyline visiting pins would have as many vertices as pins and
    // would bend at each one.
    for (const feat of alignmentLines(grid(50), FIELD).features) {
      expect(feat.geometry.coordinates).toHaveLength(2)
    }
  })

  it('carries a guide THROUGH a gap in the shelters', () => {
    // Three columns with the middle one missing entirely. The row guides must
    // still run the full width, so shelters either side of the gap can be put
    // on the same line as each other.
    const pins: Array<{ lat: number; lng: number }> = []
    for (const lateral of [-40.5, 40.5]) {
      for (const along of [-100, 0, 100]) {
        const [lng, lat] = latAlongToLonLat(f, lateral, along)
        pins.push({ lat, lng })
      }
    }
    const fc = alignmentLines(pins, FIELD)
    const rows = axis(fc, 'row')
    expect(rows).toHaveLength(3)
    // Each row spans far more than the 81 m between the two occupied columns —
    // it reaches the field extent, which is 800 m across for this pivot.
    for (const r of rows) {
      const span = Math.abs(toLateral(f, r.geometry.coordinates[1]) - toLateral(f, r.geometry.coordinates[0]))
      expect(span).toBeGreaterThan(700)
    }
  })

  it('reaches past the outermost shelter', () => {
    // So the NEXT shelter placed has a line to go on.
    const fc = alignmentLines(grid(), FIELD)
    const row = axis(fc, 'row')[0]
    const laterals = row.geometry.coordinates.map((c) => toLateral(f, c))
    // The pins only reach ±40.5 m; the guide runs the full extent.
    expect(Math.max(...laterals)).toBeGreaterThan(300)
    expect(Math.min(...laterals)).toBeLessThan(-300)
  })

  it('runs each row across the columns, not back on itself', () => {
    // A row polyline must visit its pins in lateral order; sorted by the wrong
    // axis it would zig-zag and be useless to sight along.
    const fc = alignmentLines(grid(), FIELD)
    for (const row of axis(fc, 'row')) {
      const laterals = row.geometry.coordinates.map((c) => toLateral(f, c))
      for (let i = 1; i < laterals.length; i++) {
        expect(laterals[i]).toBeGreaterThan(laterals[i - 1])
      }
    }
  })

  it('links only the pins that are genuinely level when staggered', () => {
    // Columns 0 and 2 sit at along −100/0/100 and column 1 at −50/50/150. Each
    // rank therefore holds the two unstaggered columns, and the offset column's
    // pins are level with nothing. A line through pins that are NOT level would
    // be a worse guide than no line.
    const fc = alignmentLines(grid(50), FIELD)
    const rows = axis(fc, 'row')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.geometry.coordinates).toHaveLength(2)
  })

  it('makes real diagonals when the columns are staggered', () => {
    const fc = alignmentLines(grid(50), FIELD)
    const links = axis(fc, 'diagonal')
    // Staggering means the neighbour above/below is no longer level, so these
    // are genuine diagonals rather than rows in disguise.
    expect(links.length).toBeGreaterThan(0)
    expect(allFinite(links.flatMap((l) => l.geometry.coordinates))).toBe(true)
    for (const l of links) {
      const [a, b] = l.geometry.coordinates
      const dLat = toLateral(f, b) - toLateral(f, a)
      const dAlong = toAlong(f, b) - toAlong(f, a)
      // A real slope in both axes — not a row (dAlong 0) or a column (dLat 0).
      expect(Math.abs(dLat)).toBeGreaterThan(1)
      expect(Math.abs(dAlong)).toBeGreaterThan(1)
    }
  })

  it('draws a diagonal that runs through many pins only once', () => {
    // Six pins on one diagonal used to emit five overlapping segments.
    const fc = alignmentLines(grid(50), FIELD)
    const keys = axis(fc, 'diagonal').map((l) =>
      l.geometry.coordinates.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)}`).join('|'),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('emits nothing for a single column of pins', () => {
    // One pin per rank is not a row, and a column is not drawn at all — so a
    // line of shelters running the planter's way yields no guides. Guards
    // against a degenerate 1-point LineString reaching the map.
    const single: Array<{ lat: number; lng: number }> = [-100, 0, 100].map((along) => {
      const [lng, lat] = latAlongToLonLat(f, 0, along)
      return { lat, lng }
    })
    const fc = alignmentLines(single, FIELD)
    expect(axis(fc, 'column')).toHaveLength(0)
    expect(axis(fc, 'row')).toHaveLength(0)
  })

  it('is empty without a pivot and ignores non-finite pins', () => {
    expect(alignmentLines(grid(), { PP_Latitude: 'n/a' }).features).toHaveLength(0)
    const bad = [
      { lat: NaN, lng: NaN },
      { lat: 49.83, lng: NaN },
      { lat: NaN, lng: -111.6 },
    ]
    expect(alignmentLines(bad, FIELD).features).toHaveLength(0)
  })

  it('is deterministic', () => {
    const pins = grid(50)
    expect(JSON.stringify(alignmentLines(pins, FIELD))).toBe(
      JSON.stringify(alignmentLines(pins, FIELD)),
    )
  })
})

describe('alignmentLines — one line per diagonal strip', () => {
  const f = fieldFrame(FIELD)!

  /** A staggered grid: `cols` columns × `rows` ranks, odd columns offset. */
  const staggered = (cols: number, rows: number) => {
    const pins: Array<{ lat: number; lng: number }> = []
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const [lng, lat] = latAlongToLonLat(f, c * 40, r * 60 + (c % 2 ? 30 : 0))
        pins.push({ lat, lng })
      }
    }
    return pins
  }

  const axisOf = (pins: Array<{ lat: number; lng: number }>, want: string) =>
    alignmentLines(pins, FIELD).features.filter((x) => x.properties?.axis === want)

  it('draws far fewer diagonals than there are shelters', () => {
    // The fan: every adjacent PAIR used to give its own extended line, so a
    // staggered grid produced roughly two per pin, all near-parallel and
    // crossing at every shelter. A strip is a line, not a pair.
    const pins = staggered(8, 5)
    const diagonals = axisOf(pins, 'diagonal')
    expect(diagonals.length).toBeGreaterThan(0)
    expect(diagonals.length).toBeLessThan(pins.length)
  })

  it('gives one line per strip, not one per pair along it', () => {
    // Six columns of a staggered grid share a handful of long diagonals. If the
    // count scaled with the pins, the strips were not being merged.
    const small = axisOf(staggered(4, 4), 'diagonal').length
    const big = axisOf(staggered(8, 4), 'diagonal').length
    // Doubling the columns must not double the lines through them — the strips
    // get LONGER, they do not multiply.
    expect(big).toBeLessThan(small * 2)
  })

  it('emits no two diagonals that lie on top of each other', () => {
    const diagonals = axisOf(staggered(8, 5), 'diagonal')
    const keys = diagonals.map((l) =>
      l.geometry.coordinates.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join('|'),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('still runs each diagonal at a real slope', () => {
    for (const l of axisOf(staggered(6, 4), 'diagonal')) {
      const [a, b] = l.geometry.coordinates
      expect(Math.abs(toLateral(f, b) - toLateral(f, a))).toBeGreaterThan(1)
      expect(Math.abs(toAlong(f, b) - toAlong(f, a))).toBeGreaterThan(1)
    }
  })
})

describe('alignmentLines — never two lines where one belongs', () => {
  const f = fieldFrame(FIELD)!

  /** A staggered grid, optionally jittered to mimic a real placement. */
  const grid2 = (cols: number, rows: number, dx: number, dy: number, jitter = 0) => {
    // Deterministic pseudo-jitter: a real field's pins are not on a perfect
    // lattice (bay gaps, snake passes, boundary clipping), and it is that
    // irregularity that used to split one strip into two lines.
    let seed = 1
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return (seed / 2147483648 - 0.5) * 2
    }
    const pins: Array<{ lat: number; lng: number }> = []
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const lateral = (c - cols / 2) * dx + rnd() * jitter
        const along = (r - rows / 2) * dy + (c % 2 ? dy / 2 : 0) + rnd() * jitter
        const [lng, lat] = latAlongToLonLat(f, lateral, along)
        pins.push({ lat, lng })
      }
    }
    return pins
  }

  /** The closest pair of near-parallel guides, in metres. Infinity if none. */
  const closestParallelGap = (pins: Array<{ lat: number; lng: number }>) => {
    const lines = alignmentLines(pins, FIELD).features.map((x) => {
      const [a, b] = x.geometry.coordinates
      const ax = toLateral(f, a)
      const ay = toAlong(f, a)
      const ux = toLateral(f, b) - ax
      const uy = toAlong(f, b) - ay
      const len = Math.hypot(ux, uy) || 1
      return { ax, ay, dx: ux / len, dy: uy / len }
    })
    let worst = Infinity
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const A = lines[i]
        const B = lines[j]
        // Only pairs that LOOK parallel can look doubled.
        if (Math.abs(A.dx * B.dx + A.dy * B.dy) < Math.cos((3 * Math.PI) / 180)) continue
        const gap = Math.abs((B.ax - A.ax) * A.dy - (B.ay - A.ay) * A.dx)
        if (gap < worst) worst = gap
      }
    }
    return worst
  }

  it.each([
    ['regular 20×8', 20, 8, 40, 60, 0],
    ['regular 30×10', 30, 10, 25, 40, 0],
    ['jittered 20×8', 20, 8, 40, 60, 1.5],
    ['jittered 30×10', 30, 10, 25, 40, 2.5],
  ])('%s: no two guides sit on top of each other', (_name, cols, rows, dx, dy, jitter) => {
    const pins = grid2(cols as number, rows as number, dx as number, dy as number, jitter as number)
    expect(alignmentLines(pins, FIELD).features.length).toBeGreaterThan(0)
    // 3 m is the merge threshold. Anything closer than that is the double line
    // the crew was complaining about.
    expect(closestParallelGap(pins)).toBeGreaterThan(3)
  })

  it('merges a strip that irregular spacing split in two', () => {
    // Pins on ONE diagonal, but drifting slightly off it — the exact shape that
    // pushed a long strip across a bucket edge and produced two lines a metre
    // apart. One line, positioned between them, is the wanted answer.
    const pins: Array<{ lat: number; lng: number }> = []
    for (let i = 0; i < 12; i++) {
      const [lng, lat] = latAlongToLonLat(f, i * 30 - 180, i * 45 - 270 + (i > 5 ? 1.2 : -1.2))
      pins.push({ lat, lng })
    }
    const diagonals = alignmentLines(pins, FIELD).features.filter(
      (x) => x.properties?.axis === 'diagonal',
    )
    expect(diagonals.length).toBeLessThanOrEqual(1)
  })
})
