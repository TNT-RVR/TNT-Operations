import { describe, expect, it } from 'vitest'
import {
  MAX_JACKKNIFE_DELTA,
  MIN_DISTINCT,
  MIN_N,
  correlate,
  correlationPValue,
  correlationStrength,
  holmThreshold,
  linearRegression,
  mean,
  pairedValues,
  parseMetric,
  pearson,
  stdDev,
} from './stats'

describe('parseMetric', () => {
  it('reads plain numbers', () => {
    expect(parseMetric(69.52)).toBe(69.52)
    expect(parseMetric('69.52')).toBe(69.52)
    expect(parseMetric(0)).toBe(0)
    expect(parseMetric(-3.5)).toBe(-3.5)
  })

  it("strips the spreadsheet's percent sign", () => {
    expect(parseMetric('69.52%')).toBe(69.52)
    expect(parseMetric('35%')).toBe(35)
    expect(parseMetric('0.00%')).toBe(0)
  })

  it("treats the export's missing-value markers as missing", () => {
    expect(parseMetric('')).toBeNull()
    expect(parseMetric('-')).toBeNull()
    expect(parseMetric(null)).toBeNull()
    expect(parseMetric(undefined)).toBeNull()
    expect(parseMetric('N/A')).toBeNull()
  })

  it("strips Excel's text-prefix apostrophe", () => {
    // 13 columns of the real export carry "'-" rather than "-".
    expect(parseMetric("'-")).toBeNull()
    expect(parseMetric("'22")).toBe(22)
  })

  it('does not coerce a blank to zero', () => {
    // 0.00% is a real, common reading; a blank is not one. Conflating them
    // would invent data points and drag correlations toward them.
    expect(parseMetric('')).not.toBe(0)
    expect(parseMetric('0.00%')).toBe(0)
  })

  it('rejects non-numeric text and non-finite numbers', () => {
    expect(parseMetric('Seed Canola')).toBeNull()
    expect(parseMetric(NaN)).toBeNull()
    expect(parseMetric(Infinity)).toBeNull()
  })

  it('handles thousands separators', () => {
    expect(parseMetric('3,828')).toBe(3828)
  })
})

describe('pairedValues', () => {
  const rows = [
    { a: 1, b: 10 },
    { a: 2, b: null },
    { a: '-', b: 30 },
    { a: 4, b: '40%' },
  ]

  it('keeps only rows where both metrics are present', () => {
    expect(pairedValues(rows, 'a', 'b')).toEqual({ xs: [1, 4], ys: [10, 40] })
  })

  it('deletes pairwise, not listwise', () => {
    // Row 2 lacks `b` but still counts toward an a-vs-c correlation.
    const sparse = [
      { a: 1, b: 10, c: 100 },
      { a: 2, b: null, c: 200 },
    ]
    expect(pairedValues(sparse, 'a', 'c').xs).toHaveLength(2)
    expect(pairedValues(sparse, 'a', 'b').xs).toHaveLength(1)
  })

  it('returns empty arrays when no rows overlap', () => {
    expect(pairedValues([{ a: 1 }, { b: 2 }], 'a', 'b')).toEqual({ xs: [], ys: [] })
  })
})

describe('mean / stdDev', () => {
  it('averages', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(mean([])).toBe(0)
  })

  it('uses the sample (n-1) denominator', () => {
    // Population sd of [2,4,4,4,5,5,7,9] is 2; the sample sd is larger.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4)
    expect(stdDev([5])).toBe(0)
    expect(stdDev([])).toBe(0)
  })
})

describe('pearson', () => {
  it('is +1 for a perfect increasing line', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10)
  })

  it('is -1 for a perfect decreasing line', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10)
  })

  it('matches a hand-computed value', () => {
    // x=[1,2,3,4,5], y=[2,4,5,4,5] → r = 0.7745966692...
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.774597, 5)
  })

  it('is null — not zero — when a series is constant', () => {
    // A flat series has no variance to correlate. The Base44 original returned
    // 0 here, which reads as "measured, no relationship" rather than undefined.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull()
    expect(pearson([1, 2, 3, 4], [7, 7, 7, 7])).toBeNull()
  })

  it('is null below two points', () => {
    expect(pearson([1], [2])).toBeNull()
    expect(pearson([], [])).toBeNull()
  })

  it('stays within [-1, 1]', () => {
    const r = pearson([1e-9, 2e-9, 3e-9], [1e9, 2e9, 3e9])
    expect(r).not.toBeNull()
    expect(r!).toBeLessThanOrEqual(1)
    expect(r!).toBeGreaterThanOrEqual(-1)
  })
})

