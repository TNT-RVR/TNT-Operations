import { describe, it, expect } from 'vitest'
import { fieldFrame } from './fieldFrame'
import {
  idwGrid,
  gridStats,
  rampColor,
  gridToCsv,
  cornersValid,
  syntheticField,
  medianSpacingM,
  autoTrimM,
  insideField,
  sampleGrid,
  matchFieldByGeometry,
  type ReturnsGrid,
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
    const trimmed = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: autoTrimM(lattice, 1) })!
    const filled = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: null })!
    const count = (g: typeof trimmed) => [...g.values].filter((v) => Number.isFinite(v)).length
    expect(count(trimmed)).toBeLessThan(count(filled))
    // Still draws the sampled area itself.
    expect(count(trimmed)).toBeGreaterThan(0)
  })
})

describe('clip vs influence — the polka-dot bug', () => {
  /** Blocks ~50 m apart in a line, with clearly different values. */
  const line: SamplePoint[] = [
    at(49.83, -111.6, 2),
    at(49.83, -111.5993, 8),
    at(49.83, -111.5986, 2),
  ]

  it('still blends between blocks when the edge is trimmed tightly', () => {
    // The reported symptom: a tight trim gave every block its own flat disc,
    // because the same distance was limiting which samples a cell could see.
    // Values BETWEEN two blocks must sit between their values, not equal one.
    const g = idwGrid(SQUARE, line, { cellM: 5, clipDistanceM: 40 })!
    const distinct = new Set<number>()
    for (const v of g.values) if (Number.isFinite(v)) distinct.add(Math.round(v * 100) / 100)
    // A disc-per-block surface would contain essentially 3 values.
    expect(distinct.size).toBeGreaterThan(20)
  })

  it('clip masks the edge without changing any value that is drawn', () => {
    const wide = idwGrid(SQUARE, line, { cellM: 5, clipDistanceM: 500 })!
    const tight = idwGrid(SQUARE, line, { cellM: 5, clipDistanceM: 40 })!
    let compared = 0
    for (let i = 0; i < tight.values.length; i++) {
      const t = tight.values[i]
      if (!Number.isFinite(t)) continue
      // Every cell the tight version draws must have the SAME value as before.
      expect(t).toBeCloseTo(wide.values[i], 9)
      compared++
    }
    expect(compared).toBeGreaterThan(10)
  })

  it('maxDistanceM still limits influence when asked for explicitly', () => {
    const g = idwGrid(SQUARE, line, { cellM: 5, maxDistanceM: 10 })!
    const filled = [...g.values].filter((v) => Number.isFinite(v)).length
    expect(filled).toBeGreaterThan(0)
  })
})

describe('spacing is robust to repeated positions', () => {
  const lattice: SamplePoint[] = Array.from({ length: 196 }, (_, i) =>
    at(49.83 + (i % 14) * 0.00045, -111.6 + Math.floor(i / 14) * 0.0007, 5),
  )

  it('is not collapsed by blocks recorded at the same spot', () => {
    // The polka-dot cause: several blocks per position (or two GPS reads of
    // one) made the nearest-neighbour median ~1 m, so the edge trim fell to
    // its floor and every block got its own small disc.
    const exact = lattice.flatMap((p) => [p, { ...p }])
    const near = lattice.flatMap((p) => [p, { ...p, lat: p.lat + 0.00001 }])
    for (const set of [exact, near]) {
      const spacing = medianSpacingM(set)!
      expect(spacing).toBeGreaterThan(20) // not ~1 m
    }
  })

  it('leaves no holes between blocks at the default looseness', () => {
    const near = lattice.flatMap((p) => [p, { ...p, lat: p.lat + 0.00001 }])
    // The trim must comfortably exceed the real spacing, or gaps appear.
    expect(autoTrimM(near, 2)).toBeGreaterThan(50)
  })

  it('still reflects genuine spacing for clean data', () => {
    expect(medianSpacingM(lattice)!).toBeGreaterThan(35)
    expect(medianSpacingM(lattice)!).toBeLessThan(70)
  })

  it('produces a continuous surface for duplicated positions', () => {
    // End to end: no isolated discs. Walk the middle row of the grid; once
    // inside the sampled area it should stay filled, not alternate.
    const near = lattice.flatMap((p) => [p, { ...p, lat: p.lat + 0.00001 }])
    const g = idwGrid(SQUARE, near, { cellM: 10, clipDistanceM: autoTrimM(near, 2) })!
    const row = Math.floor(g.rows / 2)
    const filled: boolean[] = []
    for (let cx = 0; cx < g.cols; cx++) filled.push(Number.isFinite(g.values[row * g.cols + cx]))
    // Count runs of filled cells: a continuous band is ONE run, polka dots
    // would be many.
    let runs = 0
    for (let i = 0; i < filled.length; i++) if (filled[i] && !filled[i - 1]) runs++
    expect(runs).toBe(1)
  })
})

