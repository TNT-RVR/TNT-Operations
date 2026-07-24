import { useState } from 'react'
import { Modal, Badge, Gauge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Incubator } from '@/data/types'
import { incubationProgress, getIncubationDay, formatTemp } from '@/domain/incubation'
import { ReadingsChart } from './ReadingsChart'

const TZ = 'America/Edmonton'
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const TEMP_TOL = 1.5 // °C off target before we flag it
const HUM_TOL = 8 // % off target before we flag it

function healthTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 85) return 'green'
  if (score >= 70) return 'amber'
  return 'red'
}

export function IncubatorDetail({ incubator, onClose }: { incubator: Incubator; onClose: () => void }) {
  const { inspections, readings, latestReading, addInspection } = useData()
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')

  const mine = inspections.filter((i) => i.incubatorId === incubator.id).sort((a, b) => b.at.localeCompare(a.at))
  const myReadings = readings.filter((r) => r.incubatorId === incubator.id)
  const latest = latestReading(incubator.id)

  const p = incubationProgress(incubator.startedAt, new Date().toISOString())
  const day = getIncubationDay({ startDate: incubator.startedAt }, new Date())

  const tempOff = latest ? Math.abs(latest.tempC - incubator.tempTargetC) > TEMP_TOL : false
  const humOff = latest ? Math.abs(latest.humidityPct - incubator.humidityTargetPct) > HUM_TOL : false
  const alerts: string[] = []
  if (latest && tempOff)
    alerts.push(`Temp ${formatTemp(latest.tempC)} is off target (${incubator.tempTargetC}°C)`)
  if (latest && humOff)
    alerts.push(`Humidity ${latest.humidityPct}% is off target (${incubator.humidityTargetPct}%)`)

  const [health, setHealth] = useState(90)
  const [notes, setNotes] = useState('')

  function submit() {
    addInspection({
      incubatorId: incubator.id,
      at: new Date().toISOString(),
      inspector: s.user.name,
      healthScore: health,
      notes: notes.trim(),
    })
    setNotes('')
    setHealth(90)
  }

  return (
    <Modal title={incubator.name} onClose={onClose} wide>
      <div className="space-y-5">
        {/* Status + progress */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={incubator.status === 'active' ? 'green' : 'brand'}>{incubator.status}</Badge>
          <span className="text-sm text-slate-500">{incubator.location}</span>
          {day !== null && incubator.startedAt && (
            <span className="text-sm font-medium text-slate-700">Day {day}</span>
          )}
        </div>
        {incubator.startedAt && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>{p.stage}</span>
              <span>
                {p.pct}% · {p.daysRemaining}d left
              </span>
            </div>
            <Gauge pct={p.pct} tone={p.stage === 'emergence' ? 'amber' : 'brand'} />
          </div>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {alerts.map((a) => (
              <div key={a}>⚠️ {a}</div>
            ))}
          </div>
        )}

        {/* Latest reading + chart */}
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-semibold">Temperature</h3>
            {latest && (
              <span className="text-sm text-slate-500">
                latest {fmtWhen(latest.at)} ·{' '}
                <span className={tempOff ? 'font-semibold text-red-600' : 'font-semibold text-slate-900'}>
                  {formatTemp(latest.tempC)}
                </span>{' '}
                / {incubator.tempTargetC}°C · {latest.humidityPct}% RH
              </span>
            )}
          </div>
          <ReadingsChart readings={myReadings} targetC={incubator.tempTargetC} tolerance={TEMP_TOL} />
        </section>

        {/* Add inspection */}
        {canEdit && (
          <section className="rounded-lg bg-slate-50 p-3">
            <h3 className="mb-2 font-semibold">Log an inspection</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label">Health score</span>
                <input
                  className="input w-28"
                  type="number"
                  min={0}
                  max={100}
                  value={health}
                  onChange={(e) => setHealth(Math.max(0, Math.min(100, Number(e.target.value))))}
                />
              </label>
              <label className="block flex-1">
                <span className="label">Notes</span>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you see?" />
              </label>
              <button className="btn-primary" onClick={submit}>
                Save inspection
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">Logged as {s.user.name}.</p>
          </section>
        )}

        {/* Inspection history */}
        <section>
          <h3 className="mb-2 font-semibold">Inspection history</h3>
          {mine.length === 0 ? (
            <p className="text-sm text-slate-500">No inspections logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {mine.map((i) => (
                <li key={i.id} className="flex items-start gap-3 px-3 py-2">
                  <Badge tone={healthTone(i.healthScore)}>{i.healthScore}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">{i.notes || <span className="text-slate-400">—</span>}</div>
                    <div className="text-xs text-slate-400">
                      {fmtWhen(i.at)} · {i.inspector}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}
