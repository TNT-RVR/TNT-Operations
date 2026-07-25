import { useMemo, useState, useEffect } from 'react'
import { PageHeader, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import type { Tray } from '@/data/types'

const PAGE_SIZE = 50
const num = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 })
const ALL = '__all__'

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

  // Reset to the first page whenever a filter changes.
  useEffect(() => setPage(1), [search, incId, sampleId, status])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return trays.filter((t) => {
      if (incId !== ALL && t.incubatorId !== incId) return false
      if (sampleId !== ALL && t.sampleId !== sampleId) return false
      if (status !== ALL && t.status !== status) return false
      if (q && !t.trayNumber.toLowerCase().includes(q)) return false
      return true
    })
  }, [trays, search, incId, sampleId, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

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

        {/* Count + pager */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            {filtered.length === trays.length
              ? `${num(trays.length)} trays`
              : `${num(filtered.length)} of ${num(trays.length)} trays`}
          </span>
          {pageCount > 1 && (
            <Pager page={clampedPage} pageCount={pageCount} onPage={setPage} />
          )}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState>No trays match these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-3 py-2">Tray</th>
                  <th className="px-3 py-2">Sample</th>
                  <th className="px-3 py-2">Incubator</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Weight (lb)</th>
                  <th className="px-3 py-2 text-right">Live count</th>
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