describe('edge smoothing', () => {
  /** Blocks on a 50 m lattice inside the square field. */
  const lattice: SamplePoint[] = Array.from({ length: 100 }, (_, i) =>
    at(49.828 + (i % 10) * 0.00045, -111.603 + Math.floor(i / 10) * 0.0007, 5 + (i % 3)),
  )

  /** Count filled/empty flips along each row — a proxy for a ragged edge. */
  const rowFlips = (g: ReturnsGrid): number => {
    let flips = 0
    for (let ry = 0; ry < g.rows; ry++) {
      let prev = false
      for (let cx = 0; cx < g.cols; cx++) {
        const on = Number.isFinite(g.values[ry * g.cols + cx])
        if (on !== prev) flips++
        prev = on
      }
    }
    return flips
  }

  it('closes the scallops between neighbouring blocks', () => {
    // The union of one disc per block has an arc-chain rim, which reads as
    // wavy. Closing should leave a markedly smoother outline.
    const g = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: 45 })!
    // Every row that has any surface should enter and leave it once: a wavy
    // or dotted edge produces many more transitions.
    const rowsWithData = new Set<number>()
    for (let ry = 0; ry < g.rows; ry++) {
      for (let cx = 0; cx < g.cols; cx++) {
        if (Number.isFinite(g.values[ry * g.cols + cx])) {
          rowsWithData.add(ry)
          break
        }
      }
    }
    expect(rowFlips(g)).toBeLessThanOrEqual(rowsWithData.size * 2)
  })

  it('does not change the values it keeps', () => {
    // Smoothing the outline must never repaint the interior.
    const smooth = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: 45 })!
    const plain = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: null })!
    let compared = 0
    for (let i = 0; i < smooth.values.length; i++) {
      if (!Number.isFinite(smooth.values[i])) continue
      expect(smooth.values[i]).toBeCloseTo(plain.values[i], 9)
      compared++
    }
    expect(compared).toBeGreaterThan(100)
  })

  it('never fills beyond the field boundary', () => {
    // Closing may only add cells that are inside the field and already had a
    // value computed — it must not spill past the boundary.
    const g = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: 200 })!
    const plain = idwGrid(SQUARE, lattice, { cellM: 10, clipDistanceM: null })!
    for (let i = 0; i < g.values.length; i++) {
      if (Number.isFinite(g.values[i])) expect(Number.isFinite(plain.values[i])).toBe(true)
    }
  })
})

