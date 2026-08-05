/**
 * The all-pairs correlation screen, computed once and shared.
 *
 * Over the real data this is ~473 testable pairs from 157 rows — trivial work,
 * but it runs on every filter change and feeds three screens, so it is memoised
 * in one place rather than recomputed per panel (which is what the Base44
 * version did, in each of five panels, with slightly different metric lists).
 *
 * The output is deliberately opinionated about ORDER: leads first, then weak
 * results, then fragile ones, then arithmetic. Ranking by |r| — the original's
 * only sort — puts the four strongest artifacts at the top of the page.
 */

import { useMemo } from 'react'
import { correlate, holmThreshold, type Correlation } from '@/domain/stats'
import { metricPairs, type MetricDef, type PairScope } from '@/domain/analysisMetrics'
import type { FieldAnalysis, FieldWeather } from '@/data/types'
import { weatherKey } from '@/domain/weather'
import { verdictFor, type Verdict } from './AnalysisChrome'

export interface ScreenedPair {
  xKey: string
  yKey: string
  xLabel: string
  yLabel: string
  correlation: Correlation
  verdict: Verdict
}

export interface CorrelationScreen {
  pairs: ScreenedPair[]
  leads: ScreenedPair[]
  /** The Holm cutoff for this family of tests, or null if nothing survives. */
  holmCutoff: number | null
  /** How many pairs were testable at all (both metrics present on ≥ MIN_N rows). */
  tested: number
  counts: { lead: number; weak: number; fragile: number; definitional: number }
}

const VERDICT_ORDER: Record<Verdict['kind'], number> = {
  lead: 0,
  weak: 1,
  fragile: 2,
  definitional: 3,
}

/**
 * Join weather metrics onto each row so they can be correlated alongside the
 * stored columns. Rows without coordinates simply have no weather keys, which
 * `pairedValues` then skips.
 */
export function withWeather(
  rows: readonly FieldAnalysis[],
  weather: Record<string, FieldWeather>,
): Record<string, unknown>[] {
  if (Object.keys(weather).length === 0) return rows as unknown as Record<string, unknown>[]
  return rows.map((r) => {
    if (r.lat === null || r.lng === null) return r as unknown as Record<string, unknown>
    const w = weather[weatherKey(r.lat, r.lng, r.year)]
    if (!w) return r as unknown as Record<string, unknown>
    return {
      ...r,
      avgTemp: w.avgTemp,
      maxTemp: w.maxTemp,
      minTemp: w.minTemp,
      totalPrecip: w.totalPrecip,
      avgWind: w.avgWind,
      growingDegreeDays: w.growingDegreeDays,
      rainDays: w.rainDays,
      flightHours: w.flightHours,
    }
  })
}

/**
 * Screen the pairs for a scope.
 *
 * The scope is not cosmetic: it defines the family of tests the Holm correction
 * runs over, so it changes which results are called significant. See
 * `metricPairs` in domain/analysisMetrics.ts for why weather-against-weather is
 * excluded rather than merely hidden.
 */
export function useCorrelationScreen(
  rows: readonly Record<string, unknown>[],
  scope: PairScope,
): CorrelationScreen {
  return useMemo(() => {
    const raw: Array<{ x: MetricDef; y: MetricDef; c: Correlation }> = []
    for (const [x, y] of metricPairs(scope)) {
      const c = correlate(rows, x.key, y.key)
      if (c) raw.push({ x, y, c })
    }

    // Correct across everything actually tested. Including the definitional
    // pairs here is deliberate: they were screened, so they count toward the
    // size of the search even though they will be labelled and set aside.
    const cutoff = holmThreshold(
      raw.map((p) => p.c.pValue).filter((p): p is number => p !== null),
    )

    const pairs: ScreenedPair[] = raw.map(({ x, y, c }) => ({
      xKey: x.key,
      yKey: y.key,
      xLabel: x.label,
      yLabel: y.label,
      correlation: c,
      verdict: verdictFor(x.key, y.key, c, cutoff),
    }))

    pairs.sort((a, b) => {
      const byVerdict = VERDICT_ORDER[a.verdict.kind] - VERDICT_ORDER[b.verdict.kind]
      if (byVerdict !== 0) return byVerdict
      return Math.abs(b.correlation.r) - Math.abs(a.correlation.r)
    })

    const counts = { lead: 0, weak: 0, fragile: 0, definitional: 0 }
    for (const p of pairs) counts[p.verdict.kind]++

    return {
      pairs,
      leads: pairs.filter((p) => p.verdict.kind === 'lead'),
      holmCutoff: cutoff,
      tested: pairs.length,
      counts,
    }
  }, [rows, scope])
}
