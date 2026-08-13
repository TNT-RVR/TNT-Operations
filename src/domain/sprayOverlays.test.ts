import { describe, it, expect } from 'vitest'
import type { Feature, LineString, Position } from 'geojson'
import { booleanPointInPolygon } from '@turf/turf'
import { latlonListToEnu } from './geo'
import { enuToLonLat, fieldFrame, pointInEnuRing } from './fieldFrame'
import {
  sprayerPassLines,
  outerSprayerLimit,
  tireAndEdgeZones,
  shelterBufferSquares,
} from './sprayOverlays'
import type { FieldDict } from './tentGrid'

const PIVOT_LAT = 49.83
const PIVOT_LON = -111.6
const FT_TO_M = 0.3048
const SPRAYER_W_M = 133 * FT_TO_M // 40.5384 m

/** A realistic pivot field: 400 m radius, 133 ft boom, planting due N–S. */
const FIELD: FieldDict = {
  PP_Latitude: String(PIVOT_LAT),
  PP_Longitude: String(PIVOT_LON),
  Radius: '400',
  Sprayer_width: '133',
  Planting_angle: '0',
}

// A ~600 m square boundary about the pivot, stored [lat, lon] like the old app.
const HALF_M = 300
const DLAT = HALF_M / 111_320
const DLON = HALF_M / (111_320 * Math.cos((PIVOT_LAT * Math.PI) / 180))
const SQUARE_FIELD: FieldDict = {
  ...FIELD,
  boundary_polygon: [
    [PIVOT_LAT - DLAT, PIVOT_LON - DLON],
    [PIVOT_LAT - DLAT, PIVOT_LON + DLON],
    [PIVOT_LAT + DLAT, PIVOT_LON + DLON],
    [PIVOT_LAT + DLAT, PIVOT_LON - DLON],
  ],
}

// ── helpers: measure the generated GeoJSON back in ENU metres ────────────────

/** GeoJSON [lon,lat] → ENU metres about the pivot (the frame's own projection). */
const toEnu = (p: Position): [number, number] =>
  latlonListToEnu([[p[1], p[0]]], PIVOT_LON, PIVOT_LAT)[0]

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

const finite = (coords: Position[]) =>
  coords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))

/**
 * A band's width, measured across the spray direction.
 *
 * The old measure was `dist(ring[0], ring[1])` — the first edge of a 4-corner
 * rectangle. Interior bands are now clipped to the perimeter pass, so they are
 * no longer rectangles and the corner order means nothing. Projecting every
 * vertex onto the lateral axis and taking the extent measures the same quantity
 * without caring what shape the clip left behind.
 */
function lateralWidth(ring: Position[], sprayAngleDeg = 0): number {
  // The lateral axis is perpendicular to the spray heading. `fieldFrame` builds
  // its rotation as ((0 - angle + 180) mod 360) - 180; the unit lateral vector
  // follows from that same angle.
  const rot = (((0 - sprayAngleDeg + 180) % 360) - 180) * (Math.PI / 180)
  const ux = Math.cos(rot)
  const uy = -Math.sin(rot)
  const proj = ring.map((p) => {
    const [e, n] = toEnu(p)
    return e * ux + n * uy
  })
  return Math.max(...proj) - Math.min(...proj)
}

/** Interior (numbered-pass) bands only — the perimeter ones are ring-shaped. */
const interior = <T extends { properties: Record<string, unknown> | null }>(fs: T[]) =>
  fs.filter((f) => !f.properties?.perimeter)

/** The perimeter pass's own bands. */
const perimeter = <T extends { properties: Record<string, unknown> | null }>(fs: T[]) =>
  fs.filter((f) => f.properties?.perimeter)

/** Perpendicular distance (m) from line B's start to the infinite line through A. */
function perpGap(lineA: Position[], lineB: Position[]): number {
  const a0 = toEnu(lineA[0])
  const a1 = toEnu(lineA[1])
  const b0 = toEnu(lineB[0])
  const dx = a1[0] - a0[0]
  const dy = a1[1] - a0[1]
  return Math.abs((b0[0] - a0[0]) * dy - (b0[1] - a0[1]) * dx) / Math.hypot(dx, dy)
}

