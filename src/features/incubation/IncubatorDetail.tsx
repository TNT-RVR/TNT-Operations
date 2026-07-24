import { useState } from 'react'
import { Modal, Badge, Gauge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Incubator } from '@/data/types'
import { incubationProgress, getIncubationDay, incubatorDisplay, formatTemp } from '@/domain/incubation'
import { ReadingsChart } from './ReadingsChart'

const TZ = 'America/Edmonton'
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const fmtRange = (a: number | null, b: number | null, unit: string, fallback: string) =>
  a != null && b != null ? `${a}–${b}${unit}` : fallback

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

  const d = incubatorDisplay(incubator)
  const showProgress = incubator.tempMode === 'incubation' && !!incubator.incubationStart
  const p = showProgress ? incubationProgress(incubator.incubationStart!, new Date().toISOString()) : null
  const day = showProgress ? getIncubationDay({ startDate: incubator.incubationStart }, new Date()) : null

  const tempOut =
    latest != null && d.running && d.tempMin != null && d.tempMax != null && (latest.tempC < d.tempMin || latest.tempC > d.tempMax)
  const humOut =
    latest != null && d.running && d.humMin != null && d.humMax != null && (latest.humidityPct < d.humMin || latest.humidityPct > d.humMax)
  const alerts: string[] = []
  if (latest && tempOut)
    alerts.push(`Temp ${formatTemp(latest.tempC)} is outside the ${fmtRange(d.tempMin, d.tempMax, '°C', '')} band`)
  if (latest && humOut)
    alerts.push(`Humidity ${latest.humidityPct}% is outside ${fmtRange(d.humMin, d.humMax, '%', '')}`)

  // Chart reference = middle of the mode band (tolerance = half-band), else the target.
  const targetC = d.tempMin != null && d.tempMax != null ? (d.tempMin + d.tempMax) / 2 : incubator.tempTargetC
  const tolC = d.tempMin != null && d.tempMax != null ? (d.tempMax - d.tempMin) / 2 : 1.5

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
        {/* Mode + progress */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={d.running ? 'green' : 'brand'}>{d.modeLabel}</Badge>
          {incubator.location && <span className="text-sm text-slate-500">{incubator.location}</span>}
          {day != null && <span className="text-sm font-medium text-slate-700">Day {day}</span>}
          {incubator.capacity != null && (
            <span className="text-sm text-slate-400">capacity {incubator.capacity}</span>
          )}
        </div>
        {p && (
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
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">Temperature</h3>
            {latest && (
              <span className="text-sm text-slate-500">
                latest {fmtWhen(latest.at)} ·{' '}
                <span className={tempOut ? 'font-semibold text-red-600' : 'font-semibold text-slate-900'}>
                  {formatTemp(latest.tempC)}
                </span>{' '}
                / {fmtRange(d.tempMin, d.tempMax, '°C', `${incubator.tempTargetC}°C`)} ·{' '}
                <span className={humOut ? 'font-semibold text-red-600' : ''}>{latest.humidityPct}%</span> RH /{' '}
                {fmtRange(d.humMin, d.humMax, '%', `${incubator.humidityTargetPct}%`)}
              </span>
            )}
          </div>
          <ReadingsChart readings={myReadings} targetC={targetC} tolerance={tolC} />
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
                  {i.healthScore > 0 && <Badge tone={healthTone(i.healthScore)}>{i.healthScore}</Badge>}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">{i.notes || <span className="text-slate-400">—</span>}</div>
                    <div className="text-xs text-slate-400">
                      {fmtWhen(i.at)}
                      {i.inspector ? ` · ${i.inspector}` : ''}
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