describe('linearRegression', () => {
  it('recovers a known line exactly', () => {
    const { slope, intercept } = linearRegression([1, 2, 3, 4], [3, 5, 7, 9])
    expect(slope).toBeCloseTo(2, 10)
    expect(intercept).toBeCloseTo(1, 10)
  })

  it('falls back to a flat line through the mean when x is constant', () => {
    expect(linearRegression([5, 5, 5], [1, 2, 3])).toEqual({ slope: 0, intercept: 2 })
  })
})

describe('correlationPValue', () => {
  it('is tiny for a strong correlation on a decent sample', () => {
    const p = correlationPValue(0.9, 50)
    expect(p).not.toBeNull()
    expect(p!).toBeLessThan(0.0001)
  })

  it('is near 1 for no correlation', () => {
    expect(correlationPValue(0, 50)).toBeCloseTo(1, 6)
  })

  it('demands a bigger r from a smaller sample', () => {
    // The same r is far less convincing at n=12 than at n=120 — the whole
    // reason yield correlations (n=33) need to be read differently.
    const small = correlationPValue(0.4, 12)!
    const large = correlationPValue(0.4, 120)!
    expect(small).toBeGreaterThan(large)
    expect(small).toBeGreaterThan(0.05)
    expect(large).toBeLessThan(0.05)
  })

  it('is null when n is too small to estimate', () => {
    expect(correlationPValue(0.9, 3)).toBeNull()
    expect(correlationPValue(0.9, 0)).toBeNull()
  })

  it('is 0 for a perfect correlation', () => {
    expect(correlationPValue(1, 20)).toBe(0)
    expect(correlationPValue(-1, 20)).toBe(0)
  })
})

describe('correlate', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    x: i,
    y: 2 * i + 1,
    sparse: i < 4 ? i : null,
  }))

  it('returns r, n, p and the fit together', () => {
    const c = correlate(rows, 'x', 'y')
    expect(c).not.toBeNull()
    expect(c!.r).toBeCloseTo(1, 10)
    expect(c!.n).toBe(20)
    expect(c!.r2).toBeCloseTo(1, 10)
    expect(c!.slope).toBeCloseTo(2, 10)
    expect(c!.intercept).toBeCloseTo(1, 10)
  })

  it('counts only the overlapping rows in n', () => {
    // `sparse` is present on 4 rows, mirroring how yield is present on 33/157.
    expect(pairedValues(rows, 'x', 'sparse').xs).toHaveLength(4)
  })

  it('returns null rather than a fake zero below MIN_N', () => {
    const c = correlate(rows, 'x', 'sparse')
    expect(c).toBeNull()
  })

  it('honours an explicit lower minN', () => {
    const c = correlate(rows, 'x', 'sparse', 3)
    expect(c).not.toBeNull()
    expect(c!.n).toBe(4)
  })

  it('defaults to MIN_N', () => {
    expect(MIN_N).toBe(10)
    const nine = Array.from({ length: 9 }, (_, i) => ({ x: i, y: i * 3 }))
    expect(correlate(nine, 'x', 'y')).toBeNull()
    expect(correlate([...nine, { x: 9, y: 27 }], 'x', 'y')).not.toBeNull()
  })

  it('parses percent strings straight off a raw CSV row', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({
      live_prepupae: `${50 + i}.00%`,
      parasites: `${i}.50%`,
    }))
    const c = correlate(raw, 'live_prepupae', 'parasites')
    expect(c).not.toBeNull()
    expect(c!.n).toBe(12)
    expect(c!.r).toBeCloseTo(1, 8)
  })
})

