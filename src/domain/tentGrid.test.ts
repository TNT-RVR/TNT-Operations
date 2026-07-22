import { describe, it, expect } from 'vitest'
import { getTentPositionsWithRows, type FieldDict } from './tentGrid'
import { haversineMeters, type LngLat } from './geo'
import golden from './__fixtures__/tentGrid.golden.json'

/**
 * Golden-file test: the TS port of `get_tent_positions` must reproduce the pin
 * coordinates the OLD beetent-maps Python produced for every real field in
 * `beetent-maps/fields/`. Fixtures were captured by `scripts/gen_golden.py`
 * (see docs) running each field through `maketentgrid.get_tent_positions`.
 *
 * Tolerance: the UTM-ish projection matches Python to ~1e-9 m, so pins agree far
 * tighter than the ~1 m field-placement tolerance the handoff plan called for.
 */

interface Fixture {
  name: string
  branch: string
  features: Record<string, unknown>
  field: FieldDict
  expected_positions: Array<[number, number]> // [lat, lon]
  expected_rows: number[]
}

const fixtures = golden as unknown as Fixture[]

/** Max per-pin tolerance in metres. */
const TOL_M = 1.0

describe('getTentPositions — golden fields from beetent-maps', () => {
  it('has fixtures for both manual and synthetic-grid branches', () => {
    const branches = new Set(fixtures.map((f) => f.branch))
    expect(branches.has('synthetic_grid')).toBe(true)
    expect(branches.has('manual')).toBe(true)
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
  })

  for (const fx of fixtures) {
    it(`${fx.branch}: ${fx.name} (${fx.expected_positions.length} pins)`, () => {
      const { positions, rows } = getTentPositionsWithRows(fx.field)

      // 1. Exact pin count.
      expect(positions.length).toBe(fx.expected_positions.length)
      expect(rows.length).toBe(positions.length)

      // 2. Each pin within tolerance of the Python coordinate, in order.
      let maxErr = 0
      for (let i = 0; i < positions.length; i++) {
        const got: LngLat = positions[i]
        const [lat, lon] = fx.expected_positions[i]
        const d = haversineMeters(got, { lat, lng: lon })
        if (d > maxErr) maxErr = d
      }
      expect(maxErr).toBeLessThanOrEqual(TOL_M)

      // 3. NW-snake row indices reproduced exactly.
      expect(rows).toEqual(fx.expected_rows)
    })
  }
})
