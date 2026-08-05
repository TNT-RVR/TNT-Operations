import { describe, expect, it } from 'vitest'
import {
  METRICS,
  METRIC_BY_KEY,
  STORED_METRICS,
  WEATHER_METRICS,
  formatMetric,
  metricPairs,
} from './analysisMetrics'

describe('metric registry', () => {
  it('has no duplicate keys', () => {
    const keys = METRICS.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('splits cleanly into stored and derived', () => {
    expect(STORED_METRICS.length + WEATHER_METRICS.length).toBe(METRICS.length)
    expect(STORED_METRICS.every((m) => !m.derived)).toBe(true)
    expect(WEATHER_METRICS.every((m) => m.derived)).toBe(true)
  })

  it('indexes every metric by key', () => {
    for (const m of METRICS) expect(METRIC_BY_KEY[m.key]).toBe(m)
  })
})

describe('metricPairs', () => {
  it('pairs every recorded column with every other, for the stored scope', () => {
    const pairs = metricPairs('stored')
    const n = STORED_METRICS.length
    expect(pairs).toHaveLength((n * (n - 1)) / 2)
  })

  it('never includes a weather metric in the stored scope', () => {
    for (const [a, b] of metricPairs('stored')) {
      expect(a.derived).toBeFalsy()
      expect(b.derived).toBeFalsy()
    }
  })

  it('pairs each weather metric against each recorded column', () => {
    const pairs = metricPairs('weather-outcome')
    expect(pairs).toHaveLength(WEATHER_METRICS.length * STORED_METRICS.length)
  })

  it('never pairs weather against weather', () => {
    // The whole point of the scope. Average temperature against growing degree
    // days is near-tautological, and carrying those pairs through Holm makes
    // the correction stricter for every real weather-vs-outcome result.
    for (const [a, b] of metricPairs('weather-outcome')) {
      // Boolean(): `derived` is optional, so `true && undefined` is undefined.
      expect(Boolean(a.derived && b.derived)).toBe(false)
    }
  })

  it('puts exactly one weather metric in every weather-outcome pair', () => {
    for (const [a, b] of metricPairs('weather-outcome')) {
      expect([a.derived, b.derived].filter(Boolean)).toHaveLength(1)
    }
  })

  it('never pairs a metric with itself', () => {
    for (const scope of ['stored', 'weather-outcome'] as const) {
      for (const [a, b] of metricPairs(scope)) expect(a.key).not.toBe(b.key)
    }
  })

  it('lists each unordered pair once', () => {
    for (const scope of ['stored', 'weather-outcome'] as const) {
      const seen = new Set<string>()
      for (const [a, b] of metricPairs(scope)) {
        const key = [a.key, b.key].sort().join('|')
        expect(seen.has(key), `${key} appeared twice in ${scope}`).toBe(false)
        seen.add(key)
      }
    }
  })
})

describe('formatMetric', () => {
  it('renders a missing value as an em dash, never zero', () => {
    expect(formatMetric(null, 'live_prepupae')).toBe('—')
    expect(formatMetric(undefined, 'live_prepupae')).toBe('—')
    expect(formatMetric(NaN, 'live_prepupae')).toBe('—')
    expect(formatMetric(0, 'live_prepupae')).toBe('0.00%')
  })

  it('appends the metric unit', () => {
    expect(formatMetric(69.52, 'live_prepupae')).toBe('69.5%')
    // One decimal from 10 upward, two below it, none at 100+.
    expect(formatMetric(65, 'acres')).toBe('65.0 ac')
    expect(formatMetric(6.5, 'acres')).toBe('6.50 ac')
    expect(formatMetric(650, 'acres')).toBe('650 ac')
    expect(formatMetric(22, 'male_row_spacing')).toBe('22.0"')
    expect(formatMetric(14.2, 'avgTemp')).toBe('14.2 °C')
  })

  it('drops decimals on counts', () => {
    expect(formatMetric(3828, 'live_count')).toBe('3828')
    expect(formatMetric(130, 'num_structures')).toBe('130')
  })
})
