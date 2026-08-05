import { describe, it, expect } from 'vitest'
import {
  idwGrid,
  gridStats,
  rampColor,
  gridToCsv,
  cornersValid,
  syntheticField,
  medianSpacingM,
  autoTrimM,
  type SamplePoint,
} from './returnsMap'

/** A 400 m pivot at a southern-Alberta location — matches the seeded demo field. */
const PIVOT = {
  PP_Longitude: '-111.6',
  PP_Latitude: '49.83',
  Radius: '400',
  use_bays: false,
}

/** Roughly ±350 m around the pivot centre, as a boundary polygon field. */
const SQUARE = {
  PP_Longitude: '-111.6',
  PP_Latitude: '49.83',
  use_bays: false,
  boundary_polygon: [
    [49.827, -111.6045],
    [49.833, -111.6045],
    [49.833, -111.5955],
    [49.827, -111.5955],
  ],
}

const at = (lat: number, lng: number, value: number): SamplePoint => ({ lat, lng, value })

describe('idwGrid', () => {
  it('returns null with no samples, and with no geometry', () => {
    expect(idwGrid(PIVOT, [])).toBeNull()
    expect(idwGrid({ use_bays: false }, [at(49.83, -111.6, 5)])).toBeNull()
  })

  it('produces a flat surface from a single sample', () => {
    // One measurement says the same thing everywhere — it cannot imply a gradient.
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 7.5)], { cellM: 50 })!
    expect(g.min).toBeCloseTo(7.5, 6)
    expect(g.max).toBeCloseTo(7.5, 6)
  })

  it('never interpolates outside the measured range', () => {
    // IDW is a weighted MEAN, so it can't exceed its inputs. Guards against a
    // map implying a yield nobody actually recorded.
    const g = idwGrid(PIVOT, [at(49.831, -111.601, 2), at(49.829, -111.599, 10)], { cellM: 25 })!
    expect(g.min).toBeGreaterThanOrEqual(2)
    expect(g.max).toBeLessThanOrEqual(10)
  })

  it('reproduces a sample’s own value at its location', () => {
    const g = idwGrid(PIVOT, [at(49.831, -111.601, 3), at(49.829, -111.599, 9)], { cellM: 10 })!
    // The cell containing a sample should sit essentially at that sample.
    const nearestTo = (targetE: number, targetN: number) => {
      let best = NaN
      let bestD = Infinity
      for (let ry = 0; ry < g.rows; ry++) {
        for (let cx = 0; cx < g.cols; cx++) {
          const v = g.values[ry * g.cols + cx]
          if (!Number.isFinite(v)) continue
          const e = g.originE + (cx + 0.5) * g.cellM
          const n = g.originN - (ry + 0.5) * g.cellM
          const d = Math.hypot(e - targetE, n - targetN)
          if (d < bestD) {
            bestD = d
            best = v
          }
        }
      }
      return best
    }
    const s0 = g.samplesEnu[0] // value 3
    const s1 = g.samplesEnu[1] // value 9
    // Close to a sample, IDW is dominated by it — the map must not disagree
    // with a block you actually weighed.
    expect(nearestTo(s0.e, s0.n)).toBeLessThan(4)
    expect(nearestTo(s1.e, s1.n)).toBeGreaterThan(8)
  })

  it('weights nearer samples more heavily', () => {
    const g = idwGrid(PIVOT, [at(49.8315, -111.6, 0), at(49.8285, -111.6, 10)], { cellM: 20 })!
    const valueAt = (e: number, n: number) => {
      const cx = Math.floor((e - g.originE) / g.cellM)
      const ry = Math.floor((g.originN - n) / g.cellM)
      return g.values[ry * g.cols + cx]
    }
    const s0 = g.samplesEnu[0] // value 0, to the north
    const s1 = g.samplesEnu[1] // value 10, to the south
    // A point close to the low sample must read lower than one close to the high.
    const nearLow = valueAt(s0.e, s0.n - 20)
    const nearHigh = valueAt(s1.e, s1.n + 20)
    expect(nearLow).toBeLessThan(nearHigh)
  })

  it('clips to a boundary polygon, leaving outside cells empty', () => {
    const g = idwGrid(SQUARE, [at(49.83, -111.6, 5)], { cellM: 25 })!
    const filled = [...g.values].filter((v) => Number.isFinite(v)).length
    expect(filled).toBeGreaterThan(0)
    // The grid is the polygon's bounding box, and the polygon here fills it,
    // so most cells are filled — but the array is still fully allocated.
    expect(g.values.length).toBe(g.cols * g.rows)
  })

  it('leaves cells empty when every sample is beyond maxDistanceM', () => {
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 5)], { cellM: 50, maxDistanceM: 60 })
    // A tight radius around one central sample: some cells fill, the far ones don't.
    expect(g).not.toBeNull()
    const filled = [...g!.values].filter((v) => Number.isFinite(v)).length
    expect(filled).toBeGreaterThan(0)
    expect(filled).toBeLessThan(g!.cols * g!.rows)
  })

  it('coarsens the cell size rather than exceeding the cell budget', () => {
    // A 1 m grid over an 800 m pivot would be 640,000 cells and lock the browser.
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 5)], { cellM: 1, maxCells: 10_000 })!
    expect(g.cols * g.rows).toBeLessThanOrEqual(10_000 * 1.05)
    expect(g.cellM).toBeGreaterThan(1)
  })

  it('orders corners NW, NE, SE, SW', () => {
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 5)], { cellM: 100 })!
    const [nw, ne, se, sw] = g.corners
    expect(nw[1]).toBeGreaterThan(sw[1]) // north above south
    expect(ne[0]).toBeGreaterThan(nw[0]) // east right of west
    expect(se[1]).toBeLessThan(ne[1])
  })
})