/** Bearing (deg) of a line's direction in ENU, normalised to [0, 180). */
function bearing(line: Position[]): number {
  const a = toEnu(line[0])
  const b = toEnu(line[1])
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
  return ((deg % 180) + 180) % 180
}

/** Absolute shoelace area (m²) of a [lon,lat] ring. */
function ringAreaM2(ring: Position[]): number {
  const enu = ring.map(toEnu)
  let a = 0
  for (let i = 0, j = enu.length - 1; i < enu.length; j = i++) {
    a += enu[j][0] * enu[i][1] - enu[i][0] * enu[j][1]
  }
  return Math.abs(a) / 2
}

// ─────────────────────────────────────────────────────────────────────────────

describe('sprayerPassLines', () => {
  it('draws pass centre lines one sprayer width apart, spanning the field', () => {
    const fc = sprayerPassLines(FIELD)
    expect(fc.features.length).toBeGreaterThan(0)
    // 800 m of extent at 40.54 m spacing ⇒ ~20 passes.
    expect(fc.features.length).toBeGreaterThanOrEqual(19)

    for (const f of fc.features) {
      expect(f.geometry.type).toBe('LineString')
      expect(f.geometry.coordinates).toHaveLength(2)
      expect(finite(f.geometry.coordinates)).toBe(true)
      expect(f.properties?.kind).toBe('sprayer_pass')
      expect(Number.isFinite(f.properties?.index)).toBe(true)
      // Each pass spans the full 800 m extent.
      const len = dist(toEnu(f.geometry.coordinates[0]), toEnu(f.geometry.coordinates[1]))
      expect(len).toBeCloseTo(800, 1)
    }

    for (let i = 1; i < fc.features.length; i++) {
      const gap = perpGap(fc.features[i - 1].geometry.coordinates, fc.features[i].geometry.coordinates)
      expect(gap).toBeCloseTo(SPRAYER_W_M, 2)
    }
  })

  it('indexes passes so pass k spans lateral [k·W, (k+1)·W]', () => {
    const idx = sprayerPassLines(FIELD).features.map((f) => Number(f.properties?.index))
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBe(idx[i - 1] + 1)
    expect(idx).toContain(0)
  })

  it('follows the SPRAY angle, not the planting angle', () => {
    // Same planting angle, different spray angle ⇒ the passes must turn 90°.
    const along = sprayerPassLines({ ...FIELD, Spray_angle: '0' })
    const across = sprayerPassLines({ ...FIELD, Spray_angle: '90' })
    expect(along.features.length).toBeGreaterThan(0)
    expect(across.features.length).toBeGreaterThan(0)

    const b0 = bearing(along.features[0].geometry.coordinates)
    const b90 = bearing(across.features[0].geometry.coordinates)
    let diff = Math.abs(b0 - b90)
    if (diff > 90) diff = 180 - diff
    expect(diff).toBeCloseTo(90, 1)
  })

  it('falls back to the planting angle when Spray_angle is blank', () => {
    const blank = sprayerPassLines({ ...FIELD, Planting_angle: '30', Spray_angle: '' })
    const explicit = sprayerPassLines({ ...FIELD, Planting_angle: '30', Spray_angle: '30' })
    expect(bearing(blank.features[0].geometry.coordinates)).toBeCloseTo(
      bearing(explicit.features[0].geometry.coordinates),
      6,
    )
  })

  it('is empty without a pivot or with a zero sprayer width', () => {
    expect(sprayerPassLines({ Radius: '400' }).features).toHaveLength(0)
    expect(sprayerPassLines({ ...FIELD, Sprayer_width: '0' }).features).toHaveLength(0)
    expect(sprayerPassLines({}).features).toHaveLength(0)
  })

  // ── spec §6.3 "Toggle Pass Through Inner" (`sprayer_routes_around_inner`, on) ──
  describe('inner-boundary clipping', () => {
    const frame = fieldFrame(FIELD)!
    // Spray angle 0 ⇒ spray lateral = ENU east, spray along = ENU north.
    const PASS0_E = 0.5 * SPRAYER_W_M // 20.2692 m — the centre line of pass 0
    const HOLE_N = 50 // the crossing hole reaches ±50 m north

    /** An inner ring over the ENU box [eA,eB] × [nA,nB], stored [lat,lon]. */
    const holeRing = (
      eA: number,
      eB: number,
      nA: number,
      nB: number,
    ): Array<[number, number]> =>
      (
        [
          [eA, nA],
          [eB, nA],
          [eB, nB],
          [eA, nB],
        ] as Array<[number, number]>
      ).map(([e, n]) => {
        const [lng, lat] = enuToLonLat(frame, e, n)
        return [lat, lng] as [number, number]
      })

    /** Straddles pass 0's centre line halfway down: the line must break around it. */
    const CROSSING = holeRing(PASS0_E - 10, PASS0_E + 10, -HOLE_N, HOLE_N)
    /** Same lateral window, but the full along-extent: pass 0 vanishes. */
    const SWALLOWING = holeRing(PASS0_E - 10, PASS0_E + 10, -450, 450)

    const withIndex = (fc: { features: Feature<LineString>[] }, index: number) =>
      fc.features.filter((x) => Number(x.properties?.index) === index)
    const totalLength = (fc: { features: Feature<LineString>[] }) =>
      fc.features.reduce((sum, x) => {
        const c = x.geometry.coordinates
        let d = 0
        for (let i = 1; i < c.length; i++) d += dist(toEnu(c[i - 1]), toEnu(c[i]))
        return sum + d
      }, 0)

    const BASE = sprayerPassLines(FIELD)

    // THE regression guard: a field with no inner rings must be untouched.
    it('does no clipping — and changes nothing — without inner rings', () => {
      expect(sprayerPassLines({ ...FIELD, boundary_inner: [] })).toEqual(BASE)
      expect(sprayerPassLines({ ...FIELD, access_road_boundary: [] })).toEqual(BASE)
      expect(
        sprayerPassLines({ ...FIELD, boundary_inner: [], access_road_boundary: [] }),
      ).toEqual(BASE)
      // byte-identical, not merely deep-equal
      expect(JSON.stringify(sprayerPassLines({ ...FIELD, boundary_inner: [] }))).toBe(
        JSON.stringify(BASE),
      )
    })

    it('breaks a pass line where it crosses an inner ring', () => {
      const clipped = sprayerPassLines({ ...FIELD, boundary_inner: [CROSSING] })
      expect(withIndex(BASE, 0)).toHaveLength(1)

      const p0 = withIndex(clipped, 0)
      expect(p0).toHaveLength(2) // one segment either side of the hole

      // Nothing survives INSIDE the hole: every endpoint clears it along-pass.
      for (const seg of p0) {
        expect(finite(seg.geometry.coordinates)).toBe(true)
        for (const c of seg.geometry.coordinates) {
          const [, n] = toEnu(c)
          expect(Math.abs(n)).toBeGreaterThan(HOLE_N - 0.5)
        }
      }
      // One segment north of the hole, one south.
      const sides = p0.map((s) => Math.sign(toEnu(s.geometry.coordinates[0])[1]))
      expect(new Set(sides).size).toBe(2)

      // More features, less total line — and the missing length is the hole.
      expect(clipped.features.length).toBe(BASE.features.length + 1)
      expect(totalLength(clipped)).toBeLessThan(totalLength(BASE))
      expect(totalLength(BASE) - totalLength(clipped)).toBeCloseTo(2 * HOLE_N, 0)

      // Every other pass is untouched.
      expect(withIndex(clipped, 1)).toEqual(withIndex(BASE, 1))
      expect(withIndex(clipped, -1)).toEqual(withIndex(BASE, -1))
    })

    it('breaks around the access road as well as interior boundaries', () => {
      const viaAccess = sprayerPassLines({ ...FIELD, access_road_boundary: [CROSSING] })
      const viaInner = sprayerPassLines({ ...FIELD, boundary_inner: [CROSSING] })
      expect(viaAccess).toEqual(viaInner)
      // Both lists at once unions the rings.
      const both = sprayerPassLines({
        ...FIELD,
        boundary_inner: [CROSSING],
        access_road_boundary: [holeRing(-PASS0_E - 10, -PASS0_E + 10, -HOLE_N, HOLE_N)],
      })
      expect(withIndex(both, 0)).toHaveLength(2)
      expect(withIndex(both, -1)).toHaveLength(2)
    })

    it('a pass line wholly inside a hole disappears entirely', () => {
      const clipped = sprayerPassLines({ ...FIELD, boundary_inner: [SWALLOWING] })
      expect(withIndex(clipped, 0)).toHaveLength(0)
      expect(clipped.features.length).toBe(BASE.features.length - 1)
      // Its neighbours are untouched.
      expect(withIndex(clipped, 1)).toEqual(withIndex(BASE, 1))
      expect(withIndex(clipped, -1)).toEqual(withIndex(BASE, -1))
    })

    it('keeps kind + index on every segment a broken line becomes', () => {
      const clipped = sprayerPassLines({ ...FIELD, boundary_inner: [CROSSING] })
      for (const feat of clipped.features) {
        expect(feat.properties?.kind).toBe('sprayer_pass')
        expect(Number.isInteger(feat.properties?.index)).toBe(true)
      }
      for (const seg of withIndex(clipped, 0)) {
        expect(seg.properties).toEqual({ kind: 'sprayer_pass', index: 0 })
      }
      // No index is lost by the break.
      const before = new Set(BASE.features.map((x) => Number(x.properties?.index)))
      const after = new Set(clipped.features.map((x) => Number(x.properties?.index)))
      expect([...before].every((i) => after.has(i))).toBe(true)
    })

    it('sprayer_routes_around_inner=false runs the lines straight through', () => {
      for (const off of [false, 'false', 'False', 'no', 0]) {
        expect(
          sprayerPassLines({
            ...FIELD,
            boundary_inner: [CROSSING],
            sprayer_routes_around_inner: off,
          }),
        ).toEqual(BASE)
      }
      // Absent, blank or explicitly true ⇒ the default (break) applies.
      for (const on of [undefined, '', true, 'true']) {
        const clipped = sprayerPassLines({
          ...FIELD,
          boundary_inner: [CROSSING],
          sprayer_routes_around_inner: on,
        })
        expect(withIndex(clipped, 0)).toHaveLength(2)
      }
    })

    it('ignores malformed inner rings instead of throwing', () => {
      const junk = {
        ...FIELD,
        boundary_inner: [
          [
            [PIVOT_LAT, PIVOT_LON],
            [PIVOT_LAT + 0.001, PIVOT_LON],
          ], // only 2 points
          [
            ['x', 'y'],
            [PIVOT_LAT, PIVOT_LON],
            [PIVOT_LAT + 0.001, PIVOT_LON + 0.001],
            [PIVOT_LAT + 0.001, PIVOT_LON],
          ], // non-numeric corner
          [],
          'not a ring',
          null,
        ],
        access_road_boundary: [[[PIVOT_LAT, PIVOT_LON]], undefined],
      }
      expect(() => sprayerPassLines(junk)).not.toThrow()
      expect(sprayerPassLines(junk)).toEqual(BASE)

      // A good ring alongside the junk still breaks the line.
      const mixed = sprayerPassLines({ ...junk, access_road_boundary: [null, CROSSING] })
      expect(withIndex(mixed, 0)).toHaveLength(2)
    })

    it('is deterministic once clipped', () => {
      const field = { ...FIELD, boundary_inner: [CROSSING] }
      expect(JSON.stringify(sprayerPassLines(field))).toBe(
        JSON.stringify(sprayerPassLines(field)),
      )
    })
  })
})

