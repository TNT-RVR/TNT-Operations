/**
 * Every field-season as a sortable, searchable table, with CSV export.
 *
 * Sorting is null-last in both directions on purpose. Yield is recorded on
 * about a fifth of rows, so a plain ascending sort on it would open with a
 * screen of blanks and bury every field that actually has a number.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Download, X } from 'lucide-react'
import { Badge, Button, Card, PageHeader, SearchBar, matchesQuery } from '@/components/ui'
import { METRIC_BY_KEY, formatMetric } from '@/domain/analysisMetrics'
import type { FieldAnalysis } from '@/data/types'
import { AnalysisProvider, useAnalysis } from './useAnalysis'
import { FilterBar, NotEnoughData } from './AnalysisChrome'

interface Column {
  key: keyof FieldAnalysis
  label: string
  numeric?: boolean
  metric?: boolean
}

const COLUMNS: Column[] = [
  { key: 'field_name', label: 'Field' },
  { key: 'year', label: 'Season' },
  { key: 'company', label: 'Company' },
  { key: 'crop', label: 'Crop' },
  { key: 'acres', label: 'Acres', numeric: true, metric: true },
  { key: 'num_structures', label: 'Shelters', numeric: true, metric: true },
  { key: 'live_prepupae', label: 'Live prepupae', numeric: true, metric: true },
  { key: 'pollen_balls', label: 'Pollen balls', numeric: true, metric: true },
  { key: 'parasites', label: 'Parasites', numeric: true, metric: true },
  { key: 'percent_return', label: 'Return', numeric: true, metric: true },
  { key: 'yield_per_acre', label: 'Yield per acre', numeric: true, metric: true },
]

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function Fields() {
  const { rows, loading, allRows } = useAnalysis()
  const [query, setQuery] = useState('')
  // Arriving from an Overview tile: `?sort=` opens ranked by that metric,
  // `?has=` narrows to the rows that actually recorded it. In the URL rather
  // than in state so the drill-down can be linked to.
  const [searchParams, setSearchParams] = useSearchParams()
  const requiredMetric = searchParams.get('has')
  const [sortKey, setSortKey] = useState<keyof FieldAnalysis>(
    (searchParams.get('sort') as keyof FieldAnalysis) ?? 'year',
  )
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const filtered = useMemo(() => {
    let out = rows
    if (requiredMetric) {
      out = out.filter((r) => {
        const v = r[requiredMetric as keyof FieldAnalysis]
        return v !== null && v !== undefined && v !== ''
      })
    }
    return out.filter((r) =>
      matchesQuery(query, r.field_name, r.company, r.crop, r.farmer_name, r.year, r.field_id),
    )
  }, [rows, query, requiredMetric])

  const sorted = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      // Nulls always sink, whichever way the column is sorted — a blank is not
      // a small number, and burying the recorded values would be worse.
      const aNull = av === null || av === undefined || av === ''
      const bNull = bv === null || bv === undefined || bv === ''
      if (aNull && bNull) return 0
      if (aNull) return 1
      if (bNull) return -1
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return dir === 'asc' ? cmp : -cmp
    })
    return out
  }, [filtered, sortKey, dir])

  const toggleSort = (key: keyof FieldAnalysis) => {
    if (key === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('desc')
    }
  }

  const exportCsv = () => {
    const header = COLUMNS.map((c) => c.label)
    const lines = [
      header.join(','),
      ...sorted.map((r) => COLUMNS.map((c) => csvEscape(r[c.key])).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tnt-field-analysis-${sorted.length}-rows.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>

  return (
    <div>
      <PageHeader
        title="Fields"
        subtitle="Every field-season on record."
        actions={
          <Button onClick={exportCsv} disabled={sorted.length === 0}>
            <Download size={15} /> Export CSV
          </Button>
        }
      />
      <FilterBar />

      <Card className="mb-3">
        <SearchBar value={query} onChange={setQuery} placeholder="Search field, company, farmer, LLD…" />
        {requiredMetric && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            Showing only field-seasons that recorded{' '}
            <span className="text-secondary">
              {METRIC_BY_KEY[requiredMetric]?.label ?? requiredMetric}
            </span>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex items-center gap-1 text-brand"
            >
              <X size={11} /> show all
            </button>
          </p>
        )}
      </Card>

      {sorted.length === 0 ? (
        <NotEnoughData what="this list" />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={String(c.key)}
                      className={`th cursor-pointer select-none ${c.numeric ? 'text-right' : 'text-left'}`}
                      onClick={() => toggleSort(c.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortKey === c.key &&
                          (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </span>
                    </th>
                  ))}
                  <th className="th text-left">Flags</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-subtle transition hover:bg-[color:var(--hover-wash)]">
                    <td className="px-2 py-2">
                      <Link to={`/analysis/fields/${r.id}`} className="text-primary hover:text-brand">
                        {r.field_name}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-secondary">{r.year}</td>
                    <td className="px-2 py-2 text-secondary">{r.company}</td>
                    <td className="px-2 py-2 text-secondary">{r.crop}</td>
                    {COLUMNS.filter((c) => c.metric).map((c) => (
                      <td key={String(c.key)} className="px-2 py-2 text-right tabular-nums text-secondary">
                        {formatMetric(r[c.key] as number | null, String(c.key))}
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.hail_damage && <Badge tone="red">Hail</Badge>}
                        {r.bad_recording && <Badge tone="amber">Mis-recorded</Badge>}
                        {r.experimental && <Badge tone="blue">Trial</Badge>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            {sorted.length} row{sorted.length === 1 ? '' : 's'}
            {query && ` matching “${query}”`}
          </p>
        </Card>
      )}
    </div>
  )
}

export default function AnalysisFields() {
  return (
    <AnalysisProvider>
      <Fields />
    </AnalysisProvider>
  )
}
