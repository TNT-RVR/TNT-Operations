/**
 * Growers and companies — who we work with, and how their fields perform.
 *
 * Merges the Base44 `Growers` and `Companies` pages, which were the same table
 * grouped by a different column.
 *
 * The ranking deliberately shows n beside every average. A grower with one
 * field-season at 78% live prepupae is not "our best grower"; they are one
 * data point. The original ranked on the mean alone, so a single good season
 * topped the table over someone with six consistent ones.
 */

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, PageHeader, Select, Stat } from '@/components/ui'
import { METRIC_BY_KEY, METRIC_GROUP_LABELS, STORED_METRICS, formatMetric } from '@/domain/analysisMetrics'
import { mean, parseMetric, stdDev } from '@/domain/stats'
import { AnalysisProvider, useAnalysis, useCompanyIndex } from './useAnalysis'
import { FilterBar, MetricSelect, NotEnoughData, StatLink } from './AnalysisChrome'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, seriesColor } from './chartTheme'

const METRIC_OPTIONS = STORED_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
  group: METRIC_GROUP_LABELS[m.group],
}))

/**
 * Below this many field-seasons an average is shown but never ranked as
 * meaningful — one season is an anecdote.
 */
const RELIABLE_N = 3

type GroupBy = 'farmer_name' | 'company' | 'crop' | 'variety_code'

const GROUP_LABELS: Record<GroupBy, string> = {
  farmer_name: 'Grower',
  company: 'Company',
  crop: 'Crop',
  variety_code: 'Variety',
}

interface GroupStat {
  name: string
  n: number
  avg: number | null
  sd: number
  reliable: boolean
}

function Growers() {
  const { rows, loading, allRows } = useAnalysis()
  const companyIndex = useCompanyIndex()
  const [groupBy, setGroupBy] = useState<GroupBy>('farmer_name')
  const [metricKey, setMetricKey] = useState('live_prepupae')

  const groups = useMemo<GroupStat[]>(() => {
    const buckets = new Map<string, number[]>()
    for (const r of rows) {
      const name = (r[groupBy] as string) || '—'
      const v = parseMetric(r[metricKey as keyof typeof r])
      const list = buckets.get(name) ?? []
      if (v !== null) list.push(v)
      buckets.set(name, list)
    }
    return [...buckets.entries()]
      .map(([name, values]) => ({
        name,
        n: values.length,
        avg: values.length ? mean(values) : null,
        sd: stdDev(values),
        reliable: values.length >= RELIABLE_N,
      }))
      .filter((g) => g.avg !== null)
      .sort((a, b) => {
        // Reliable groups rank first; within each band, by average.
        if (a.reliable !== b.reliable) return a.reliable ? -1 : 1
        return (b.avg ?? 0) - (a.avg ?? 0)
      })
  }, [rows, groupBy, metricKey])

  const higherIsBetter = METRIC_BY_KEY[metricKey]?.higherIsBetter
  const reliable = groups.filter((g) => g.reliable)

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>

  return (
    <div>
      <PageHeader
        title="Growers & companies"
        subtitle="Season averages by who grew it, who bought it, and what was planted."
      />
      <FilterBar />

      {rows.length === 0 ? (
        <NotEnoughData what="this breakdown" />
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="label">Group by</span>
                <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  {(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => (
                    <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                  ))}
                </Select>
              </label>
              <MetricSelect label="Metric" value={metricKey} onChange={setMetricKey} options={METRIC_OPTIONS} />
              <div className="ml-auto pb-1.5 text-xs text-muted">
                {reliable.length} of {groups.length} have {RELIABLE_N}+ seasons
              </div>
            </div>
          </Card>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatLink
              to="/analysis/fields"
              label={`${GROUP_LABELS[groupBy]}s`}
              value={groups.length}
              hint="See every field-season"
            />
            <StatLink
              to={`/analysis/fields?sort=${metricKey}`}
              label="Best average"
              value={reliable[0]?.avg?.toFixed(1) ?? '—'}
              hint={
                reliable[0]
                  ? `${reliable[0].name} — ${reliable[0].n} field-seasons`
                  : 'None with enough seasons'
              }
            />
            <Stat
              label="Spread"
              value={
                reliable.length > 1
                  ? `${(Math.max(...reliable.map((g) => g.avg ?? 0)) - Math.min(...reliable.map((g) => g.avg ?? 0))).toFixed(1)}`
                  : '—'
              }
              hint="Between the reliable groups"
            />
          </div>

          <Card className="mb-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-secondary">
              {METRIC_BY_KEY[metricKey]?.label} by {GROUP_LABELS[groupBy].toLowerCase()}
            </h2>
            <div style={{ height: Math.max(220, groups.length * 28 + 40) }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={groups} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                  <XAxis {...AXIS_PROPS} type="number" />
                  <YAxis {...AXIS_PROPS} type="category" dataKey="name" width={160} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover-wash)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const g = payload[0].payload as GroupStat
                      return (
                        <div style={TOOLTIP_STYLE} className="px-2.5 py-2">
                          <div className="font-medium text-primary">{g.name}</div>
                          <div className="mt-1 font-mono tabular-nums text-secondary">
                            {formatMetric(g.avg, metricKey)} average
                          </div>
                          <div className="text-muted">
                            {g.n} field-season{g.n === 1 ? '' : 's'}
                            {!g.reliable && ' — too few to rank'}
                          </div>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="avg" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {groups.map((g) => (
                      <Cell
                        key={g.name}
                        fill={groupBy === 'company' ? seriesColor(companyIndex(g.name)) : 'var(--data-honey)'}
                        // Unreliable groups are drawn faint rather than hidden:
                        // they exist, they just cannot be ranked against.
                        fillOpacity={g.reliable ? 0.9 : 0.35}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">
              Faded bars have fewer than {RELIABLE_N} field-seasons — shown for completeness, but an
              average over one or two seasons is not a comparison.
            </p>
          </Card>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">{GROUP_LABELS[groupBy]}</th>
                    <th className="th text-right">Field-seasons</th>
                    <th className="th text-right">Average</th>
                    <th className="th text-right">Standard deviation</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.name} className="border-t border-subtle">
                      <td className="px-2 py-2 text-secondary">
                        {g.name}
                        {/* Leading space, not just the margin — otherwise a
                            screen reader runs the name into the marker. */}
                        {!g.reliable && (
                          <span className="ml-2 text-xs text-muted">
                            {' '}
                            — under {RELIABLE_N} seasons
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted">{g.n}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-primary">
                        {formatMetric(g.avg, metricKey)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted">
                        {g.n > 1 ? g.sd.toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {higherIsBetter === undefined && (
              <p className="mt-3 text-xs text-muted">
                Higher is not necessarily better for {METRIC_BY_KEY[metricKey]?.label.toLowerCase()} —
                read the ordering as a ranking, not a scoreboard.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default function AnalysisGrowers() {
  return (
    <AnalysisProvider>
      <Growers />
    </AnalysisProvider>
  )
}