describe('correlate — fragility guards', () => {
  it('flags a two-value axis as fragile', () => {
    // The real case: across the 12 field-seasons that record yield,
    // sprayer_width takes only {120, 230}. Four such columns all returned an
    // identical r = -0.689 against yield — one outlying season, reported four
    // times as if it were four separate findings.
    const rows = [
      ...Array.from({ length: 11 }, () => ({ width: 120, yield: 40 + Math.random() })),
      { width: 230, yield: 20 },
    ]
    const c = correlate(rows, 'width', 'yield')
    expect(c).not.toBeNull()
    expect(c!.distinctX).toBe(2)
    expect(c!.fragile).toBe(true)
  })

  it('flags a correlation that one point creates', () => {
    // Ten points with no relationship, plus one far-out leverage point.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ x: i % 5, y: (i * 7) % 5 })),
      { x: 100, y: 100 },
    ]
    const c = correlate(rows, 'x', 'y')
    expect(c).not.toBeNull()
    expect(c!.r).toBeGreaterThan(0.9)
    expect(c!.jackknifeDelta).toBeGreaterThan(MAX_JACKKNIFE_DELTA)
    expect(c!.fragile).toBe(true)
  })

  it('does not flag a broad, stable relationship', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      x: i,
      y: 2 * i + ((i * 13) % 7) - 3,
    }))
    const c = correlate(rows, 'x', 'y')
    expect(c).not.toBeNull()
    expect(c!.distinctX).toBeGreaterThanOrEqual(MIN_DISTINCT)
    expect(c!.jackknifeDelta!).toBeLessThan(MAX_JACKKNIFE_DELTA)
    expect(c!.fragile).toBe(false)
  })

  it('reports distinct counts per axis', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ x: i, y: i % 2 }))
    const c = correlate(rows, 'x', 'y')
    expect(c!.distinctX).toBe(12)
    expect(c!.distinctY).toBe(2)
    expect(c!.fragile).toBe(true) // y is binary
  })

  it('skips the jackknife below five points', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ x: i, y: i * 2 }))
    const c = correlate(rows, 'x', 'y', 3)
    expect(c!.jackknifeDelta).toBeNull()
  })

  it('still returns the fragile result rather than hiding it', () => {
    // Suppressing them would be its own distortion — the UI marks them.
    const rows = [
      ...Array.from({ length: 11 }, () => ({ a: 1, b: 5 })),
      { a: 2, b: 9 },
    ]
    const c = correlate(rows, 'a', 'b')
    expect(c).not.toBeNull()
    expect(c!.fragile).toBe(true)
  })
})

describe('holmThreshold', () => {
  it('is stricter than raw alpha for a large family', () => {
    // 800 pairs is the real size of the all-pairs screen.
    const ps = Array.from({ length: 800 }, (_, i) => (i + 1) / 800)
    const cutoff = holmThreshold(ps, 0.05)
    expect(cutoff === null || cutoff < 0.05).toBe(true)
  })

  it('accepts a clearly significant leader', () => {
    const cutoff = holmThreshold([1e-9, 0.4, 0.6, 0.9], 0.05)
    expect(cutoff).toBe(1e-9)
  })

  it('sorts before stepping, so input order does not matter', () => {
    const cutoff = holmThreshold([0.04, 0.9, 0.001], 0.05)
    // Sorted: [0.001, 0.04, 0.9]. Only 0.001 clears its slot (0.05/3), and
    // 0.04 fails the next one (0.05/2), so the family stops there.
    expect(cutoff).toBe(0.001)
    expect(holmThreshold([0.001, 0.04, 0.9], 0.05)).toBe(0.001)
  })

  it('stops at the first failure rather than scanning past it', () => {
    // Holm is a step-DOWN procedure: the smallest p must clear alpha/m or the
    // whole family is rejected, however many later p-values look small.
    expect(holmThreshold([0.03, 0.031, 0.032], 0.05)).toBeNull()
  })

  it('returns null for an empty family', () => {
    expect(holmThreshold([], 0.05)).toBeNull()
  })
})

describe('correlationStrength', () => {
  it('labels by magnitude, ignoring direction', () => {
    expect(correlationStrength(0.85)).toBe('strong')
    expect(correlationStrength(-0.85)).toBe('strong')
    expect(correlationStrength(0.55)).toBe('moderate')
    expect(correlationStrength(-0.35)).toBe('weak')
    expect(correlationStrength(0.1)).toBe('negligible')
  })
})
