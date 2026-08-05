/**
 * Correlation statistics for the season Analysis section.
 *
 * Ported from the "Leaf Bee Insights" Base44 app, where `calculatePearson` was
 * copy-pasted into five separate panels and each one re-parsed its inputs
 * inline. Here the parsing, the pairing and the maths are one tested unit.
 *
 * Three things this adds over the original, all of them about not being fooled
 * by the data:
 *
 *  • n travels WITH r. Yield is recorded for only 33 of 157 field-seasons, so a
 *    correlation against it rests on a fifth of the table. A bare r hides that;
 *    `Correlation` carries n so the UI can show it.
 *
 *  • Significance. The all-pairs matrix screens ~40 metrics — around 800 pairs.
 *    At n=33 a good handful of those clear |r| > 0.35 by chance alone, and the
 *    original ranked strictly by |r|, so noise floated to the top. `pValue` is
 *    the two-tailed probability of seeing an |r| this large from uncorrelated
 *    data, via the Fisher z-transform.
 *
 *  • Multiple comparisons. `holmThreshold` gives the corrected cutoff for a
 *    whole screen of correlations at once. Judging 800 pairs against p < 0.05
 *    means expecting ~40 false positives; that is the difference between
 *    "insight" and "noise with a chart".
 *
 * All functions are pure — no React, no DB, no fetching.
 */

/**
 * Smallest sample a correlation is reported for.
 *
 * Below about ten points the confidence interval on r spans nearly the whole
 * range, so the number carries no information — better to say "not enough
 * data" than to draw a confident-looking line through six dots.
 */
export const MIN_N = 10

/**
 * Fewer distinct values than this on either axis and the "correlation" is
 * really a two-group difference — a t-test wearing a scatter plot's clothes.
 */
export const MIN_DISTINCT = 3

/**
 * How much r may move when the single most influential point is dropped before
 * the result is called fragile. At 0.25, a correlation that collapses from
 * 0.69 to 0.40 on the loss of one field-season is flagged.
 */
export const MAX_JACKKNIFE_DELTA = 0.25

/** A correlation between two metrics, with everything needed to judge it. */
export interface Correlation {
  /** Pearson's r, in [-1, 1]. */
  r: number
  /** Field-seasons where BOTH metrics were recorded. */
  n: number
  /** Two-tailed p-value for r ≠ 0. Null when n is too small to estimate. */
  pValue: number | null
  /** Least-squares fit through the paired points. */
  slope: number
  intercept: number
  /** Fraction of variance explained (r²). */
  r2: number
  /** Distinct values on each axis — see `fragile`. */
  distinctX: number
  distinctY: number
  /**
   * Largest change in r from dropping any single point (leave-one-out).
   * Null when n is too small for the jackknife to mean anything.
   */
  jackknifeDelta: number | null
  /**
   * True when this r should not be read as a relationship, because it rests on
   * too little structure. Two ways that happens, both real in this data set:
   *
   *  • Not enough distinct values. In the 12 field-seasons that record yield,
   *    `sprayer_width`, `blocks_per_shelter`, `gals_per_acre` and
   *    `chalkbrood_sporulating` each take exactly TWO values — and so all four
   *    return an identical r = -0.689 against yield. That is one outlying
   *    season, reported four times as if it were four findings.
   *
   *  • One point carries the fit. Drop it and r moves more than
   *    MAX_JACKKNIFE_DELTA.
   *
   * Fragile correlations are still returned — hiding them would be its own
   * kind of lie — but the UI must mark them and must not rank them as leads.
   */
  fragile: boolean
}

/**
 * Read a metric off a raw row.
 *
 * The Supabase columns are numeric (migration 0014 cleans them on import), but
 * this also accepts the spreadsheet's own spellings — "69.52%", "-", "" — so
 * the same code can drive a preview of a CSV that has not been imported yet.
 *
 * A blank is null, never 0. Zero is a real, common reading for the incidence
 * metrics (most fields record 0.00% machine damage), so coercing blanks to 0
 * would quietly invent data points and drag every correlation toward them.
 */
