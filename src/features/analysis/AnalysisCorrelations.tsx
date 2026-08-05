/**
 * Correlations — one pair at a time (scatter + trendline), and the full screen
 * of every pair.
 *
 * The scatter is the Base44 `ScatterWithAnalysis` panel rebuilt on our tokens,
 * with two changes: points are coloured by company from a stable index (so
 * filtering doesn't repaint them) and the trendline is only drawn when the
 * correlation is something other than arithmetic — a best-fit line through two
 * halves of the same total is a drawing, not a model.
 */

import { useMemo, useState } from 'react'
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
  ReferenceLine,
} from 'recharts'
import { Card, PageHeader } from '@/components/ui'
import { METRICS, METRIC_GROUP_LABELS, formatMetric, unitSuffix, METRIC_BY_KEY } from '@/domain/analysisMetrics'
import { correlate, parseMetric } from '@/domain/stats'
import { AnalysisProvider, useAnalysis, useCompanyIndex } from './useAnalysis'
import { useCorrelationScreen, type ScreenedPair } from './useCorrelations'
import {
  AiNote,
  CorrelationStats,
  FilterBar,
  MetricSelect,
  NotEnoughData,
  VerdictBadge,
  VerdictNote,
  verdictFor,
} from './AnalysisChrome'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, seriesColor, MAX_SERIES } from './chartTheme'

const PICKER_OPTIONS = METRICS.filter((m) => !m.derived).map((m) => ({
  key: m.key,
  label: m.label,
  group: METRIC_GROUP_LABELS[m.group],
}))

