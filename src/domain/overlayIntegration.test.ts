import { describe, it, expect } from 'vitest'
import { seedFields } from '@/data/seed'
import { getTentPositions } from './tentGrid'
import { fieldFrame } from './fieldFrame'
import { maleBayBands, planterPassLines, alignmentLines } from './bayOverlays'
import { sprayerPassLines, outerSprayerLimit, tireAndEdgeZones, shelterBufferSquares } from './sprayOverlays'

/**
 * Integration guard: the overlay generators must produce real geometry for the
 * ACTUAL field shapes the app ships, not just synthetic fixtures. The unit
 * suites prove each generator in isolation; this proves the map is feeding them
 * inputs they can use — the seam where a field-key rename or a frame change
 * would silently blank the map.
 */

const pivotField = seedFields[0].geometry!
const polygonField = seedFields[1].geometry!

const allFinite = (fc: { features: Array<{ geometry: unknown }> }): boolean =>
  JSON.stringify(fc.features).match(/-?\d+\.?\d*/g)?.every((n) => Number.isFinite(Number(n))) ?? true

describe('overlays against the real seeded fields', () => {
  for (const [label, geom] of [
    ['pivot field', pivotField],
    ['polygon field', polygonField],
  ] as const) {
    describe(label, () => {
      it('builds a frame', () => {
        expect(fieldFrame(geom)).not.toBeNull()
      })
      it('produces male-bay bands', () => {
        const fc = maleBayBands(geom)
        expect(fc.features.length).toBeGreaterThan(0)
        expect(allFinite(fc)).toBe(true)
      })
      it('produces numbered planter pass lines', () => {
        const fc = planterPassLines(geom)
        expect(fc.features.length).toBeGreaterThan(0)
        const nums = fc.features.map((f) => (f.properties as { number: number }).number)
        expect(new Set(nums).size).toBe(nums.length) // no duplicate numbers
      })
      it('produces sprayer passes and tire/edge zones', () => {
        expect(sprayerPassLines(geom).features.length).toBeGreaterThan(0)
        const { tire, edge } = tireAndEdgeZones(geom)
        expect(tire.features.length).toBeGreaterThan(0)
        expect(edge.features.length).toBeGreaterThan(0)
      })
      it('produces alignment lines and buffer squares from the computed pins', () => {
        const pins = getTentPositions(geom)
        expect(pins.length).toBeGreaterThan(2)
        expect(alignmentLines(pins, geom).features.length).toBeGreaterThan(0)
        expect(shelterBufferSquares(pins, geom).features).toHaveLength(pins.length)
      })
    })
  }

  it('insets the sprayer limit inside a real polygon boundary', () => {
    // Only the polygon field has a boundary to inset.
    expect(outerSprayerLimit(polygonField).features.length).toBeGreaterThan(0)
  })

  it('a field with no pivot yields no overlays instead of drawing at 0,0', () => {
    const empty = { use_bays: true, num_female_rows: '8', num_male_rows: '2', row_spacing_in: '22' }
    expect(fieldFrame(empty)).toBeNull()
    expect(maleBayBands(empty).features).toHaveLength(0)
    expect(sprayerPassLines(empty).features).toHaveLength(0)
    expect(shelterBufferSquares([{ lat: 49.8, lng: -111.6 }], empty).features).toHaveLength(0)
  })
})