describe('outerSprayerLimit', () => {
  it('insets the boundary by one sprayer width', () => {
    const fc = outerSprayerLimit(SQUARE_FIELD)
    expect(fc.features).toHaveLength(1)
    const f = fc.features[0]
    expect(f.properties?.kind).toBe('sprayer_limit')

    const ring = f.geometry.coordinates[0]
    expect(finite(ring)).toBe(true)
    expect(ring[0]).toEqual(ring[ring.length - 1]) // closed

    const frame = fieldFrame(SQUARE_FIELD)!
    const boundary = frame.boundaryEnu!
    const boundaryRing: Position[] = (SQUARE_FIELD.boundary_polygon as Array<[number, number]>).map(
      ([lat, lon]) => [lon, lat],
    )

    // Strictly smaller than the boundary…
    expect(ringAreaM2(ring)).toBeLessThan(ringAreaM2(boundaryRing))
    // …and every vertex lies inside the original boundary.
    for (const p of ring) {
      const [e, n] = toEnu(p)
      expect(pointInEnuRing(boundary, e, n)).toBe(true)
    }

    // Each side shrinks by exactly one sprayer width at both ends.
    const boundarySide = dist(boundary[0], boundary[1])
    const side = dist(toEnu(ring[0]), toEnu(ring[1]))
    expect(side).toBeCloseTo(boundarySide - 2 * SPRAYER_W_M, 1)
  })

  it('collapses to empty rather than inverting when the boundary is too small', () => {
    const d = 10 / 111_320 // a ~20 m square, far narrower than one sprayer width
    const dl = 10 / (111_320 * Math.cos((PIVOT_LAT * Math.PI) / 180))
    const tiny: FieldDict = {
      ...FIELD,
      boundary_polygon: [
        [PIVOT_LAT - d, PIVOT_LON - dl],
        [PIVOT_LAT - d, PIVOT_LON + dl],
        [PIVOT_LAT + d, PIVOT_LON + dl],
        [PIVOT_LAT + d, PIVOT_LON - dl],
      ],
    }
    expect(outerSprayerLimit(tiny).features).toHaveLength(0)
  })

  it('falls back to a (radius − sprayer width) circle for pivot-only fields', () => {
    const fc = outerSprayerLimit(FIELD)
    expect(fc.features).toHaveLength(1)
    const ring = fc.features[0].geometry.coordinates[0]
    expect(finite(ring)).toBe(true)
    expect(ring[0]).toEqual(ring[ring.length - 1])
    for (const p of ring) {
      const [e, n] = toEnu(p)
      expect(Math.hypot(e, n)).toBeCloseTo(400 - SPRAYER_W_M, 2)
    }
  })

  it('is empty when the pivot circle is narrower than the boom, or geometry is missing', () => {
    expect(outerSprayerLimit({ ...FIELD, Radius: '20' }).features).toHaveLength(0)
    expect(outerSprayerLimit({ ...FIELD, Sprayer_width: '0' }).features).toHaveLength(0)
    expect(outerSprayerLimit({}).features).toHaveLength(0)
  })
})

