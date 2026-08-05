/**
 * Shared furniture for the Analysis screens: the filter bar, the correlation
 * verdict card, and the "not enough data" state.
 *
 * The verdict card is the piece that matters. The Base44 original rendered a
 * correlation as a number and a colour — bigger |r| meant a bolder green — so
 * an artifact of arithmetic (r = -1.000 between % female and % male) looked
 * like the strongest finding in the operation. Here every r arrives with n, a
 * significance verdict, and, where one applies, the reason it is not a finding.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Calculator, Check, Info, Sparkles } from 'lucide-react'
import { Badge, Card, Select } from '@/components/ui'
import { correlationStrength, type Correlation } from '@/domain/stats'
import { metricRelation } from '@/domain/analysisRelations'
import { METRIC_BY_KEY } from '@/domain/analysisMetrics'
import { useAnalysis } from './useAnalysis'

export function metricLabel(key: string): string {
  return METRIC_BY_KEY[key]?.label ?? key
}

/** Year / company / crop pickers plus the exclusion toggles, in one row. */
export function FilterBar() {
  const { filters, setFilter, years, companies, crops, rows, allRows, excludedCount } = useAnalysis()

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Season</span>
          <Select value={filters.year} onChange={(e) => setFilter('year', e.target.value)}>
            <option value="all">All seasons</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Company</span>
          <Select value={filters.company} onChange={(e) => setFilter('company', e.target.value)}>
            <option value="all">All companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Crop</span>
          <Select value={filters.crop} onChange={(e) => setFilter('crop', e.target.value)}>
            <option value="all">All crops</option>
            {crops.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="label">Exclude</span>
          <div className="flex flex-wrap gap-3 pb-1.5">
            <ToggleChip
              label="Hail"
              checked={filters.excludeHail}
              onChange={(v) => setFilter('excludeHail', v)}
            />
            <ToggleChip
              label="Mis-recorded"
              checked={filters.excludeBadRecording}
              onChange={(v) => setFilter('excludeBadRecording', v)}
            />
            <ToggleChip
              label="Experimental"
              checked={filters.excludeExperimental}
              onChange={(v) => setFilter('excludeExperimental', v)}
            />
          </div>
        </div>

        <div className="ml-auto pb-1.5 text-xs text-muted">
          <span className="font-mono tabular-nums text-secondary">{rows.length}</span> of{' '}
          <span className="font-mono tabular-nums">{allRows.length}</span> field-seasons
          {excludedCount > 0 && <> · {excludedCount} excluded</>}
        </div>
      </div>
    </Card>
  )
}

function ToggleChip({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs transition"
      style={{
        background: checked ? 'var(--brand-subtle)' : 'var(--chip-bg)',
        color: checked ? 'var(--text-brand)' : 'var(--text-muted)',
        border: `1px solid ${checked ? 'var(--brand-bd)' : 'var(--border-subtle)'}`,
      }}
    >
      {checked ? <Check size={12} /> : <span className="inline-block h-3 w-3" />}
      {label}
    </button>
  )
}

/**
 * The verdict on one correlation.
 *
 * Order matters here: a definitional pair is reported as arithmetic REGARDLESS
 * of how strong it is, because "r = 0.97" and "these are the same measurement"
 * are not competing facts — the second one settles it.
 */
export type Verdict =
  | { kind: 'definitional'; reason: string }
  | { kind: 'fragile'; reason: string }
  | { kind: 'lead' }
  | { kind: 'weak' }

export function verdictFor(
  xKey: string,
  yKey: string,
  c: Correlation,
  holmCutoff: number | null,
): Verdict {
  const relation = metricRelation(xKey, yKey)
  if (relation) return { kind: 'definitional', reason: relation.reason }

  if (c.fragile) {
    const reason =
      c.distinctX < 3 || c.distinctY < 3
        ? `One of these takes only ${Math.min(c.distinctX, c.distinctY)} distinct values across these ${c.n} seasons, so this is a two-group difference rather than a trend.`
        : 'Dropping a single field-season moves r substantially — one point is carrying this result.'
    return { kind: 'fragile', reason }
  }

  const significant = holmCutoff !== null && c.pValue !== null && c.pValue <= holmCutoff
  if (significant && correlationStrength(c.r) !== 'negligible') return { kind: 'lead' }
  return { kind: 'weak' }
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  switch (verdict.kind) {
    case 'definitional':
      return <Badge tone="neutral">Arithmetic</Badge>
    case 'fragile':
      return <Badge tone="amber">Fragile</Badge>
    case 'lead':
      return <Badge tone="brand">Lead</Badge>
    default:
      return <Badge tone="neutral">Not significant</Badge>
  }
}

