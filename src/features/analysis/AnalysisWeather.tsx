/**
 * Weather against season outcomes.
 *
 * Consolidates four Base44 panels (WeatherAnalysis, WeatherComparison,
 * WeatherCorrelation, WeatherFieldCorrelation) that each fetched Open-Meteo
 * independently, inside render, per field. Here the fetch is requested once via
 * the data seam, cached server-side, and the four views share it.
 *
 * Weather is joined on lat/lng, so field-seasons without coordinates carry no
 * weather metrics and drop out of these correlations — which is why the sample
 * sizes here are smaller than on the Correlations screen.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { CloudSun } from 'lucide-react'
import { Card, PageHeader, Stat } from '@/components/ui'
import { useData } from '@/data/context'
import {
  METRIC_GROUP_LABELS,
  STORED_METRICS,
  WEATHER_METRICS,
  formatMetric,
  METRIC_BY_KEY,
} from '@/domain/analysisMetrics'
import { correlate, parseMetric } from '@/domain/stats'
import { AnalysisProvider, useAnalysis, useCompanyIndex } from './useAnalysis'
import { useCorrelationScreen, withWeather } from './useCorrelations'
import {
  CorrelationStats,
  FilterBar,
  MetricSelect,
  NotEnoughData,
  VerdictBadge,
  VerdictNote,
  verdictFor,
} from './AnalysisChrome'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, seriesColor } from './chartTheme'

const WEATHER_OPTIONS = WEATHER_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
  group: METRIC_GROUP_LABELS[m.group],
}))

const OUTCOME_OPTIONS = STORED_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
  group: METRIC_GROUP_LABELS[m.group],
}))

function Weather() {
  const { rows, loading, allRows } = useAnalysis()
  const { fieldWeather, loadFieldWeather } = useData()
  const companyIndex = useCompanyIndex()
  const [xKey, setXKey] = useState('flightHours')
  const [yKey, setYKey] = useState('percent_return')

  // Ask once for every field-season in view; the provider dedupes by grid cell.
  useEffect(() => {
    if (allRows.length === 0) return
    void loadFieldWeather(allRows.map((r) => ({ lat: r.lat, lng: r.lng, year: r.year })))
  }, [allRows, loadFieldWeather])

  const joined = useMemo(() => withWeather(rows, fieldWeather), [rows, fieldWeather])
  const screen = useCorrelationScreen(joined, true)

  const withCoords = rows.filter((r) => r.lat !== null && r.lng !== null).length
  const haveWeather = Object.keys(fieldWeather).length > 0

  const points = useMemo(
    () =>
      joined
        .map((r) => {
          const x = parseMetric(r[xKey])
          const y = parseMetric(r[yKey])
          if (x === null || y === null) return null
          return {
            x,
            y,
            name: String(r.field_name ?? ''),
            year: String(r.year ?? ''),
            company: String(r.company ?? ''),
          }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [joined, xKey, yKey],
  )

  const selected = useMemo(() => correlate(joined, xKey, yKey), [joined, xKey, yKey])
  const verdict = selected ? verdictFor(xKey, yKey, selected, screen.holmCutoff) : null

  const weatherLeads = screen.leads.filter(
    (p) => METRIC_BY_KEY[p.xKey]?.derived || METRIC_BY_KEY[p.yKey]?.derived,
  )

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>
  if (rows.length === 0) {
    return (
      <div>
        <PageHeader title="Weather" />
        <FilterBar />
        <NotEnoughData what="weather analysis" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Weather"
        subtitle="Season weather from Open-Meteo (1 April – 30 September), against how the fields performed."
      />
      <FilterBar />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Fields with coordinates"
          value={withCoords}
          unit={`/ ${rows.length}`}
          tone={withCoords < rows.length ? 'warn' : 'default'}
          hint={withCoords < rows.length ? 'The rest carry no weather' : undefined}
        />
        <Stat label="Weather cells cached" value={Object.keys(fieldWeather).length} />
        <Stat label="Weather leads" value={weatherLeads.length} hint="Survived correction" />
      </div>

      {!haveWeather ? (
        <Card>
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <CloudSun size={16} /> Fetching season weather…
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <MetricSelect label="Weather metric" value={xKey} onChange={setXKey} options={WEATHER_OPTIONS} />
              <MetricSelect label="Outcome" value={yKey} onChange={setYKey} options={OUTCOME_OPTIONS} />
              {verdict && (
                <div className="ml-auto pb-1.5">
                  <VerdictBadge verdict={verdict} />
                </div>
              )}
            </div>

            {!selected ? (
              <p className="py-10 text-center text-sm text-muted">
                Fewer than 10 field-seasons have both a coordinate and this outcome recorded.
              </p>
            ) : (
              <>
                <CorrelationStats c={selected} />
                {verdict && <VerdictNote verdict={verdict} />}
                <div className="mt-4 h-[380px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 36, left: 8 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis
                        {...AXIS_PROPS}
                        type="number"
                        dataKey="x"
                        domain={['dataMin', 'dataMax']}
                        label={{
                          value: METRIC_BY_KEY[xKey]?.label ?? xKey,
                          position: 'insideBottom',
                          offset: -24,
                          fill: 'var(--text-muted)',
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        {...AXIS_PROPS}
                        type="number"
                        dataKey="y"
                        domain={['dataMin', 'dataMax']}
                        width={60}
                        label={{
                          value: METRIC_BY_KEY[yKey]?.label ?? yKey,
                          angle: -90,
                          position: 'insideLeft',
                          fill: 'var(--text-muted)',
                          fontSize: 11,
                        }}
                      />
                      <ZAxis range={[70, 70]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-default)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const p = payload[0].payload as (typeof points)[number]
                          return (
                            <div style={TOOLTIP_STYLE} className="px-2.5 py-2">
                              <div className="font-medium text-primary">{p.name}</div>
                              <div className="text-muted">
                                {p.year} · {p.company}
                              </div>
                              <div className="mt-1 font-mono tabular-nums text-secondary">
                                {METRIC_BY_KEY[xKey]?.label}: {formatMetric(p.x, xKey)}
                              </div>
                              <div className="font-mono tabular-nums text-secondary">
                                {METRIC_BY_KEY[yKey]?.label}: {formatMetric(p.y, yKey)}
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Scatter data={points} isAnimationActive={false}>
                        {points.map((p, i) => (
                          <Cell
                            key={i}
                            fill={seriesColor(companyIndex(p.company))}
                            fillOpacity={0.85}
                            stroke="var(--bg-raised)"
                            strokeWidth={2}
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-secondary">
              Weather leads
            </h2>
            <p className="mb-3 text-xs text-muted">
              Pairs involving a weather metric that survived correction across all{' '}
              {screen.tested} screened.
            </p>
            {weatherLeads.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                No weather metric correlates with an outcome strongly enough to stand out from{' '}
                {screen.tested} comparisons. Given six seasons of data, that is the expected result
                rather than a surprising one.
              </p>
            ) : (
              <ul className="divide-y divide-subtle">
                {weatherLeads.map((p) => (
                  <li key={`${p.xKey}|${p.yKey}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <button
                      type="button"
                      className="text-left text-sm text-primary hover:text-brand"
                      onClick={() => {
                        const weatherFirst = METRIC_BY_KEY[p.xKey]?.derived
                        setXKey(weatherFirst ? p.xKey : p.yKey)
                        setYKey(weatherFirst ? p.yKey : p.xKey)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      {p.xLabel} <span className="text-muted">vs</span> {p.yLabel}
                    </button>
                    <CorrelationStats c={p.correlation} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default function AnalysisWeather() {
  return (
    <AnalysisProvider>
      <Weather />
    </AnalysisProvider>
  )
}