describe('tireAndEdgeZones', () => {
  it('bands the tire zone down the pass centre and the edge zone at the pass edge', () => {
    const { tire, edge } = tireAndEdgeZones(FIELD)
    const tireIn = interior(tire.features)
    const edgeIn = interior(edge.features)
    expect(tireIn.length).toBeGreaterThan(0)
    expect(edgeIn.length).toBeGreaterThan(0)
    // Unclipped there is one edge band per seam, so one more than the passes.
    // Clipping to the perimeter pass can only REMOVE bands, and it takes the
    // outermost edges first: an edge sits at k·W and a tire at (k+0.5)·W, so the
    // outer seams are the first geometry to fall inside the perimeter pass,
    // where that pass's own bands take over.
    expect(edgeIn.length).toBeLessThanOrEqual(tireIn.length + 1)

    for (const f of tireIn) {
      const ring = f.geometry.coordinates[0]
      expect(finite(ring)).toBe(true)
      expect(f.properties?.kind).toBe('tire')
      // Clipping to the perimeter pass can shorten a band but must never make
      // it wider than the wheels it represents.
      expect(lateralWidth(ring)).toBeLessThanOrEqual(14 * FT_TO_M + 0.01)
    }
    // The bands that cross the middle of the field are untouched by the clip,
    // so at least one still measures exactly a tire's width.
    expect(Math.max(...tireIn.map((f) => lateralWidth(f.geometry.coordinates[0])))).toBeCloseTo(
      14 * FT_TO_M,
      2,
    )

    for (const f of edgeIn) {
      expect(finite(f.geometry.coordinates[0])).toBe(true)
      expect(f.properties?.kind).toBe('edge')
      expect(lateralWidth(f.geometry.coordinates[0])).toBeLessThanOrEqual(25 * FT_TO_M + 0.01)
    }
  })

  it('honours custom tire / edge widths and drops a zero-width band', () => {
    const { tire, edge } = tireAndEdgeZones({
      ...FIELD,
      tire_width_ft: '20',
      pass_edge_buffer_ft: '0',
    })
    // Zero width turns the band off everywhere, perimeter included.
    expect(edge.features).toHaveLength(0)
    const widths = interior(tire.features).map((f) => lateralWidth(f.geometry.coordinates[0]))
    expect(Math.max(...widths)).toBeCloseTo(20 * FT_TO_M, 2)
  })

  it('runs the bands along the spray direction', () => {
    // Measured by width rather than by corner bearings, which the clip reorders:
    // a band is only its nominal width when measured across the spray heading it
    // was actually drawn at, and is far wider measured across any other.
    const at = (deg: string) =>
      interior(tireAndEdgeZones({ ...FIELD, Spray_angle: deg }).tire.features).map(
        (f) => f.geometry.coordinates[0],
      )

    const rings90 = at('90')
    expect(rings90.length).toBeGreaterThan(0)
    // Across 90° (the heading it was drawn at): a tire's width.
    expect(Math.max(...rings90.map((r) => lateralWidth(r, 90)))).toBeCloseTo(14 * FT_TO_M, 2)
    // Across 0°: the bands now run the other way, so they measure the field.
    expect(Math.max(...rings90.map((r) => lateralWidth(r, 0)))).toBeGreaterThan(100)

    const rings0 = at('0')
    expect(Math.max(...rings0.map((r) => lateralWidth(r, 0)))).toBeCloseTo(14 * FT_TO_M, 2)
    expect(Math.max(...rings0.map((r) => lateralWidth(r, 90)))).toBeGreaterThan(100)
  })

  it('is empty for degenerate geometry', () => {
    const none = tireAndEdgeZones({})
    expect(none.tire.features).toHaveLength(0)
    expect(none.edge.features).toHaveLength(0)
    const zero = tireAndEdgeZones({ ...FIELD, Sprayer_width: '0' })
    expect(zero.tire.features).toHaveLength(0)
    expect(zero.edge.features).toHaveLength(0)
  })
})