describe('gridStats', () => {
  it('counts only filled cells and converts area to acres', () => {
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 4)], { cellM: 50 })!
    const s = gridStats(g)
    expect(s.cells).toBeGreaterThan(0)
    expect(s.mean).toBeCloseTo(4, 6)
    // A 400 m radius circle is ~502,655 m² ≈ 124 acres.
    expect(s.acres).toBeGreaterThan(100)
    expect(s.acres).toBeLessThan(140)
  })
})

describe('rampColor', () => {
  it('runs red (worst) to green (best) and clamps outside [0,1]', () => {
    expect(rampColor(0)).toEqual([165, 0, 38]) // dark red = worst
    expect(rampColor(1)).toEqual([26, 152, 80]) // dark green = best
    expect(rampColor(-5)).toEqual(rampColor(0))
    expect(rampColor(5)).toEqual(rampColor(1))
  })

  it('returns black for a non-finite input rather than throwing', () => {
    expect(rampColor(NaN)).toEqual([0, 0, 0])
  })
})

describe('gridToCsv', () => {
  it('writes a header and one row per filled cell', () => {
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 6)], { cellM: 100 })!
    const lines = gridToCsv(g).split('\n')
    expect(lines[0]).toBe('lng,lat,return_lbs')
    expect(lines.length - 1).toBe(gridStats(g).cells)
    // Coordinates must be real numbers, not NaN.
    const [lng, lat, v] = lines[1].split(',').map(Number)
    expect(Number.isFinite(lng)).toBe(true)
    expect(Number.isFinite(lat)).toBe(true)
    expect(v).toBeCloseTo(6, 3)
  })
})

