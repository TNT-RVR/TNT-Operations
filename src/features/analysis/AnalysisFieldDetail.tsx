/**
 * One field-season in full: the grading breakdown, the operation's numbers, the
 * timeline, and how this season compares to the same field's other years.
 *
 * The Base44 detail page led with a cocoon photo and an AI colour analysis.
 * Both are dropped — `cocoon_image_url`, `xray_image_url`, `color_analysis` and
 * `color_analysis_summary` are empty on all 157 exported rows, so those panels
 * had never displayed anything.
 */

import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, PageHeader, Stat } from '@/components/ui'
import { COMPOSITION_MEMBERS } from '@/domain/analysisRelations'
import { METRIC_BY_KEY, formatMetric } from '@/domain/analysisMetrics'
import { AnalysisProvider, useAnalysis } from './useAnalysis'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE, seriesColor } from './chartTheme'

/** Fields shown in the operation grid, in the order a grower would read them. */
const OPERATION_KEYS = [
  'acres',
  'num_structures',
  'shelters_per_acre',
  'blocks_per_shelter',
  'gallons_put_out',
  'gallons_returned',
  'gals_per_acre',
  'pounds',
  'live_count',
  'planting_pattern',
  'male_rows',
  'female_rows',
  'male_row_spacing',
  'female_row_spacing',
  'sprayer_width',
  'seeding_angle',
] as const

const TIMELINE_KEYS = [
  ['seeding_date', 'Seeded'],
  ['predicted_flower_date', 'Predicted flower'],
  ['actual_bee_release', 'Bees out'],
  ['bees_brought_back_in', 'Bees in'],
] as const

function Detail() {
  const { id } = useParams<{ id: string }>()
  const { allRows, loading } = useAnalysis()

  const row = allRows.find((r) => r.id === id)

  // The same physical field across seasons, for the trend chart.
  const history = useMemo(
    () =>
      row
        ? allRows
            .filter((r) => r.field_name === row.field_name)
            .sort((a, b) => a.year.localeCompare(b.year))
        : [],
    [allRows, row],
  )

  const grading = useMemo(() => {
    if (!row) return []
    return COMPOSITION_MEMBERS.map((key) => ({
      key,
      label: METRIC_BY_KEY[key]?.label ?? key,
      value: (row[key as keyof typeof row] as number | null) ?? null,
    })).filter((g) => g.value !== null && g.value > 0)
  }, [row])

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>

  if (!row) {
    return (
      <div>
        <PageHeader title="Field not found" />
        <Card>
          <p className="text-secondary">
            No season row with that id.{' '}
            <Link to="/analysis/fields" className="text-brand underline">
              Back to fields
            </Link>
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <Link
        to="/analysis/fields"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-primary"
      >
        <ArrowLeft size={13} /> All fields
      </Link>

      <PageHeader
        title={row.field_name}
        subtitle={[row.year, row.company, row.crop, row.farmer_name].filter(Boolean).join(' · ')}
        actions={
          <span className="flex flex-wrap gap-1">
            {row.hail_damage && <Badge tone="red">Hail</Badge>}
            {row.bad_recording && <Badge tone="amber">Mis-recorded</Badge>}
            {row.experimental && <Badge tone="blue">Trial</Badge>}
          </span>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live prepupae" value={row.live_prepupae?.toFixed(2) ?? '—'} unit="%" />
        <Stat label="Return" value={row.percent_return?.toFixed(1) ?? '—'} unit="%" />
        <Stat label="Live count" value={row.live_count?.toLocaleString() ?? '—'} />
        <Stat
          label="Yield per acre"
          value={row.yield_per_acre?.toFixed(1) ?? '—'}
          unit={row.yield_per_acre === null ? undefined : 'kg'}
          hint={row.yield_per_acre === null ? 'Not recorded this season' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-secondary">
            X-ray grading
          </h2>
          <p className="mb-3 text-xs text-muted">
            These shares sum to 100% — one rising means another falling.
          </p>
          {grading.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No grading recorded.</p>
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grading} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                  <XAxis {...AXIS_PROPS} type="number" tickFormatter={(v: number) => `${v}%`} />
                  <YAxis {...AXIS_PROPS} type="category" dataKey="label" width={150} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover-wash)' }}
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [`${Number(v).toFixed(2)}%`, '']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {grading.map((g, i) => (
                      <Cell
                        key={g.key}
                        fill={g.key === 'live_prepupae' ? 'var(--data-honey)' : seriesColor(1 + (i % 4))}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-secondary">
              Operation
            </h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {OPERATION_KEYS.map((key) => {
                const raw = row[key as keyof typeof row]
                const isNumber = typeof raw === 'number'
                return (
                  <div key={key} className="flex items-baseline justify-between gap-2 border-b border-subtle pb-1">
                    <dt className="text-muted">{METRIC_BY_KEY[key]?.label ?? key.replace(/_/g, ' ')}</dt>
                    <dd className="tabular-nums text-secondary">
                      {isNumber ? formatMetric(raw, key) : (raw as string) || '—'}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-secondary">
              Timeline
            </h2>
            <dl className="space-y-2 text-sm">
              {TIMELINE_KEYS.map(([key, label]) => (
                <div key={key} className="flex items-baseline justify-between gap-2 border-b border-subtle pb-1">
                  <dt className="text-muted">{label}</dt>
                  <dd className="tabular-nums text-secondary">
                    {(row[key] as string | null) ?? '—'}
                  </dd>
                </div>
              ))}
            </dl>
            {row.notes && (
              <p className="mt-3 rounded-sm bg-inset p-2 text-sm text-secondary">{row.notes}</p>
            )}
          </Card>
        </div>
      </div>

      {history.length > 1 && (
        <Card className="mt-4">
          <h2 className="mb-3 text-sm font-semibold text-secondary">
            This field across seasons
          </h2>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis {...AXIS_PROPS} dataKey="year" />
                <YAxis {...AXIS_PROPS} tickFormatter={(v: number) => `${v}%`} width={48} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name]}
                />
                <Bar dataKey="live_prepupae" name="Live prepupae" fill="var(--data-honey)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="percent_return" name="Return" fill="var(--data-teal)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <span className="inline-block h-2.5 w-2.5 rounded-pill" style={{ background: 'var(--data-honey)' }} />
              Live prepupae
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-secondary">
              <span className="inline-block h-2.5 w-2.5 rounded-pill" style={{ background: 'var(--data-teal)' }} />
              Return
            </span>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function AnalysisFieldDetail() {
  return (
    <AnalysisProvider>
      <Detail />
    </AnalysisProvider>
  )
}