describe('shelterBufferSquares', () => {
  const shelters = [
    { lat: PIVOT_LAT, lng: PIVOT_LON },
    { lat: PIVOT_LAT + 0.001, lng: PIVOT_LON + 0.001 },
    { lat: PIVOT_LAT - 0.0012, lng: PIVOT_LON - 0.0009 },
  ]

  it('emits one closed 2×buffer square per shelter, numbered from 1', () => {
    const fc = shelterBufferSquares(shelters, FIELD)
    expect(fc.features).toHaveLength(3)
    fc.features.forEach((f, i) => {
      const ring = f.geometry.coordinates[0]
      expect(ring).toHaveLength(5)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      expect(finite(ring)).toBe(true)
      expect(f.properties?.kind).toBe('shelter_buffer')
      expect(f.properties?.shelter).toBe(i + 1)
      expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(2 * 1.524, 3)
      expect(dist(toEnu(ring[1]), toEnu(ring[2]))).toBeCloseTo(2 * 1.524, 3)
    })
  })

  it('honours a custom shelter_buffer_m', () => {
    const fc = shelterBufferSquares([shelters[0]], { ...FIELD, shelter_buffer_m: '3' })
    const ring = fc.features[0].geometry.coordinates[0]
    expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(6, 3)
  })

  it('aligns to the PLANTING frame, not to north', () => {
    // Planting 0° ⇒ rows run N–S: the along side bears 0°, the lateral side 90°.
    const square = (angle: string) =>
      shelterBufferSquares([shelters[0]], { ...FIELD, Planting_angle: angle }).features[0].geometry
        .coordinates[0]

    const north = square('0')
    expect(bearing([north[1], north[2]])).toBeCloseTo(0, 1) // along
    expect(bearing([north[0], north[1]])).toBeCloseTo(90, 1) // lateral

    // Turn the crop 45° and the whole square turns with it.
    const ring = square('45')
    expect(bearing([ring[1], ring[2]])).toBeCloseTo(45, 1)
    expect(bearing([ring[0], ring[1]])).toBeCloseTo(135, 1)
    // Still a square of the right size, just turned.
    expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(2 * 1.524, 3)
  })

  it('skips unusable shelters but keeps the numbering', () => {
    const fc = shelterBufferSquares(
      [shelters[0], { lat: NaN, lng: PIVOT_LON }, shelters[2]],
      FIELD,
    )
    expect(fc.features).toHaveLength(2)
    expect(fc.features.map((f) => f.properties?.shelter)).toEqual([1, 3])
  })

  it('is empty with no shelters, no pivot, or a zero buffer', () => {
    expect(shelterBufferSquares([], FIELD).features).toHaveLength(0)
    expect(shelterBufferSquares(shelters, {}).features).toHaveLength(0)
    expect(shelterBufferSquares(shelters, { ...FIELD, shelter_buffer_m: '0' }).features).toHaveLength(0)
  })
})