describe('exact field outlines', () => {
  const PIVOT_FIELD = { PP_Longitude: '-111.6', PP_Latitude: '49.83', Radius: '400', use_bays: false }

  it('treats a pivot as a true circle', () => {
    const f = fieldFrame(PIVOT_FIELD)!
    // Just inside and just outside the 400 m radius, in several directions.
    for (const a of [0, Math.PI / 4, Math.PI / 2, 2.4, 4.1]) {
      expect(insideField(f, 399 * Math.cos(a), 399 * Math.sin(a))).toBe(true)
      expect(insideField(f, 401 * Math.cos(a), 401 * Math.sin(a))).toBe(false)
    }
  })

  it('treats a polygon as straight edges', () => {
    const f = fieldFrame(SQUARE)!
    // A square boundary: the corner region is outside, the mid-edge inside.
    const ring = f.boundaryEnu!
    const maxE = Math.max(...ring.map((p) => p[0]))
    const maxN = Math.max(...ring.map((p) => p[1]))
    expect(insideField(f, maxE - 5, maxN - 5)).toBe(true)
    expect(insideField(f, maxE + 5, maxN + 5)).toBe(false)
    // A circle through the corner would wrongly include this point.
    expect(insideField(f, maxE + 2, 0)).toBe(false)
  })
})

describe('sampleGrid', () => {
  const lattice: SamplePoint[] = Array.from({ length: 64 }, (_, i) =>
    at(49.828 + (i % 8) * 0.00045, -111.603 + Math.floor(i / 8) * 0.0007, 4 + (i % 4)),
  )

  it('interpolates between cells rather than stepping', () => {
    const g = idwGrid(SQUARE, lattice, { cellM: 20 })!
    // Walk a short line and confirm values change gradually, not in jumps
    // the size of a cell — that stepping is what made edges look blocky.
    const e0 = g.originE + 30
    const n0 = g.originN - 30
    const seen: number[] = []
    for (let d = 0; d < 20; d++) {
      const v = sampleGrid(g, e0 + d, n0)
      if (Number.isFinite(v)) seen.push(v)
    }
    expect(seen.length).toBeGreaterThan(10)
    expect(new Set(seen.map((v) => Math.round(v * 1000))).size).toBeGreaterThan(5)
  })

  it('returns NaN well outside the grid', () => {
    const g = idwGrid(SQUARE, lattice, { cellM: 20 })!
    expect(Number.isFinite(sampleGrid(g, g.originE - 5000, g.originN))).toBe(false)
  })
})

describe('matchFieldByGeometry', () => {
  const PIVOT_FIELD = { id: 'pivot', geometry: { PP_Longitude: '-111.6', PP_Latitude: '49.83', Radius: '400', use_bays: false } }
  const FAR_FIELD = { id: 'far', geometry: { PP_Longitude: '-110.0', PP_Latitude: '50.5', Radius: '400', use_bays: false } }
  const inPivot: SamplePoint[] = Array.from({ length: 20 }, (_, i) =>
    at(49.83 + (i % 5) * 0.0005, -111.6 + Math.floor(i / 5) * 0.0008, 5),
  )

  it('picks the field the points are actually inside', () => {
    // Matched by geometry, not name: imported sheets carry whatever field
    // names someone typed years ago.
    const m = matchFieldByGeometry([FAR_FIELD, PIVOT_FIELD], inPivot)!
    expect(m.fieldId).toBe('pivot')
    expect(m.fraction).toBeGreaterThan(0.9)
  })

  it('returns null when nothing contains the points', () => {
    // Clipping to the wrong field would silently discard most of the data,
    // which is worse than an approximate outline.
    expect(matchFieldByGeometry([FAR_FIELD], inPivot)).toBeNull()
  })

  it('respects the confidence threshold', () => {
    // Half in, half far away: not a convincing match.
    const half = [...inPivot.slice(0, 10), ...Array.from({ length: 10 }, () => at(50.5, -110.0, 5))]
    expect(matchFieldByGeometry([PIVOT_FIELD], half, 0.9)).toBeNull()
    expect(matchFieldByGeometry([PIVOT_FIELD], half, 0.4)).not.toBeNull()
  })

  it('ignores fields with no geometry, and handles no samples', () => {
    expect(matchFieldByGeometry([{ id: 'x' }], inPivot)).toBeNull()
    expect(matchFieldByGeometry([PIVOT_FIELD], [])).toBeNull()
  })
})
