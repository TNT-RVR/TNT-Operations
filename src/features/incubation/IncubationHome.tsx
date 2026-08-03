import { useState } from 'react'
import { PageHeader, Badge, Gauge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { incubationProgress, getIncubationDay, incubatorDisplay } from '@/domain/incubation'
import type { Incubator } from '@/data/types'
import { IncubatorDetail } from './IncubatorDetail'

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'blue'

function modeTone(inc: Incubator, running: boolean): Tone {
  if (inc.tempMode === 'incubation') return 'green'
  if (inc.tempMode === 'cool_storage') return 'blue'
  if (inc.tempMode === 'holding') return 'amber'
  return running ? 'green' : 'brand'
}

const fmtRange = (a: number | null, b: number | null, unit: string, fallback: string) =>
  a != null && b != null ? `${a}–${b}${unit}` : fallback

export default function IncubationHome() {
  const { incubators, latestReading } = useData()
  const now = new Date()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = incubators.find((i) => i.id === openId) ?? null

  return (
    <div>
      <PageHeader title="Incubation" subtitle="Leafcutter bee incubators — mode, readings, health" />
      <div className="grid gap-4 p-4 md:grid-cols-2 md:p-6">
        {incubators.map((i) => {
          const d = incubatorDisplay(i)
          const r = latestReading(i.id)
          const tempOut =
            r != null && d.running && d.tempMin != null && d.tempMax != null && (r.tempC < d.tempMin || r.tempC > d.tempMax)
          const humOut =
            r != null && d.running && d.humMin != null && d.humMax != null && (r.humidityPct < d.humMin || r.humidityPct > d.humMax)

          const showProgress = i.tempMode === 'incubation' && !!i.incubationStart
          const p = showProgress ? incubationProgress(i.incubationStart!, now.toISOString()) : null
          const day = showProgress ? getIncubationDay({ startDate: i.incubationStart }, now) : null

          return (
            <button
              key={i.id}
              onClick={() => setOpenId(i.id)}
              className="card block w-full text-left transition hover:border-brand hover:shadow-md"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-bold">{i.name}</h2>
                  {i.location && <p className="text-xs text-muted">{i.location}</p>}
                </div>
                <Badge tone={modeTone(i, d.running)}>{d.modeLabel}</Badge>
              </div>

              {p && (
                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>{day != null ? `Day ${day}` : p.stage}</span>
                    <span>
                      {p.pct}% · {p.daysRemaining}d left
                    </span>
                  </div>
                  <Gauge pct={p.pct} tone={p.stage === 'emergence' ? 'amber' : 'brand'} />
                </div>
              )}

              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted">Temp (latest)</dt>
                  <dd className={`font-semibold ${tempOut ? 'text-danger' : 'text-primary'}`}>
                    {r ? `${r.tempC.toFixed(1)}°C` : '—'}{' '}
                    {/* An off incubator isn't being held anywhere — it has no target. */}
                    <span className="text-xs text-faint">
                      / {d.running ? fmtRange(d.tempMin, d.tempMax, '°C', `${i.tempTargetC}°C`) : '—'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Humidity (latest)</dt>
                  <dd className={`font-semibold ${humOut ? 'text-danger' : 'text-primary'}`}>
                    {r ? `${r.humidityPct}%` : '—'}{' '}
                    <span className="text-xs text-faint">
                      / {d.running ? fmtRange(d.humMin, d.humMax, '%', `${i.humidityTargetPct}%`) : '—'}
                    </span>
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