describe('the perimeter pass gets zones too', () => {
  it('emits a tire band and both edge seams for the outside lap', () => {
    const { tire, edge } = tireAndEdgeZones(FIELD)
    const pTire = perimeter(tire.features)
    const pEdge = perimeter(edge.features)
    expect(pTire).toHaveLength(1)
    // Both seams are present: one on the boundary, one on the outer limit. The
    // limit seam arrives in pieces — the interior wheel tracks cross it on
    // their way in and are cut out of it — so this is a set, not a count.
    expect(new Set(pEdge.map((f) => f.properties?.seam))).toEqual(new Set(['boundary', 'limit']))
    for (const f of [...pTire, ...pEdge]) {
      expect(f.properties?.index).toBeNull()
      expect(finite(f.geometry.coordinates[0])).toBe(true)
    }
  })

  it('draws them as rings, not rectangles', () => {
    // A lap around the field is an annulus: an outer ring with the middle of the
    // field punched out. A single-ring polygon would fill the whole field in.
    const { tire } = tireAndEdgeZones(FIELD)
    const band = perimeter(tire.features)[0]
    expect(band.geometry.coordinates.length).toBe(2)
  })

  it('puts the tire band a half sprayer width in, between the two seams', () => {
    // The lap runs from the boundary to one sprayer width in, so its wheels are
    // at the middle of that: inset W/2.
    const { tire } = tireAndEdgeZones(FIELD)
    const band = perimeter(tire.features)[0]
    const radii = band.geometry.coordinates[0].map((p) => {
      const [e, n] = toEnu(p)
      return Math.hypot(e, n)
    })
    // Outer edge of the tire band = radius − (W/2 − tireW/2).
    const expected = 400 - (SPRAYER_W_M / 2 - (14 * FT_TO_M) / 2)
    expect(Math.max(...radii)).toBeCloseTo(expected, 0)
  })

  it('works on a boundary field as well as a pivot', () => {
    const { tire, edge } = tireAndEdgeZones(SQUARE_FIELD)
    expect(perimeter(tire.features)).toHaveLength(1)
    const seams = perimeter(edge.features).map((f) => f.properties?.seam)
    expect(seams).toContain('boundary')
    expect(seams).toContain('limit')
  })

  it('turns off with the widths, like every other band', () => {
    const off = tireAndEdgeZones({ ...FIELD, tire_width_ft: '0', pass_edge_buffer_ft: '0' })
    expect(off.tire.features).toHaveLength(0)
    expect(off.edge.features).toHaveLength(0)
  })
})

