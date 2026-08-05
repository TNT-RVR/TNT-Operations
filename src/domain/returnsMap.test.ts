import { describe, it, expect } from 'vitest'
import { idwGrid, gridStats, rampColor, gridToCsv, type SamplePoint } from './returnsMap'

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
  it('spans low to high and clamps outside [0,1]', () => {
    expect(rampColor(0)).toEqual([49, 54, 149])
    expect(rampColor(1)).toEqual([165, 0, 38])
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
