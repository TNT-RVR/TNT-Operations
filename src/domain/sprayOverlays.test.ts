import { describe, it, expect } from 'vitest'
import type { Position } from 'geojson'
import { latlonListToEnu } from './geo'
import { fieldFrame, pointInEnuRing } from './fieldFrame'
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
    expect(tire.features.length).toBeGreaterThan(0)
    // One edge band per pass seam ⇒ one more than the passes.
    expect(edge.features.length).toBe(tire.features.length + 1)

    for (const f of tire.features) {
      const ring = f.geometry.coordinates[0]
      expect(finite(ring)).toBe(true)
      expect(ring).toHaveLength(5) // 4 corners + close
      expect(f.properties?.kind).toBe('tire')
      expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(14 * FT_TO_M, 2)
    }
    for (const f of edge.features) {
      const ring = f.geometry.coordinates[0]
      expect(finite(ring)).toBe(true)
      expect(f.properties?.kind).toBe('edge')
      expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(25 * FT_TO_M, 2)
    }
  })

  it('honours custom tire / edge widths and drops a zero-width band', () => {
    const { tire, edge } = tireAndEdgeZones({
      ...FIELD,
      tire_width_ft: '20',
      pass_edge_buffer_ft: '0',
    })
    expect(edge.features).toHaveLength(0)
    const ring = tire.features[0].geometry.coordinates[0]
    expect(dist(toEnu(ring[0]), toEnu(ring[1]))).toBeCloseTo(20 * FT_TO_M, 2)
  })

  it('runs the bands along the spray direction', () => {
    const { tire } = tireAndEdgeZones({ ...FIELD, Spray_angle: '90' })
    const ring = tire.features[0].geometry.coordinates[0]
    // The long side of a band is the along-pass edge; it must be perpendicular
    // to the 0°-spray case's long side.
    const long90 = bearing([ring[1], ring[2]])
    const ring0 = tireAndEdgeZones({ ...FIELD, Spray_angle: '0' }).tire.features[0].geometry
      .coordinates[0]
    const long0 = bearing([ring0[1], ring0[2]])
    let diff = Math.abs(long0 - long90)
    if (diff > 90) diff = 180 - diff
    expect(diff).toBeCloseTo(90, 1)
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