describe('interior zones stop at the perimeter pass', () => {
  /** Distance from the pivot, for the circular test field. */
  const radiusOf = (p: Position) => {
    const [e, n] = toEnu(p)
    return Math.hypot(e, n)
  }

  it('keeps every interior EDGE band inside the outer sprayer limit', () => {
    const { edge } = tireAndEdgeZones(FIELD)
    const limit = 400 - SPRAYER_W_M // the outerSprayerLimit radius
    for (const f of interior(edge.features)) {
      for (const ring of f.geometry.coordinates) {
        for (const p of ring) {
          // A little slack for the 96-sided polygon approximating the circle.
          expect(radiusOf(p)).toBeLessThanOrEqual(limit + 1)
        }
      }
    }
  })

  it('carries the interior TIRE bands out to the perimeter wheel track', () => {
    // The sprayer drives in across the outside lap to start an interior pass,
    // so its wheels run over that ground. The track stops where it meets the
    // perimeter pass's own track and no further.
    const { tire } = tireAndEdgeZones(FIELD)
    const limit = 400 - SPRAYER_W_M
    const reach = 400 - (SPRAYER_W_M / 2 + (14 * FT_TO_M) / 2)
    const radii = interior(tire.features).flatMap((f) =>
      f.geometry.coordinates.flatMap((ring) => ring.map(radiusOf)),
    )
    // It goes PAST the limit ring — otherwise the machine teleports onto its
    // pass — but not past the perimeter tire band it is joining.
    expect(Math.max(...radii)).toBeGreaterThan(limit + 1)
    expect(Math.max(...radii)).toBeLessThanOrEqual(reach + 1)
  })

  it('meets the perimeter tire band without a gap', () => {
    // The interior track ends exactly where the perimeter track's inner side
    // begins, so the two read as one continuous wheel path.
    const { tire } = tireAndEdgeZones(FIELD)
    const interiorReach = Math.max(
      ...interior(tire.features).flatMap((f) =>
        f.geometry.coordinates.flatMap((ring) => ring.map(radiusOf)),
      ),
    )
    const perimeterInner = Math.max(
      ...perimeter(tire.features)[0].geometry.coordinates[1].map(radiusOf),
    )
    expect(interiorReach).toBeCloseTo(perimeterInner, 0)
  })

  it('used to run past it — the bands are genuinely being cut', () => {
    // Guards against the clip silently becoming a no-op: the unclipped bands
    // span the whole frame extent, well beyond the limit ring.
    const { tire } = tireAndEdgeZones(FIELD)
    const widest = Math.max(
      ...interior(tire.features).flatMap((f) =>
        f.geometry.coordinates[0].map((p) => Math.abs(toEnu(p)[1])),
      ),
    )
    expect(widest).toBeLessThan(400)
  })

  it('leaves the bands alone when the field is too small to have an interior', () => {
    // A 30 m radius with a 40 m boom: the perimeter pass IS the field, so there
    // is no limit ring to stay inside and nothing to clip against.
    const tiny = { ...FIELD, Radius: '30' }
    expect(outerSprayerLimit(tiny).features).toHaveLength(0)
    const { tire } = tireAndEdgeZones(tiny)
    expect(tire.features.length).toBeGreaterThan(0)
  })
})

