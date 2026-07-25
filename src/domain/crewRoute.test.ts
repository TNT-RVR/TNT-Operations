import { describe, it, expect } from 'vitest'
import { crewRoute, type FieldDict } from './crewRoute'
import { haversineMeters } from './geo'

/**
 * Behavioural tests for the `crew_route` port (see maketentgrid.py §crew_route
 * and web-rebuild-spec.md §5.6). No Python golden file exists for routes, so
 * these lock the contract: override wins, parking pin bookends the route,
 * empty/degenerate input yields an empty route, and a simple synthetic pivot
 * field produces a finite, deterministic snake with positive length.
 */

/** ~metres → degrees at 50°N (test-fixture convenience, not production math). */
const M_PER_DEG_LAT = 111_320
const mToLat = (m: number) => m / M_PER_DEG_LAT
const mToLng = (m: number) => m / (M_PER_DEG_LAT * Math.cos((50 * Math.PI) / 180))

const PIVOT_LAT = 50.0
const PIVOT_LNG = -110.0

/** Square boundary ±200 m around the pivot, as [lat, lon] ring. */
const square = (halfM: number): Array<[number, number]> => [
  [PIVOT_LAT - mToLat(halfM), PIVOT_LNG - mToLng(halfM)],
  [PIVOT_LAT - mToLat(halfM), PIVOT_LNG + mToLng(halfM)],
  [PIVOT_LAT + mToLat(halfM), PIVOT_LNG + mToLng(halfM)],
  [PIVOT_LAT + mToLat(halfM), PIVOT_LNG - mToLng(halfM)],
]

/** Minimal bay-planted field: 8F+2M centered, 22" rows, angle 0, square boundary. */
const baseField = (): FieldDict => ({
  PP_Latitude: PIVOT_LAT,
  PP_Longitude: PIVOT_LNG,
  row_spacing_in: 22,
  num_female_rows: 8,
  num_male_rows: 2,
  total_rows: 10,
  row_layout: 'centered',
  Planting_angle: 0,
  boundary_polygon: square(200),
})

const shelters = [
  { lat: PIVOT_LAT + mToLat(20), lng: PIVOT_LNG - mToLng(40) },
  { lat: PIVOT_LAT + mToLat(80), lng: PIVOT_LNG - mToLng(40) },
  { lat: PIVOT_LAT - mToLat(30), lng: PIVOT_LNG + mToLng(15) },
  { lat: PIVOT_LAT + mToLat(60), lng: PIVOT_LNG + mToLng(70) },
]

describe('crewRoute', () => {
  it('returns an empty route for empty or single-shelter input', () => {
    expect(crewRoute(baseField(), [])).toEqual({ route: [], totalM: 0 })
    expect(crewRoute(baseField(), [shelters[0]])).toEqual({ route: [], totalM: 0 })
  })

  it('returns an empty route when required pivot fields are missing', () => {
    expect(crewRoute({}, shelters)).toEqual({ route: [], totalM: 0 })
  })

  it('crew_route_override replaces the computed route (even with no shelters)', () => {
    const override: Array<[number, number]> = [
      [50.0, -110.0],
      [50.001, -110.0],
      [50.001, -110.001],
    ]
    const field = { ...baseField(), crew_route_override: override }
    const { route, totalM } = crewRoute(field, [])
    expect(route).toEqual(override)
    // 111 m south–north + ~72 m east–west at 50°N, haversine R=6378137.
    expect(totalM).toBeGreaterThan(180)
    expect(totalM).toBeLessThan(190)
  })

  it('produces a finite snake with positive length on a synthetic pivot field', () => {
    const { route, totalM } = crewRoute(baseField(), shelters)
    expect(route.length).toBeGreaterThanOrEqual(4) // ≥2 columns × entry+exit
    expect(totalM).toBeGreaterThan(0)
    expect(Number.isFinite(totalM)).toBe(true)
    for (const [lat, lon] of route) {
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lon)).toBe(true)
      // Every vertex stays near the field (within ~1 km of the pivot).
      expect(haversineMeters({ lat, lng: lon }, { lat: PIVOT_LAT, lng: PIVOT_LNG })).toBeLessThan(1000)
    }
  })

  it('each pass runs the full length to the boundary (route touches both edges)', () => {
    const { route } = crewRoute(baseField(), shelters)
    const lats = route.map(([lat]) => lat)
    // Boundary is ±200 m; entries/exits are clipped flush to it.
    expect(Math.max(...lats)).toBeGreaterThan(PIVOT_LAT + mToLat(195))
    expect(Math.min(...lats)).toBeLessThan(PIVOT_LAT - mToLat(195))
  })

  it('parking_pin becomes the first AND last route point', () => {
    const park: [number, number] = [PIVOT_LAT + mToLat(230), PIVOT_LNG + mToLng(10)]
    const field = { ...baseField(), parking_pin: park }
    const { route, totalM } = crewRoute(field, shelters)
    expect(route.length).toBeGreaterThan(4)
    const first = { lat: route[0][0], lng: route[0][1] }
    const last = { lat: route[route.length - 1][0], lng: route[route.length - 1][1] }
    const parkPt = { lat: park[0], lng: park[1] }
    expect(haversineMeters(first, parkPt)).toBeLessThan(0.5)
    expect(haversineMeters(last, parkPt)).toBeLessThan(0.5)
    // Adding the parking legs makes the route longer than without.
    const { totalM: baseM } = crewRoute(baseField(), shelters)
    expect(totalM).toBeGreaterThan(baseM)
  })

  it('falls back to a straight-connector snake when there is no boundary', () => {
    const field = baseField()
    delete (field as Record<string, unknown>)['boundary_polygon']
    const { route, totalM } = crewRoute(field, shelters)
    expect(route.length).toBeGreaterThanOrEqual(4)
    expect(totalM).toBeGreaterThan(0)
    for (const [lat, lon] of route) {
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lon)).toBe(true)
    }
  })

  it('is deterministic (same input → identical output)', () => {
    const a = crewRoute(baseField(), shelters)
    const b = crewRoute(baseField(), shelters)
    expect(b).toEqual(a)
    const field = { ...baseField(), parking_pin: [50.002, -110.0] }
    expect(crewRoute(field, shelters)).toEqual(crewRoute(field, shelters))
  })
})
