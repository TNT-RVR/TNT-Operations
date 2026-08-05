import { describe, it, expect } from 'vitest'
import type { Feature, Polygon } from 'geojson'
import { booleanPointInPolygon } from '@turf/turf'
import { seedFields } from '@/data/seed'
import { getTentPositions } from './tentGrid'
import { fieldFrame } from './fieldFrame'
import {
  maleBayBands,
  planterPassLines,
  planterPassLabels,
  alignmentLines,
  clipToField,
  fieldOutline,
} from './bayOverlays'
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

  describe('display clipping (clipToField)', () => {
    // The generators span the frame's bounding box on purpose — that's what keeps
    // the §5.3 band width exact. The MAP trims, so nothing spills past the field.
    const inside = (fc: { features: Array<{ geometry: { coordinates: unknown } }> }, outline: Feature<Polygon>) => {
      const pts: number[][] = []
      const walk = (c: unknown) => {
        if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[])
        else if (Array.isArray(c)) c.forEach(walk)
      }
      fc.features.forEach((f) => walk(f.geometry.coordinates))
      // A vertex may sit exactly ON the boundary after a cut, so allow the edge.
      return pts.every((p) => booleanPointInPolygon(p as [number, number], outline) || onEdge(p, outline))
    }
    const onEdge = (p: number[], outline: Feature<Polygon>) =>
      outline.geometry.coordinates[0].some((v) => Math.abs(v[0] - p[0]) < 1e-6 && Math.abs(v[1] - p[1]) < 1e-6) ||
      // turf cuts introduce new vertices on the edge; accept anything very close.
      pointNearRing(p, outline.geometry.coordinates[0])
    const pointNearRing = (p: number[], ring: number[][]) =>
      ring.some((_, i) => {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len2 = dx * dx + dy * dy
        if (len2 === 0) return false
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) < 1e-7
      })

    for (const [label, geom] of [
      ['pivot field', pivotField],
      ['polygon field', polygonField],
    ] as const) {
      it(`trims bays and passes to the ${label}`, () => {
        const outline = fieldOutline(geom)!
        expect(outline).toBeTruthy()

        const rawBands = maleBayBands(geom)
        const clippedBands = clipToField(rawBands, geom)
        expect(clippedBands.features.length).toBeGreaterThan(0)
        expect(inside(clippedBands, outline)).toBe(true)

        const clippedPasses = clipToField(planterPassLines(geom), geom)
        expect(clippedPasses.features.length).toBeGreaterThan(0)
        expect(inside(clippedPasses, outline)).toBe(true)

        const clippedSpray = clipToField(sprayerPassLines(geom), geom)
        expect(inside(clippedSpray, outline)).toBe(true)
      })
    }

    it('leaves geometry untouched when the field has no outline', () => {
      const noPivot = { use_bays: true, num_female_rows: '8', num_male_rows: '2', row_spacing_in: '22' }
      const fc = maleBayBands(noPivot)
      expect(clipToField(fc, noPivot)).toBe(fc)
    })

    it('puts a pass number at BOTH ends of each pass, inside the field', () => {
      const outline = fieldOutline(pivotField)!
      const lines = clipToField(planterPassLines(pivotField), pivotField)
      const labels = planterPassLabels(pivotField)
      // Two labels per clipped pass line.
      expect(labels.features.length).toBe(lines.features.length * 2)
      expect(inside(labels as never, outline)).toBe(true)
      // Every label carries the pass number it belongs to.
      expect(labels.features.every((f) => typeof (f.properties as { number?: number }).number === 'number')).toBe(true)
    })
  })

  it('a field with no pivot yields no overlays instead of drawing at 0,0', () => {
    const empty = { use_bays: true, num_female_rows: '8', num_male_rows: '2', row_spacing_in: '22' }
    expect(fieldFrame(empty)).toBeNull()
    expect(maleBayBands(empty).features).toHaveLength(0)
    expect(sprayerPassLines(empty).features).toHaveLength(0)
    expect(shelterBufferSquares([{ lat: 49.8, lng: -111.6 }], empty).features).toHaveLength(0)
  })
})