describe('performance with real-world sample counts', () => {
  /** ~3,900 points scattered over the pivot, like an imported season. */
  const many: SamplePoint[] = Array.from({ length: 3947 }, (_, i) => {
    const a = (i * 2.399963) % (Math.PI * 2) // golden-angle spiral
    const r = 0.003 * Math.sqrt(i / 3947)
    return { lat: 49.83 + r * Math.cos(a), lng: -111.6 + r * 1.5 * Math.sin(a), value: 3 + (i % 7) }
  })

  it('interpolates thousands of points in reasonable time', () => {
    // Naive all-samples IDW here is ~1e9 distance calculations and locks the
    // browser. This is the regression that caused exactly that.
    const t0 = Date.now()
    const g = idwGrid(PIVOT, many, { cellM: 10 })!
    const ms = Date.now() - t0
    expect(g).not.toBeNull()
    expect(ms).toBeLessThan(5000)
  })

  it('still respects the measured range with many points', () => {
    const g = idwGrid(PIVOT, many, { cellM: 25 })!
    expect(g.min).toBeGreaterThanOrEqual(3)
    expect(g.max).toBeLessThanOrEqual(9)
  })

  it('agrees closely with brute-force IDW', () => {
    // The spatial index is an optimisation, not a different answer: taking the
    // nearest N must land in the same place as weighing everything.
    const few = many.slice(0, 200)
    const indexed = idwGrid(PIVOT, few, { cellM: 50 })!
    const brute = idwGrid(PIVOT, few, { cellM: 50, maxNeighbors: few.length })!
    let compared = 0
    let worst = 0
    for (let i = 0; i < indexed.values.length; i++) {
      const a = indexed.values[i]
      const b = brute.values[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      compared++
      worst = Math.max(worst, Math.abs(a - b))
    }
    expect(compared).toBeGreaterThan(50)
    // Within a fraction of a pound across the whole surface.
    expect(worst).toBeLessThan(0.5)
  })
})

describe('cornersValid', () => {
  it('accepts a normal field extent', () => {
    const g = idwGrid(PIVOT, [at(49.83, -111.6, 5)], { cellM: 50 })!
    expect(cornersValid(g.corners)).toBe(true)
  })

  it('rejects the extent produced by a 0,0 row', () => {
    // The real crash: one row at Null Island stretches the local projection
    // past ±90 latitude, and MapLibre throws "Invalid LngLat latitude value",
    // taking the whole view down.
    const pts = [
      ...Array.from({ length: 20 }, (_, i) => at(49.83 + i * 0.0005, -111.6, 5)),
      at(0, 0, 5),
    ]
    const f = syntheticField(pts)!
    const g = idwGrid(f, pts, { cellM: 25 })!
    expect(cornersValid(g.corners)).toBe(false)
  })

  it('rejects non-finite or malformed corners', () => {
    expect(cornersValid([])).toBe(false)
    expect(
      cornersValid([
        [0, NaN],
        [0, 0],
        [0, 0],
        [0, 0],
      ]),
    ).toBe(false)
  })
})

describe('edge trimming', () => {
  /** 6×6 blocks on a 50 m lattice. */
  const lattice: SamplePoint[] = Array.from({ length: 36 }, (_, i) =>
    at(49.83 + (i % 6) * 0.00045, -111.6 + Math.floor(i / 6) * 0.0007, 5),
  )

  it('measures typical block spacing', () => {
    const m = medianSpacingM(lattice)!
    // ~50 m lattice, so the nearest neighbour should be about that.
    expect(m).toBeGreaterThan(35)
    expect(m).toBeLessThan(65)
  })

  it('is null with fewer than two points', () => {
    expect(medianSpacingM([at(49.83, -111.6, 5)])).toBeNull()
  })

  it('derives a trim distance that scales with looseness', () => {
    const tight = autoTrimM(lattice, 1)
    const loose = autoTrimM(lattice, 3.5)
    expect(loose).toBeGreaterThan(tight)
    expect(tight).toBeGreaterThanOrEqual(25)
  })

  it('falls back sensibly for a single point', () => {
    expect(autoTrimM([at(49.83, -111.6, 5)], 2)).toBeGreaterThan(0)
  })

  it('leaves the far corners empty instead of squaring off the field', () => {
    // The reported problem: a round field rendered as a square because the
    // grid's corners were filled by extrapolation from distant blocks.
    const trimmed = idwGrid(SQUARE, lattice, { cellM: 10, maxDistanceM: autoTrimM(lattice, 1) })!
    const filled = idwGrid(SQUARE, lattice, { cellM: 10, maxDistanceM: null })!
    const count = (g: typeof trimmed) => [...g.values].filter((v) => Number.isFinite(v)).length
    expect(count(trimmed)).toBeLessThan(count(filled))
    // Still draws the sampled area itself.
    expect(count(trimmed)).toBeGreaterThan(0)
  })
})
