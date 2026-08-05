/**
 * Analysis overview — what the season data says, before anyone goes digging.
 *
 * The Base44 app opened on a map. That looks impressive and answers nothing:
 * the question this data exists to answer is "what should we do differently",
 * so the landing screen leads with the correlations that survived screening and
 * says plainly how many did not.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge, Card, PageHeader, Stat } from '@/components/ui'
import { formatMetric } from '@/domain/analysisMetrics'
import { mean, parseMetric } from '@/domain/stats'
import { AnalysisProvider, useAnalysis } from './useAnalysis'
import { useCorrelationScreen } from './useCorrelations'
import { CorrelationStats, FilterBar, NotEnoughData } from './AnalysisChrome'

function Overview() {
  const { rows, loading, allRows } = useAnalysis()
  const screen = useCorrelationScreen(rows as unknown as Record<string, unknown>[], false)

  if (loading && allRows.length === 0) {
    return <p className="text-muted">Loading season data…</p>
  }

  const avg = (key: string) => {
    const values = rows.map((r) => parseMetric(r[key as keyof typeof r])).filter((v): v is number => v !== null)
    return values.length ? mean(values) : null
  }

  const seasons = new Set(rows.map((r) => r.year)).size
  const withYield = rows.filter((r) => r.yield_per_acre !== null).length

  return (
    <div>
      <PageHeader
        title="Analysis"
        subtitle="Season data across every field we pollinate — what correlates, and what only looks like it does."
      />

      <FilterBar />

      {rows.length === 0 ? (
        <NotEnoughData what="the overview" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Field-seasons" value={rows.length} hint={`${seasons} season${seasons === 1 ? '' : 's'}`} />
            <Stat
              label="Average live prepupae"
              value={avg('live_prepupae')?.toFixed(1) ?? '—'}
              unit="%"
              hint="Healthy fraction of returned cocoons"
            />
            <Stat
              label="Average return"
              value={avg('percent_return')?.toFixed(1) ?? '—'}
              unit="%"
              hint="Gallons back over gallons out"
            />
            <Stat
              label="Yield recorded"
              value={withYield}
              unit={`/ ${rows.length}`}
              tone={withYield < rows.length / 2 ? 'warn' : 'default'}
              hint={withYield < rows.length / 2 ? 'Too sparse to correlate against' : undefined}
            />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <ScreenCount label="Leads" value={screen.counts.lead} tone="brand" />
            <ScreenCount label="Not significant" value={screen.counts.weak} tone="neutral" />
            <ScreenCount label="Fragile" value={screen.counts.fragile} tone="amber" />
            <ScreenCount label="Arithmetic" value={screen.counts.definitional} tone="neutral" />
          </div>

          <Card className="mb-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary">
                Strongest leads
              </h2>
              <Link to="/analysis/correlations" className="inline-flex items-center gap-1 text-xs text-brand">
                All {screen.tested} pairs <ArrowRight size={13} />
              </Link>
            </div>

            {screen.leads.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Nothing clears significance once the {screen.tested} pairs screened are accounted
                for. That is a real answer, not a missing one — with this many comparisons, a
                handful of strong-looking numbers is what chance produces.
              </p>
            ) : (
              <ul className="divide-y divide-subtle">
                {screen.leads.slice(0, 6).map((p) => (
                  <li key={`${p.xKey}|${p.yKey}`} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm text-primary">
                        {p.correlation.r > 0 ? (
                          <TrendingUp size={15} style={{ color: 'var(--ok-fg)' }} />
                        ) : (
                          <TrendingDown size={15} style={{ color: 'var(--danger-fg)' }} />
                        )}
                        {p.xLabel} <span className="text-muted">vs</span> {p.yLabel}
                      </span>
                      <CorrelationStats c={p.correlation} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-secondary">
              How to read this
            </h2>
            <p className="text-sm text-secondary">
              Screening {screen.tested} metric pairs at once means a few will clear an ordinary
              significance test by luck alone. Everything above is corrected for that (Holm), so a
              &ldquo;lead&rdquo; is a pair worth investigating rather than a pair that happened to
              line up. Two further categories are set aside rather than hidden:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-secondary">
              <li>
                <Badge tone="neutral">Arithmetic</Badge> — related by definition. The x-ray grading
                percentages sum to 100, so they must trade against each other; return % is computed
                from gallons returned. Strong r, no information.
              </li>
              <li>
                <Badge tone="amber">Fragile</Badge> — the result rests on one or two field-seasons,
                or on a column that only takes two values across the rows being compared.
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

function ScreenCount({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'brand' | 'amber' | 'neutral'
}) {
  const color =
    tone === 'brand' ? 'var(--text-brand)' : tone === 'amber' ? 'var(--warn-fg)' : 'var(--text-muted)'
  return (
    <Card>
      <div className="label mb-1">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </Card>
  )
}

export default function AnalysisHome() {
  return (
    <AnalysisProvider>
      <Overview />
    </AnalysisProvider>
  )
}

/** Re-exported so sibling screens can format consistently. */
export { formatMetric }
