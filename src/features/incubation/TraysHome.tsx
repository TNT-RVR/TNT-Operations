import { useMemo, useState, useEffect } from 'react'
import { PageHeader, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import type { Tray } from '@/data/types'

const PAGE_SIZE = 50
const num = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 })
const ALL = '__all__'

type SortKey = 'trayNumber' | 'sample' | 'incubator' | 'status' | 'weightLbs' | 'liveCount'
type SortDir = 'asc' | 'desc'
interface Column {
  key: SortKey
  label: string
  align?: 'right'
  numeric?: boolean
}
const COLUMNS: Column[] = [
  { key: 'trayNumber', label: 'Tray' },
  { key: 'sample', label: 'Sample' },
  { key: 'incubator', label: 'Incubator' },
  { key: 'status', label: 'Status' },
  { key: 'weightLbs', label: 'Weight (lb)', align: 'right', numeric: true },
  { key: 'liveCount', label: 'Live count', align: 'right', numeric: true },
]

/** Quote a CSV field only when needed. */
const csvCell = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function TraysHome() {
  const { trays, incubators, samples } = useData()

  const incubatorName = useMemo(() => new Map(incubators.map((i) => [i.id, i.name])), [incubators])
  const sampleName = useMemo(() => new Map(samples.map((s) => [s.id, s.name])), [samples])
  const statuses = useMemo(() => [...new Set(trays.map((t) => t.status))].sort(), [trays])

  const [search, setSearch] = useState('')
  const [incId, setIncId] = useState(ALL)
  const [sampleId, setSampleId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('trayNumber')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Reset to the first page whenever a filter or sort changes.
  useEffect(() => setPage(1), [search, incId, sampleId, status, sortKey, sortDir])

  const sortValue = (t: Tray): string | number | null => {
    switch (sortKey) {
      case 'trayNumber':
        return t.trayNumber
      case 'sample':
        return (t.sampleId && sampleName.get(t.sampleId)) || ''
      case 'incubator':
        return (t.incubatorId && incubatorName.get(t.incubatorId)) || ''
      case 'status':
        return t.status
      case 'weightLbs':
        return t.weightLbs
      case 'liveCount':
        return t.liveCount
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = trays.filter((t) => {
      if (incId !== ALL && t.incubatorId !== incId) return false
      if (sampleId !== ALL && t.sampleId !== sampleId) return false
      if (status !== ALL && t.status !== status) return false
      if (q && !t.trayNumber.toLowerCase().includes(q)) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      const av = sortValue(a)
      const bv = sortValue(b)
      // nulls/blanks always sort last, regardless of direction
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trays, search, incId, sampleId, status, sortKey, sortDir, sampleName, incubatorName])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function exportCsv() {
    const header = ['Tray', 'Sample', 'Incubator', 'Status', 'Weight (lb)', 'Live count', 'In date', 'Out date', 'Cool date']
    const lines = filtered.map((t) =>
      [
        t.trayNumber,
        (t.sampleId && sampleName.get(t.sampleId)) || '',
        (t.incubatorId && incubatorName.get(t.incubatorId)) || '',
        t.status,
        t.weightLbs ?? '',
        t.liveCount ?? '',
        t.inDate ?? '',
        t.outDate ?? '',
        t.coolDate ?? '',
      ]
        .map(csvCell)
        .join(','),
    )
    const csv = [header.map(csvCell).join(','), ...lines].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trays-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm'

  return (
    <div>
      <PageHeader title="Trays" subtitle="Every incubation tray — filter to narrow the list" />
      <div className="space-y-4 p-4 md:p-6">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Search tray #</span>
            <input
              className="input w-40"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. 1487"
            />
          </label>
          <label className="block">
            <span className="label">Incubator</span>
            <select className={selectCls} value={incId} onChange={(e) => setIncId(e.target.value)}>
              <option value={ALL}>All incubators</option>
              {incubators.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Sample</span>
            <select className={selectCls} value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
              <option value={ALL}>All samples</option>
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Status</span>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={ALL}>All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {(search || incId !== ALL || sampleId !== ALL || status !== ALL) && (
            <button
              className="btn-ghost"
              onClick={() => {
                setSearch('')
                setIncId(ALL)
                setSampleId(ALL)
                setStatus(ALL)
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Count + export + pager */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <div className="flex items-center gap-3">
            <span>
              {filtered.length === trays.length
                ? `${num(trays.length)} trays`
                : `${num(filtered.length)} of ${num(trays.length)} trays`}
            </span>
            <button className="btn-ghost px-2 py-1" onClick={exportCsv} disabled={filtered.length === 0}>
              ⬇ Export CSV
            </button>
          </div>
          {pageCount > 1 && <Pager page={clampedPage} pageCount={pageCount} onPage={setPage} />}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState>No trays match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`cursor-pointer select-none px-3 py-2 hover:text-slate-700 ${
                        c.align === 'right' ? 'text-right' : ''
                      }`}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      <span className="ml-1 inline-block w-3 text-slate-400">
                        {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((t) => (
                  <TrayRow key={t.id} tray={t} incubatorName={incubatorName} sampleName={sampleName} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex justify-end">
            <Pager page={clampedPage} pageCount={pageCount} onPage={setPage} />
          </div>
        )}
      </div>
    </div>
  )
}

function TrayRow({
  tray: t,
  incubatorName,
  sampleName,
}: {
  tray: Tray
  incubatorName: Map<string, string>
  sampleName: Map<string, string>
}) {
  return (
    <tr>
      <td className="px-3 py-1.5 font-medium text-slate-800">{t.trayNumber}</td>
      <td className="px-3 py-1.5 text-slate-500">{t.sampleId ? sampleName.get(t.sampleId) ?? '—' : '—'}</td>
      <td className="px-3 py-1.5 text-slate-500">{t.incubatorId ? incubatorName.get(t.incubatorId) ?? '—' : '—'}</td>
      <td className="px-3 py-1.5 text-slate-500">{t.status}</td>
      <td className="px-3 py-1.5 text-right">{num(t.weightLbs)}</td>
      <td className="px-3 py-1.5 text-right">{num(t.liveCount)}</td>
    </tr>
  )
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span className="text-xs text-slate-500">
        Page {page} of {pageCount}
      </span>
      <button
        className="btn-ghost px-2 py-1 disabled:opacity-40"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </div>
  )
}