export function parseMetric(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim().replace(/^'/, '').trim()
  if (s === '' || s === '-' || s.toLowerCase() === 'n/a') return null
  const n = parseFloat(s.replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Pair two metrics across rows, keeping only rows where BOTH are present.
 *
 * Pairwise deletion, not listwise: a row missing yield still contributes to
 * every correlation that does not involve yield. With this table's sparsity
 * pattern, dropping any row with a gap would leave almost nothing.
 */
export function pairedValues(
  rows: readonly Record<string, unknown>[],
  xKey: string,
  yKey: string,
): { xs: number[]; ys: number[] } {
  const xs: number[] = []
  const ys: number[] = []
  for (const row of rows) {
    const x = parseMetric(row[xKey])
    const y = parseMetric(row[yKey])
    if (x === null || y === null) continue
    xs.push(x)
    ys.push(y)
  }
  return { xs, ys }
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/** Sample standard deviation (n−1 denominator). 0 for fewer than two points. */
export function stdDev(values: readonly number[]): number {
  const n = values.length
  if (n < 2) return 0
  const m = mean(values)
  let sum = 0
  for (const v of values) sum += (v - m) ** 2
  return Math.sqrt(sum / (n - 1))
}

/**
 * Pearson's r. Null when there are fewer than two points, or when either
 * series is constant — a flat series has no variance to correlate, and the
 * original returned 0 there, which reads as "measured, no relationship"
 * rather than the truth, "undefined".
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let dx2 = 0
  let dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    num += dx * dy
    dx2 += dx * dx
    dy2 += dy * dy
  }
  if (dx2 === 0 || dy2 === 0) return null
  const r = num / Math.sqrt(dx2 * dy2)
  // Guard the endpoints against floating-point drift past ±1, which would make
  // atanh() in the p-value return Infinity.
  return Math.max(-1, Math.min(1, r))
}

/** Least-squares fit y = slope·x + intercept. Slope 0 if x is constant. */
export function linearRegression(
  xs: readonly number[],
  ys: readonly number[],
): { slope: number; intercept: number } {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return { slope: 0, intercept: n === 1 ? ys[0] : 0 }
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den === 0) return { slope: 0, intercept: my }
  const slope = num / den
  return { slope, intercept: my - slope * mx }
}

/**
 * Standard normal CDF, via the Abramowitz & Stegun 7.1.26 erf approximation
 * (|error| < 1.5e-7). Ample for deciding whether a correlation is worth a
 * second look; this is a screening tool, not a clinical trial.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Two-tailed p-value for r ≠ 0, using Fisher's z-transform:
 * atanh(r) is approximately normal with standard error 1/√(n−3).
 *
 * Needs n > 3; null below that.
 */
export function correlationPValue(r: number, n: number): number | null {
  if (!Number.isFinite(r) || n <= 3) return null
  if (Math.abs(r) >= 1) return 0
  const z = Math.atanh(r) * Math.sqrt(n - 3)
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))))
}

/**
 * Correlate two metrics across rows.
 *
 * Returns null rather than a zero-filled result when there is not enough
 * overlap — the caller shows "insufficient data", which is a different and
 * more honest statement than "r = 0".
 */
export function correlate(
  rows: readonly Record<string, unknown>[],
  xKey: string,
  yKey: string,
  minN: number = MIN_N,
): Correlation | null {
  const { xs, ys } = pairedValues(rows, xKey, yKey)
  if (xs.length < Math.max(2, minN)) return null
  const r = pearson(xs, ys)
  if (r === null) return null
  const { slope, intercept } = linearRegression(xs, ys)
  const n = xs.length
  const distinctX = new Set(xs).size
  const distinctY = new Set(ys).size
  const jackknifeDelta = jackknife(xs, ys, r)
  return {
    r,
    n,
    pValue: correlationPValue(r, n),
    slope,
    intercept,
    r2: r * r,
    distinctX,
    distinctY,
    jackknifeDelta,
    fragile:
      distinctX < MIN_DISTINCT ||
      distinctY < MIN_DISTINCT ||
      (jackknifeDelta !== null && jackknifeDelta > MAX_JACKKNIFE_DELTA),
  }
}

/**
 * Leave-one-out sensitivity: the largest amount r moves when any single point
 * is removed. O(n²), which is nothing at this table's size.
 *
 * Needs enough points that dropping one still leaves a meaningful sample;
 * below five, every correlation is trivially fragile and the number adds
 * nothing.
 */
function jackknife(xs: readonly number[], ys: readonly number[], r: number): number | null {
  const n = xs.length
  if (n < 5) return null
  let worst = 0
  for (let skip = 0; skip < n; skip++) {
    const sx: number[] = []
    const sy: number[] = []
    for (let i = 0; i < n; i++) {
      if (i === skip) continue
      sx.push(xs[i])
      sy.push(ys[i])
    }
    const without = pearson(sx, sy)
    // A subset that goes constant means this point was the only thing creating
    // variance — maximally fragile.
    if (without === null) return 2
    worst = Math.max(worst, Math.abs(r - without))
  }
  return worst
}

/**
 * Holm-Bonferroni cutoff for a family of correlations tested together.
 *
 * Returns the largest p-value that stays significant once the size of the
 * search is accounted for, or null if none do. Holm rather than plain
 * Bonferroni because it is uniformly more powerful at the same error rate —
 * with 800 pairs, flat Bonferroni (p < 0.0000625) rejects nearly everything
 * this data set could ever show.
 *
 * Sorted ascending, a p-value survives while p(i) ≤ alpha / (m − i).
 */
export function holmThreshold(pValues: readonly number[], alpha = 0.05): number | null {
  const ps = pValues.filter((p) => Number.isFinite(p)).sort((a, b) => a - b)
  const m = ps.length
  if (m === 0) return null
  let cutoff: number | null = null
  for (let i = 0; i < m; i++) {
    if (ps[i] <= alpha / (m - i)) cutoff = ps[i]
    else break
  }
  return cutoff
}

/** Plain-language strength label. Thresholds are conventional, not derived. */
export function correlationStrength(r: number): 'strong' | 'moderate' | 'weak' | 'negligible' {
  const a = Math.abs(r)
  if (a >= 0.7) return 'strong'
  if (a >= 0.5) return 'moderate'
  if (a >= 0.3) return 'weak'
  return 'negligible'
}