describe('tire beats edge where they overlap', () => {
  // A shelter may legally sit in an edge zone, so an edge zone that overlapped a
  // wheel track would invite the sprayer to drive over one.
  const OVERLAP: FieldDict = { ...FIELD, tire_width_ft: '60', pass_edge_buffer_ft: '60' }

  it('leaves no edge zone standing on top of a tire zone', () => {
    const { tire, edge } = tireAndEdgeZones(OVERLAP)
    expect(tire.features.length).toBeGreaterThan(0)
    expect(edge.features.length).toBeGreaterThan(0)

    // Sample the centre line of every tire band; none of those points may fall
    // inside an edge band.
    for (const t of tire.features) {
      for (const p of t.geometry.coordinates[0]) {
        for (const e of edge.features) {
          const inside = booleanPointInPolygon(p as [number, number], {
            type: 'Feature',
            properties: {},
            geometry: e.geometry,
          })
          // A shared border counts as outside; only real overlap matters.
          if (inside) {
            const onEdge = e.geometry.coordinates.some((ring) =>
              ring.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9),
            )
            expect(onEdge).toBe(true)
          }
        }
      }
    }
  })

  it('still emits both kinds — the cut must not delete the edge zones', () => {
    const { tire, edge } = tireAndEdgeZones(OVERLAP)
    expect(tire.features.length).toBeGreaterThan(0)
    expect(edge.features.length).toBeGreaterThan(0)
  })

  it('leaves edge zones whole when nothing overlaps', () => {
    // With the defaults (14 ft tire, 25 ft edge) inside a 133 ft pass the bands
    // are nowhere near each other, so the subtraction is a no-op.
    const { edge } = tireAndEdgeZones(FIELD)
    for (const f of interior(edge.features)) {
      expect(f.geometry.coordinates).toHaveLength(1) // no hole punched
    }
  })
})