function Correlations() {
  const { rows, loading, allRows } = useAnalysis()
  const companyIndex = useCompanyIndex()
  const [xKey, setXKey] = useState('shelters_per_acre')
  const [yKey, setYKey] = useState('live_prepupae')
  const [showAll, setShowAll] = useState(false)

  const screen = useCorrelationScreen(rows as unknown as Record<string, unknown>[], false)

  const points = useMemo(
    () =>
      rows
        .map((r) => {
          const x = parseMetric(r[xKey as keyof typeof r])
          const y = parseMetric(r[yKey as keyof typeof r])
          if (x === null || y === null) return null
          return { x, y, name: r.field_name, year: r.year, company: r.company }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [rows, xKey, yKey],
  )

  const selected = useMemo(
    () => correlate(rows as unknown as Record<string, unknown>[], xKey, yKey),
    [rows, xKey, yKey],
  )
  const verdict = selected ? verdictFor(xKey, yKey, selected, screen.holmCutoff) : null

  // Companies present, in stable order, capped so no hue is ever reused.
  const legend = useMemo(() => {
    const present = [...new Set(points.map((p) => p.company).filter(Boolean))]
    return present
      .map((c) => ({ company: c, index: companyIndex(c) }))
      .sort((a, b) => a.index - b.index)
      .slice(0, MAX_SERIES)
  }, [points, companyIndex])

  const legendKeys = new Set(legend.map((l) => l.company))

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>

  const xUnit = unitSuffix(METRIC_BY_KEY[xKey]?.unit ?? 'ratio')
  const yUnit = unitSuffix(METRIC_BY_KEY[yKey]?.unit ?? 'ratio')

  return (
    <div>
      <PageHeader
        title="Correlations"
        subtitle="Pick two metrics, or screen every pair at once. Every result carries its sample size."
      />
      <FilterBar />

      {rows.length === 0 ? (
        <NotEnoughData what="correlations" />
      ) : (
        <>
          <Card className="mb-4">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <MetricSelect label="X axis" value={xKey} onChange={setXKey} options={PICKER_OPTIONS} />
              <MetricSelect label="Y axis" value={yKey} onChange={setYKey} options={PICKER_OPTIONS} />
              {verdict && (
                <div className="ml-auto pb-1.5">
                  <VerdictBadge verdict={verdict} />
                </div>
              )}
            </div>

            {!selected ? (
              <p className="py-10 text-center text-sm text-muted">
                Fewer than 10 field-seasons record both of these. Not enough to say anything.
              </p>
            ) : (
              <>
                <CorrelationStats c={selected} />
                {verdict && <VerdictNote verdict={verdict} />}
                {verdict && (
                  <AiNote
                    xLabel={METRIC_BY_KEY[xKey]?.label ?? xKey}
                    yLabel={METRIC_BY_KEY[yKey]?.label ?? yKey}
                    correlation={selected}
                    verdict={verdict}
                  />
                )}

                <div className="mt-4 h-[420px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 40, left: 8 }}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis
                        {...AXIS_PROPS}
                        type="number"
                        dataKey="x"
                        name={METRIC_BY_KEY[xKey]?.label}
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v: number) => `${v}${xUnit}`}
                        label={{
                          value: METRIC_BY_KEY[xKey]?.label ?? xKey,
                          position: 'insideBottom',
                          offset: -28,
                          fill: 'var(--text-muted)',
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        {...AXIS_PROPS}
                        type="number"
                        dataKey="y"
                        name={METRIC_BY_KEY[yKey]?.label}
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v: number) => `${v}${yUnit}`}
                        width={64}
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
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
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

                      {/*
                        A fit line is a claim that one moves with the other. It is
                        suppressed for arithmetic pairs, where the line is real but
                        says only that a total is a total.
                      */}
                      {verdict?.kind !== 'definitional' && points.length > 1 && (
                        <ReferenceLine
                          segment={[
                            {
                              x: Math.min(...points.map((p) => p.x)),
                              y: selected.intercept + selected.slope * Math.min(...points.map((p) => p.x)),
                            },
                            {
                              x: Math.max(...points.map((p) => p.x)),
                              y: selected.intercept + selected.slope * Math.max(...points.map((p) => p.x)),
                            },
                          ]}
                          stroke="var(--text-muted)"
                          strokeDasharray="5 4"
                          strokeWidth={2}
                          ifOverflow="extendDomain"
                        />
                      )}

                      <Scatter data={points} isAnimationActive={false}>
                        {points.map((p, i) => (
                          <Cell
                            key={i}
                            fill={legendKeys.has(p.company) ? seriesColor(companyIndex(p.company)) : 'var(--text-muted)'}
                            fillOpacity={0.85}
                            stroke="var(--bg-raised)"
                            strokeWidth={2}
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {legend.map((l) => (
                    <span key={l.company} className="inline-flex items-center gap-1.5 text-xs text-secondary">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-pill"
                        style={{ background: seriesColor(l.index) }}
                      />
                      {l.company}
                    </span>
                  ))}
                  {legend.length < new Set(points.map((p) => p.company)).size && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-pill"
                        style={{ background: 'var(--text-muted)' }}
                      />
                      Other
                    </span>
                  )}
                </div>
              </>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">
                Every pair ({screen.tested})
              </h2>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                  className="accent-[color:var(--brand)]"
                />
                Show arithmetic and fragile results
              </label>
            </div>
            <PairTable
              pairs={showAll ? screen.pairs : screen.pairs.filter((p) => p.verdict.kind === 'lead' || p.verdict.kind === 'weak')}
              onPick={(p) => {
                setXKey(p.xKey)
                setYKey(p.yKey)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          </Card>
        </>
      )}
    </div>
  )
}

function PairTable({ pairs, onPick }: { pairs: ScreenedPair[]; onPick: (p: ScreenedPair) => void }) {
  if (pairs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">Nothing to show with the current filters.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th text-left">Pair</th>
            <th className="th text-right">r</th>
            <th className="th text-right">n</th>
            <th className="th text-right">p</th>
            <th className="th text-left">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {pairs.slice(0, 200).map((p) => (
            <tr
              key={`${p.xKey}|${p.yKey}`}
              className="cursor-pointer border-t border-subtle transition hover:bg-[color:var(--hover-wash)]"
              onClick={() => onPick(p)}
            >
              <td className="px-2 py-2 text-secondary">
                {p.xLabel} <span className="text-muted">vs</span> {p.yLabel}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-primary">
                {p.correlation.r >= 0 ? '+' : ''}
                {p.correlation.r.toFixed(3)}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">{p.correlation.n}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">
                {p.correlation.pValue === null
                  ? '—'
                  : p.correlation.pValue < 0.001
                    ? p.correlation.pValue.toExponential(1)
                    : p.correlation.pValue.toFixed(3)}
              </td>
              <td className="px-2 py-2">
                <VerdictBadge verdict={p.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pairs.length > 200 && (
        <p className="mt-2 text-xs text-muted">
          Showing the first 200 of {pairs.length}. Narrow the filters to see the rest.
        </p>
      )}
    </div>
  )
}

export default function AnalysisCorrelations() {
  return (
    <AnalysisProvider>
      <Correlations />
    </AnalysisProvider>
  )
}
