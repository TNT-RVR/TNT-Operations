import { useMemo, useState, useEffect, useRef } from 'react'
import { PageHeader, EmptyState, Modal, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import type { Tray } from '@/data/types'
import { trayYear, trayWeightKg, perLbToPerKg } from '@/domain/incubation'
import { TrayScanButton } from './TrayScanButton'
import { findTrays } from './trayLookup'

const PAGE_SIZE = 50
const num = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 })
const ALL = '__all__'
const UNDATED = '__undated__'


type SortKey = 'trayNumber' | 'year' | 'sample' | 'incubator' | 'status' | 'weightKg' | 'livePerKg'
type SortDir = 'asc' | 'desc'
interface Column {
  key: SortKey
  label: string
  align?: 'right'
  numeric?: boolean
}
const COLUMNS: Column[] = [
  { key: 'trayNumber', label: 'Tray' },
  { key: 'year', label: 'Year', numeric: true },
  { key: 'sample', label: 'Sample' },
  { key: 'incubator', label: 'Incubator' },
  { key: 'status', label: 'Status' },
  { key: 'weightKg', label: 'Weight Kg', align: 'right', numeric: true },
  { key: 'livePerKg', label: 'Live/Kg', align: 'right', numeric: true },
]

/** Quote a CSV field only when needed. */
const csvCell = (v: string | number | null) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function TraysHome() {
  const { trays, incubators, samples, loadTrays, traysLoading } = useData()
  // Trays aren't hydrated on mount (thousands of rows); this screen needs them.
  useEffect(() => {
    void loadTrays()
  }, [loadTrays])

  const incubatorName = useMemo(() => new Map(incubators.map((i) => [i.id, i.name])), [incubators])
  const sampleName = useMemo(() => new Map(samples.map((s) => [s.id, s.name])), [samples])
  const sampleById = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples])
  /** Tray weight and live/kg are LOOKED UP from the sample, never stored on the
   *  tray — an x-ray correction has to reach every tray of that lot. */
  const weightOf = (t: Tray) => trayWeightKg(t.sampleId ? sampleById.get(t.sampleId) : null)
  const livePerKgOf = (t: Tray) => {
    const smp = t.sampleId ? sampleById.get(t.sampleId) : null
    return smp ? smp.liveBeesPerKg ?? perLbToPerKg(smp.liveBeesPerLb) : null
  }
  const statuses = useMemo(() => [...new Set(trays.map((t) => t.status))].sort(), [trays])

  // Distinct derived years (desc), plus whether any tray is undated.
  const years = useMemo(() => [...new Set(trays.map(trayYear).filter((y): y is number => y != null))].sort((a, b) => b - a), [trays])
  const hasUndated = useMemo(() => trays.some((t) => trayYear(t) == null), [trays])

  // All usages of each physical tray label (its full history).
  const traysByNumber = useMemo(() => {
    const m = new Map<string, Tray[]>()
    for (const t of trays) {
      const list = m.get(t.trayNumber)
      if (list) list.push(t)
      else m.set(t.trayNumber, [t])
    }
    return m
  }, [trays])

  const [search, setSearch] = useState('')
  const [incId, setIncId] = useState(ALL)
  const [sampleId, setSampleId] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [year, setYear] = useState(ALL)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('trayNumber')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [openTrayNumber, setOpenTrayNumber] = useState<string | null>(null)
  /** A scanned label with no tray on record — worth saying so explicitly. */
  const [notFound, setNotFound] = useState<string | null>(null)


  // Default to the current year once the data is in, matching the desktop app:
  // the current season is what you almost always want. Falls back to All Years
  // when this year has no data, and only fires once so it never fights a choice.
  const didDefaultYear = useRef(false)
  useEffect(() => {
    if (didDefaultYear.current || years.length === 0) return
    didDefaultYear.current = true
    const cur = String(new Date().getFullYear())
    if (years.some((y) => String(y) === cur)) setYear(cur)
  }, [years])

  // Reset to the first page whenever a filter or sort changes.
  useEffect(() => setPage(1), [search, incId, sampleId, status, year, sortKey, sortDir])

  const sortValue = (t: Tray): string | number | null => {
    switch (sortKey) {
      case 'trayNumber':
        return t.trayNumber
      case 'year':
        return trayYear(t)
      case 'sample':
        return (t.sampleId && sampleName.get(t.sampleId)) || ''
      case 'incubator':
        return (t.incubatorId && incubatorName.get(t.incubatorId)) || ''
      case 'status':
        return t.status
      case 'weightKg':
        return weightOf(t)
      case 'livePerKg':
        return livePerKgOf(t)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = trays.filter((t) => {
      if (incId !== ALL && t.incubatorId !== incId) return false
      if (sampleId !== ALL && t.sampleId !== sampleId) return false
      if (status !== ALL && t.status !== status) return false
      if (year !== ALL) {
        const ty = trayYear(t)
        if (year === UNDATED ? ty != null : ty !== Number(year)) return false
      }
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
  }, [trays, search, incId, sampleId, status, year, sortKey, sortDir, sampleName, incubatorName])

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
    const header = ['Tray', 'Year', 'Sample', 'Incubator', 'Status', 'Weight Kg', 'Live/Kg', 'In date', 'Out date', 'Cool date']
    const lines = filtered.map((t) =>
      [
        t.trayNumber,
        trayYear(t) ?? '',
        (t.sampleId && sampleName.get(t.sampleId)) || '',
        (t.incubatorId && incubatorName.get(t.incubatorId)) || '',
        t.status,
        weightOf(t) ?? '',
        livePerKgOf(t) == null ? '' : Math.round(livePerKgOf(t)!),
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

  const selectCls = 'rounded-lg border border-default bg-raised px-2 py-1.5 text-sm'

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
              onChange={(e) => {
                setSearch(e.target.value)
                setNotFound(null)
              }}
              placeholder="e.g. 1487"
            />
          </label>
          {/* Scan a tray to look it up — opens its history straight away, so
              standing at the stack with a tray in hand is one action. */}
          <TrayScanButton
            label="Scan to look up"
            title="Scan a tray to look it up"
            // A label with no tray is reported on the camera and scanning
            // continues — you're standing at the stack, not at a form.
            resolve={(scanned) => {
              const match = findTrays(trays, scanned)[0]
              return match
                ? { ok: true, title: match.trayNumber, detail: 'Opening history…' }
                : { ok: false, title: scanned, detail: 'No tray on record for this label' }
            }}
            onScan={(scanned) => {
              const label = findTrays(trays, scanned)[0]?.trayNumber ?? scanned
              setSearch(label)
              setNotFound(null)
              setOpenTrayNumber(label)
            }}
          />
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
            <span className="label">Year</span>
            <select className={selectCls} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value={ALL}>All years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
              {hasUndated && <option value={UNDATED}>Undated</option>}
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
          {(search || incId !== ALL || sampleId !== ALL || status !== ALL || year !== ALL) && (
            <button
              className="btn-ghost"
              onClick={() => {
                setSearch('')
                setIncId(ALL)
                setSampleId(ALL)
                setStatus(ALL)
                setYear(ALL)
              }}
            >
              Clear
            </button>
          )}
        </div>

        {notFound && (
          <p className="rounded-sm border border-default px-3 py-2 text-sm text-danger">
            No tray on record for “{notFound}” — it may not have been assigned to a sample yet.
          </p>
        )}

        {/* Count + export + pager */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-secondary">
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
          <EmptyState>{traysLoading ? 'Loading trays…' : 'No trays match these filters.'}</EmptyState>
        ) : (
          <>
            {/* Phones: stacked cards. A 640px table in a 375px viewport means
                side-scrolling to read a row, which is unusable in the shop. */}
            <ul className="divide-y divide-subtle rounded-lg border border-subtle md:hidden">
              {pageRows.map((t) => (
                <li key={t.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <button className="font-medium text-brand hover:underline" onClick={() => setOpenTrayNumber(t.trayNumber)}>
                      {t.trayNumber}
                    </button>
                    <span className="font-mono text-xs text-muted">{trayYear(t) ?? '—'}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-secondary">
                    {t.sampleId ? sampleName.get(t.sampleId) ?? '—' : '—'}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-xs text-faint">
                    <span>{t.incubatorId ? incubatorName.get(t.incubatorId) ?? '—' : '—'}</span>
                    <span>{t.status}</span>
                    {weightOf(t) != null && <span>{num(weightOf(t))} kg</span>}
                    {livePerKgOf(t) != null && <span>{Math.round(livePerKgOf(t)!).toLocaleString('en-CA')}/kg</span>}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border border-subtle md:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-subtle bg-overlay text-left text-xs uppercase text-muted">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`cursor-pointer select-none px-3 py-2 hover:text-secondary ${
                        c.align === 'right' ? 'text-right' : ''
                      }`}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.label}
                      <span className="ml-1 inline-block w-3 text-faint">
                        {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {pageRows.map((t) => (
                  <TrayRow
                    key={t.id}
                    tray={t}
                    incubatorName={incubatorName}
                    sampleName={sampleName}
                    weightKg={weightOf(t)}
                    livePerKg={livePerKgOf(t)}
                    onOpen={() => setOpenTrayNumber(t.trayNumber)}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        {pageCount > 1 && (
          <div className="flex justify-end">
            <Pager page={clampedPage} pageCount={pageCount} onPage={setPage} />
          </div>
        )}
      </div>

      {openTrayNumber && (
        <TrayHistory
          trayNumber={openTrayNumber}
          usages={traysByNumber.get(openTrayNumber) ?? []}
          incubatorName={incubatorName}
          sampleName={sampleName}
          weightOf={weightOf}
          onClose={() => setOpenTrayNumber(null)}
        />
      )}
    </div>
  )
}

function TrayRow({
  tray: t,
  incubatorName,
  sampleName,
  weightKg,
  livePerKg,
  onOpen,
}: {
  tray: Tray
  incubatorName: Map<string, string>
  sampleName: Map<string, string>
  /** Both looked up from the tray's sample, not stored on the tray. */
  weightKg: number | null
  livePerKg: number | null
  onOpen: () => void
}) {
  return (
    <tr>
      <td className="px-3 py-1.5">
        <button className="font-medium text-brand hover:underline" onClick={onOpen}>
          {t.trayNumber}
        </button>
      </td>
      <td className="px-3 py-1.5 text-muted">{trayYear(t) ?? '—'}</td>
      <td className="px-3 py-1.5 text-muted">{t.sampleId ? sampleName.get(t.sampleId) ?? '—' : '—'}</td>
      <td className="px-3 py-1.5 text-muted">{t.incubatorId ? incubatorName.get(t.incubatorId) ?? '—' : '—'}</td>
      <td className="px-3 py-1.5 text-muted">{t.status}</td>
      <td className="px-3 py-1.5 text-right">{num(weightKg)}</td>
      <td className="px-3 py-1.5 text-right">{livePerKg == null ? '—' : Math.round(livePerKg).toLocaleString('en-CA')}</td>
    </tr>
  )
}

/** History of one physical tray (its label) across every season/sample it held. */
function TrayHistory({
  trayNumber,
  usages,
  incubatorName,
  sampleName,
  weightOf,
  onClose,
}: {
  trayNumber: string
  usages: Tray[]
  incubatorName: Map<string, string>
  sampleName: Map<string, string>
  /** Sample-derived weight for a usage (kg). */
  weightOf: (t: Tray) => number | null
  onClose: () => void
}) {
  // newest season first; undated last.
  const sorted = [...usages].sort((a, b) => (trayYear(b) ?? -Infinity) - (trayYear(a) ?? -Infinity))
  return (
    <Modal title={`Tray ${trayNumber} — history`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {usages.length === 1
            ? 'One recorded usage of this physical tray.'
            : `${usages.length} recorded usages of this physical tray across seasons.`}
        </p>
        <ol className="space-y-2">
          {sorted.map((t) => (
            <li key={t.id} className="rounded-lg border border-subtle p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone="brand">{trayYear(t) ?? 'Undated'}</Badge>
                <span className="font-medium text-primary">
                  {t.sampleId ? sampleName.get(t.sampleId) ?? 'Unknown sample' : 'No sample'}
                </span>
                <span className="text-sm text-muted">
                  · {t.incubatorId ? incubatorName.get(t.incubatorId) ?? 'Unknown incubator' : 'No incubator'}
                </span>
                <Badge tone="green">{t.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                {t.inDate && <span>In {t.inDate.slice(0, 10)}</span>}
                {t.outDate && <span>Out {t.outDate.slice(0, 10)}</span>}
                {t.coolDate && <span>Cool {t.coolDate.slice(0, 10)}</span>}
                {weightOf(t) != null && <span>{num(weightOf(t))} kg</span>}
                {t.notes && <span className="text-secondary">“{t.notes}”</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span className="text-xs text-muted">
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