/** One line of plain English explaining the verdict. */
export function VerdictNote({ verdict }: { verdict: Verdict }) {
  if (verdict.kind === 'lead') return null
  const Icon =
    verdict.kind === 'definitional' ? Calculator : verdict.kind === 'fragile' ? AlertTriangle : Info
  const text =
    verdict.kind === 'weak'
      ? 'Not distinguishable from chance once the number of pairs screened is accounted for.'
      : verdict.reason
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/** r, n and p as a compact readout. */
export function CorrelationStats({ c }: { c: Correlation }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="font-mono text-2xl font-semibold tabular-nums text-primary">
        {c.r >= 0 ? '+' : ''}
        {c.r.toFixed(3)}
      </span>
      <span className="text-xs text-muted">
        n = <span className="font-mono tabular-nums text-secondary">{c.n}</span>
      </span>
      <span className="text-xs text-muted">
        r² = <span className="font-mono tabular-nums text-secondary">{c.r2.toFixed(2)}</span>
      </span>
      {c.pValue !== null && (
        <span className="text-xs text-muted">
          p ={' '}
          <span className="font-mono tabular-nums text-secondary">
            {c.pValue < 0.001 ? c.pValue.toExponential(1) : c.pValue.toFixed(3)}
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * On-demand plain-English note from Claude, via `netlify/functions/analysis-ai`.
 *
 * Deliberately opt-in per correlation rather than generated on render. The
 * Base44 version fired an LLM call automatically whenever a panel mounted —
 * on the all-pairs screen that meant a model call for something nobody had
 * asked about yet, every time the filters changed.
 *
 * The computed verdict is sent along, so the model explains a result rather
 * than judging one.
 */
export function AiNote({
  xLabel,
  yLabel,
  correlation,
  verdict,
}: {
  xLabel: string
  yLabel: string
  correlation: Correlation
  verdict: Verdict
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const ask = async () => {
    setState('loading')
    setError('')
    try {
      const res = await fetch('/.netlify/functions/analysis-ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          xLabel,
          yLabel,
          r: correlation.r,
          n: correlation.n,
          pValue: correlation.pValue,
          verdict: verdict.kind,
          verdictReason: 'reason' in verdict ? verdict.reason : undefined,
        }),
      })
      const data = (await res.json()) as { note?: string; error?: string }
      if (!res.ok || !data.note) {
        setError(data.error ?? 'Could not get a note.')
        setState('error')
        return
      }
      setNote(data.note)
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the model.')
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div className="mt-3 rounded-sm bg-inset p-3">
        <div className="label mb-1.5 flex items-center gap-1.5">
          <Sparkles size={12} /> Reading
        </div>
        <p className="whitespace-pre-wrap text-sm text-secondary">{note}</p>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={ask}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted transition hover:bg-[color:var(--hover-wash)] hover:text-primary disabled:opacity-60"
      >
        <Sparkles size={12} />
        {state === 'loading' ? 'Reading…' : 'Ask Claude to read this'}
      </button>
      {state === 'error' && <p className="mt-1 text-xs" style={{ color: 'var(--danger-fg)' }}>{error}</p>}
    </div>
  )
}

/** Shown when a section has no rows to work with. */
export function NotEnoughData({ what = 'this view' }: { what?: string }) {
  const { allRows } = useAnalysis()
  return (
    <Card>
      <div className="py-8 text-center">
        <p className="text-secondary">Not enough data for {what}.</p>
        {allRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No season rows have been imported yet.{' '}
            <Link to="/analysis/upload" className="text-brand underline">
              Upload a season sheet
            </Link>
            .
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Try widening the season or company filter, or turning off an exclusion.
          </p>
        )}
      </div>
    </Card>
  )
}

/**
 * Metric picker grouped by kind. Weather metrics are offered only where the
 * caller has loaded weather, so a picker never lists something that will plot
 * empty.
 */
export function MetricSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly { key: string; label: string; group: string }[]
  label: string
}) {
  const grouped = useMemo(() => {
    const out = new Map<string, typeof options>()
    for (const o of options) {
      const list = (out.get(o.group) ?? []) as typeof options
      out.set(o.group, [...list, o] as typeof options)
    }
    return [...out.entries()]
  }, [options])

  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {grouped.map(([group, items]) => (
          <optgroup key={group} label={group}>
            {items.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </Select>
    </label>
  )
}
