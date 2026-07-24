import { useState } from 'react'
import { PageHeader, Badge, Gauge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { incubationProgress } from '@/domain/incubation'
import { IncubatorDetail } from './IncubatorDetail'

export default function IncubationHome() {
  const { incubators, latestReading } = useData()
  const now = new Date().toISOString()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = incubators.find((i) => i.id === openId) ?? null

  return (
    <div>
      <PageHeader title="Incubation" subtitle="Leafcutter bee incubators — batches, readings, health" />
      <div className="grid gap-4 p-4 md:grid-cols-2 md:p-6">
        {incubators.map((i) => {
          const p = incubationProgress(i.startedAt, now)
          const r = latestReading(i.id)
          const tempOff = r ? Math.abs(r.tempC - i.tempTargetC) : 0
          return (
            <button
              key={i.id}
              onClick={() => setOpenId(i.id)}
              className="card block w-full text-left transition hover:border-brand hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-bold">{i.name}</h2>
                  <p className="text-xs text-slate-500">{i.location}</p>
                </div>
                <Badge tone={i.status === 'active' ? 'green' : 'brand'}>{i.status}</Badge>
              </div>

              <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{p.stage}</span>
                  <span>
                    {p.pct}% · {p.daysRemaining}d left
                  </span>
                </div>
                <Gauge pct={p.pct} tone={p.stage === 'emergence' ? 'amber' : 'brand'} />
              </div>

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-slate-500">Temp (latest)</dt>
                  <dd className={`font-semibold ${tempOff > 1.5 ? 'text-red-600' : 'text-slate-900'}`}>
                    {r ? `${r.tempC.toFixed(1)}°C` : '—'} <span className="text-xs text-slate-400">/ {i.tempTargetC}°C</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Humidity (latest)</dt>
                  <dd className="font-semibold text-slate-900">
                    {r ? `${r.humidityPct}%` : '—'} <span className="text-xs text-slate-400">/ {i.humidityTargetPct}%</span>
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs font-medium text-brand">View details →</p>
            </button>
          )
        })}
        {incubators.length === 0 && <EmptyState>No incubators yet.</EmptyState>}
      </div>

      {open && <IncubatorDetail incubator={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
