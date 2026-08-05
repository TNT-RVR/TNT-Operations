import { describe, it, expect } from 'vitest'
import { findGpsOutliers } from './gpsOutliers'
import type { SamplePoint } from './returnsMap'

const at = (lat: number, lng: number, label?: string): SamplePoint => ({ lat, lng, value: 5, label })

/** 25 blocks in a tidy 5×5 grid, ~50 m apart, around the demo pivot. */
const cluster: SamplePoint[] = Array.from({ length: 25 }, (_, i) =>
  at(49.83 + (i % 5) * 0.00045, -111.6 + Math.floor(i / 5) * 0.0007, `B${i}`),
)

/** A 400 m pivot field centred on the cluster, as a boundary polygon. */
const FIELD = {
  PP_Longitude: '-111.6',
  PP_Latitude: '49.83',
  use_bays: false,
  boundary_polygon: [
    [49.8265, -111.6055],
    [49.8335, -111.6055],
    [49.8335, -111.5945],
    [49.8265, -111.5945],
  ],
}

describe('findGpsOutliers — spread method', () => {
  it('keeps a clean cluster intact', () => {
    // The commonest case by far: nothing is wrong, so nothing may be removed.
    const r = findGpsOutliers(cluster)
    expect(r.removed).toHaveLength(0)
    expect(r.keep).toHaveLength(25)
  })

  it('flags a fix that landed a kilometre away', () => {
    const bad = at(49.84, -111.58, 'BAD')
    const r = findGpsOutliers([...cluster, bad])
    expect(r.removed.map((x) => x.sample.label)).toEqual(['BAD'])
    expect(r.keep).toHaveLength(25)
  })

  it('flags several bad fixes at once', () => {
    const r = findGpsOutliers([...cluster, at(49.9, -111.5, 'A'), at(49.75, -111.7, 'B')])
    expect(r.removed.map((x) => x.sample.label).sort()).toEqual(['A', 'B'])
  })

  it('is not fooled by outliers dragging the centre', () => {
    // The whole reason for median/MAD: with a mean and standard deviation, a
    // handful of distant points inflate the spread until they look normal.
    const many = [...cluster, at(49.95, -111.4, 'X1'), at(49.96, -111.39, 'X2'), at(49.97, -111.38, 'X3')]
    const r = findGpsOutliers(many)
    expect(r.removed.map((x) => x.sample.label).sort()).toEqual(['X1', 'X2', 'X3'])
    // Centre stays with the real cluster rather than drifting toward them.
    expect(r.centre!.lat).toBeCloseTo(49.831, 2)
  })

  it('reports how far each flagged point was', () => {
    const r = findGpsOutliers([...cluster, at(49.84, -111.58, 'BAD')])
    expect(r.removed[0].distM).toBeGreaterThan(500)
    expect(r.removed[0].reason).toBe('far-from-others')
  })

  it('does not trim the edges of a tight cluster', () => {
    // Blocks 20 m apart have a tiny MAD; without a floor on the radius the
    // outermost legitimate blocks would be flagged as bad fixes.
    const tight = Array.from({ length: 20 }, (_, i) => at(49.83 + i * 0.00018, -111.6, `T${i}`))
    expect(findGpsOutliers(tight).removed).toHaveLength(0)
  })

  it('keeps everything when there are too few points to judge', () => {
    // With 4 points there is no meaningful "normal"; discarding one would be
    // a guess, and the data is too precious for that. This straggler is ~1 km
    // out — suspicious with more context, but inside the hard limit, so with
    // only four points it stays.
    const few = [at(49.83, -111.6), at(49.831, -111.601), at(49.832, -111.6), at(49.839, -111.59)]
    expect(findGpsOutliers(few).removed).toHaveLength(0)
  })

  it('still applies the hard limit to a tiny set', () => {
    const few = [at(49.83, -111.6), at(49.831, -111.601), at(0.5, 20, 'WAY-OFF')]
    const r = findGpsOutliers(few)
    expect(r.removed.map((x) => x.sample.label)).toEqual(['WAY-OFF'])
    expect(r.removed[0].reason).toBe('beyond-hard-limit')
  })

  it('respects a stricter madK', () => {
    const spread = [...cluster, at(49.8345, -111.5955, 'EDGE')]
    const lenient = findGpsOutliers(spread, null, { madK: 8, minRadiusM: 50 })
    const strict = findGpsOutliers(spread, null, { madK: 1, minRadiusM: 50 })
    expect(strict.removed.length).toBeGreaterThanOrEqual(lenient.removed.length)
  })

  it('handles an empty list', () => {
    const r = findGpsOutliers([])
    expect(r.keep).toEqual([])
    expect(r.removed).toEqual([])
  })
})

describe('findGpsOutliers — boundary method', () => {
  it('keeps points inside the field', () => {
    const r = findGpsOutliers(cluster, FIELD)
    expect(r.removed).toHaveLength(0)
  })

  it('removes points outside the field, however plausible they look', () => {
    // ~1 km north of the boundary: close enough that the spread test might
    // forgive it, but the field's shape is definitive.
    const r = findGpsOutliers([...cluster, at(49.845, -111.6, 'OUT')], FIELD)
    expect(r.removed.map((x) => x.sample.label)).toEqual(['OUT'])
    expect(r.removed[0].reason).toBe('outside-boundary')
  })

  it('forgives a block sitting right on the boundary', () => {
    // A real block on the field edge, a few metres out through GPS noise,
    // must not be thrown away.
    const onEdge = at(49.83355, -111.6, 'EDGE')
    expect(findGpsOutliers([...cluster, onEdge], FIELD, { boundaryBufferM: 60 }).removed).toHaveLength(0)
  })

  it('falls back to the spread test when the field has no boundary', () => {
    const noGeom = { PP_Longitude: '-111.6', PP_Latitude: '49.83', Radius: '400', use_bays: false }
    const r = findGpsOutliers([...cluster, at(49.9, -111.5, 'BAD')], noGeom)
    expect(r.removed.map((x) => x.sample.label)).toEqual(['BAD'])
    expect(r.removed[0].reason).not.toBe('outside-boundary')
  })
})
