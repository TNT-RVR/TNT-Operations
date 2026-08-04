import { useMemo, useState, useEffect } from 'react'
import { PageHeader, StatTile, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import type { IncubatorAlert, NotificationSeverity } from '@/data/types'

const PAGE_SIZE = 50
const ALL = '__all__'
const TZ = 'America/Edmonton'

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Alert types carry the old app's snake_case keys; show them readably. */
const TYPE_LABELS: Record<string, string> = {
  temp_humidity: 'Temp / humidity',
  inspection_temp: 'Inspection temp',
  vapona_sensor: 'Vapona sensor',
}
const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replace(/_/g, ' ')

const SEVERITY_TONE: Record<NotificationSeverity, 'red' | 'amber' | 'blue'> = {
  critical: 'red',
  warning: 'amber',
  info: 'blue',
}

export default function AlertsHome() {
  const { alerts, incubators } = useData()

  const incubatorName = useMemo(() => new Map(incubators.map((i) => [i.id, i.name])), [incubators])
  const types = useMemo(() => [...new Set(alerts.map((a) => a.alertType))].sort(), [alerts])

  const [type, setType] = useState(ALL)
  const [incId, setIncId] = useState(ALL)
  const [ack, setAck] = useState(ALL)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => setPage(1), [type, incId, ack, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts
      .filter((a) => {
        if (type !== ALL && a.alertType !== type) return false
        if (incId !== ALL && a.incubatorId !== incId) return false
        if (ack === 'open' && a.acknowledged) return false
        if (ack === 'acked' && !a.acknowledged) return false
        if (q && !a.message.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
  }, [alerts, type, incId, ack, search])

  const openCount = alerts.filter((a) => !a.acknowledged).length
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const clamped = Math.min(page, pageCount)
  const rows = filtered.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE)

  const selectCls = 'rounded-sm border border-default bg-inset px-2 py-1.5 text-sm text-primary'
  const filtered_ = type !== ALL || incId !== ALL || ack !== ALL || search

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Incubation alert history — temp/humidity limits, inspection drift, sensor outages"
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Alerts" value={alerts.length.toLocaleString('en-CA')} />
          <StatTile
            label="Unacknowledged"
            value={openCount}
            tone={openCount > 0 ? 'warn' : 'good'}
            hint={openCount === 0 ? 'all reviewed' : 'need review'}
          />
          <StatTile label="Types" value={types.length} />
          <StatTile
            label="Most recent"
            value={alerts.length ? fmtWhen(alerts[0].triggeredAt).split(',')[0] : '—'}
            hint={alerts.length ? fmtWhen(alerts[0].triggeredAt) : undefined}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Search</span>
            <input
              className="input w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="message text…"
            />
          </label>
          <label className="block">
            <span className="label">Type</span>
            <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
              <option value={ALL}>All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
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
            <span className="label">State</span>
            <select className={selectCls} value={ack} onChange={(e) => setAck(e.target.value)}>
              <option value={ALL}>All</option>
              <option value="open">Unacknowledged</option>
              <option value="acked">Acknowledged</option>
            </select>
          </label>
          {filtered_ && (
            <button
              className="btn-ghost"
              onClick={() => {
                setSearch('')
                setType(ALL)
                setIncId(ALL)
                setAck(ALL)
              }}
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-secondary">
          <span>
            {filtered.length === alerts.length
              ? `${alerts.length.toLocaleString('en-CA')} alerts`
              : `${filtered.length.toLocaleString('en-CA')} of ${alerts.length.toLocaleString('en-CA')} alerts`}
          </span>
          {pageCount > 1 && <Pager page={clamped} pageCount={pageCount} onPage={setPage} />}
        </div>

        {filtered.length === 0 ? (
          <EmptyState>{alerts.length === 0 ? 'No alerts recorded.' : 'No alerts match these filters.'}</EmptyState>
        ) : (
          <ul className="divide-y divide-subtle rounded-lg border border-subtle">
            {rows.map((a) => (
              <AlertRow key={a.id} alert={a} incubatorName={incubatorName} />
            ))}
          </ul>
        )}

        {pageCount > 1 && (
          <div className="flex justify-end">
            <Pager page={clamped} pageCount={pageCount} onPage={setPage} />
          </div>
        )}
      </div>
    </div>
  )
}

function AlertRow({ alert: a, incubatorName }: { alert: IncubatorAlert; incubatorName: Map<string, string> }) {
  return (
    <li className="px-3 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[a.severity] ?? 'blue'}>{a.severity}</Badge>
        <span className="font-mono text-xs uppercase tracking-wide text-muted">{typeLabel(a.alertType)}</span>
        {a.incubatorId && (
          <span className="text-sm text-secondary">{incubatorName.get(a.incubatorId) ?? 'Unknown incubator'}</span>
        )}
        {!a.acknowledged && <Badge tone="red">unacknowledged</Badge>}
      </div>
      <div className="text-sm text-primary">{a.message}</div>
      <div className="mt-0.5 font-mono text-xs text-faint">
        {fmtWhen(a.triggeredAt)}
        {a.acknowledged && a.acknowledgedAt ? ` · acknowledged ${fmtWhen(a.acknowledgedAt)}` : ''}
      </div>
    </li>
  )
}

function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-ghost px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span className="font-mono text-xs text-muted">
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
