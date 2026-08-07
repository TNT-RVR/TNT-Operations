import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { Modal, Badge, Gauge } from '@/components/ui'
import { AcControl } from './AcControl'
import { useData, type TrayObservation } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Incubator, Inspection } from '@/data/types'
import {
  incubationProgress,
  getIncubationDay,
  incubatorDisplay,
  formatTemp,
  TEMP_MODES,
  DEV_STAGES,
  STACK_POSITIONS,
  DEPTH_POSITIONS,
  expectedStageForDay,
  stageDelta,
  type TempMode,
} from '@/domain/incubation'
import { ReadingsChart } from './ReadingsChart'
import { TrayScanButton } from './TrayScanButton'
import { findTrays } from './trayLookup'

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

/** Compact status chips for an inspection: red for problems, info for emergence. */
function inspectionChips(i: Inspection) {
  const chips: Array<{ label: string; tone: 'red' | 'amber' | 'green' }> = []
  if (i.heatPumpsOk === false) chips.push({ label: 'Heat pumps', tone: 'red' })
  if (i.fansOk === false) chips.push({ label: 'Fans', tone: 'red' })
  if (i.blackLightsOk === false) chips.push({ label: 'Black lights', tone: 'red' })
  if (i.parasitesEmerging) chips.push({ label: 'Parasites', tone: 'red' })
  if (i.beesEmerging) chips.push({ label: 'Bees emerging', tone: 'green' })
  return chips.map((c) => (
    <Badge key={c.label} tone={c.tone}>
      {c.label}
    </Badge>
  ))
}

export function IncubatorDetail({ incubator, onClose }: { incubator: Incubator; onClose: () => void }) {
  const { inspections, trayInspections, trays, readings, latestReading, addInspection, saveIncubator, loadTrays } = useData()
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

  // Chart reference = middle of the mode band (tolerance = half-band). An
  // incubator that's OFF is not being held anywhere, so it has no target at all
  // — don't fall back to the stored tempTargetC, which would draw a 30°C line
  // the incubator isn't failing to meet.
  const hasBand = d.tempMin != null && d.tempMax != null
  const targetC = !d.running ? null : hasBand ? (d.tempMin! + d.tempMax!) / 2 : incubator.tempTargetC
  const tolC = hasBand ? (d.tempMax! - d.tempMin!) / 2 : 1.5
  /** Target text for the current mode; an off incubator shows none. */
  const targetLabel = d.running ? fmtRange(d.tempMin, d.tempMax, '°C', `${incubator.tempTargetC}°C`) : '—'

  const [period, setPeriod] = useState<'morning' | 'evening' | 'manual'>('manual')
  const [thermTemp, setThermTemp] = useState('')
  const [heatPumpsOk, setHeatPumpsOk] = useState(true)
  const [fansOk, setFansOk] = useState(true)
  const [blackLightsOk, setBlackLightsOk] = useState(true)
  const [beesEmerging, setBeesEmerging] = useState(false)
  const [parasitesEmerging, setParasitesEmerging] = useState(false)
  const [notes, setNotes] = useState('')
  /** Trays examined during this inspection, added before saving. */
  const [observations, setObservations] = useState<TrayObservation[]>([])
  const [obsTray, setObsTray] = useState('')
  const [obsStack, setObsStack] = useState<string>(STACK_POSITIONS[0])
  const [obsDepth, setObsDepth] = useState<string>(DEPTH_POSITIONS[0])
  const [obsCells, setObsCells] = useState('')
  const [obsStage, setObsStage] = useState<string>('')

  /** Scanning resolves against the tray list, so load it when this opens. */
  useEffect(() => {
    void loadTrays()
  }, [loadTrays])

  /** What the schedule says this incubator should be showing today. */
  const expectedStage = expectedStageForDay(day)

  function addObservation() {
    if (!obsTray.trim() || !obsStage) return
    setObservations((prev) => [
      ...prev,
      {
        trayId: null,
        trayNumber: obsTray.trim(),
        stackPosition: obsStack,
        depthPosition: obsDepth,
        cellsOpened: obsCells.trim() === '' ? null : Number(obsCells),
        devStage: obsStage,
        notes: '',
      },
    ])
    setObsTray('')
    setObsCells('')
  }

  // Compare the hand thermometer against the Govee sensor reading at log time.
  const goveeTempC = latest?.tempC ?? null
  const thermNum = thermTemp.trim() === '' ? null : Number(thermTemp)
  const tempDiffC = thermNum != null && goveeTempC != null ? Math.round((thermNum - goveeTempC) * 100) / 100 : null
  const tempAlert = tempDiffC != null && Math.abs(tempDiffC) >= 1.5

  function submit() {
    addInspection({
      incubatorId: incubator.id,
      at: new Date().toISOString(),
      inspector: s.user.name,
      healthScore: 0,
      notes: notes.trim(),
      period,
      thermometerTempC: thermNum,
      goveeTempC,
      tempDiffC,
      tempAlert,
      heatPumpsOk,
      fansOk,
      blackLightsOk,
      beesEmerging,
      parasitesEmerging,
    }, observations)
    setThermTemp('')
    setNotes('')
    setPeriod('manual')
    setBeesEmerging(false)
    setParasitesEmerging(false)
    setObservations([])
  }

  return (
    <Modal title={incubator.name} onClose={onClose} wide>
      <div className="space-y-5">
        {/* Mode + progress */}
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <label className="flex items-center gap-2">
              <span className="label">Mode</span>
              <select
                className="rounded-sm border border-default bg-inset px-2 py-1.5 text-sm text-primary"
                value={incubator.tempMode ?? 'off'}
                onChange={(e) => {
                  const mode = e.target.value
                  const patch: Partial<Incubator> = { tempMode: mode }
                  // Starting an incubation with no start date on record: stamp
                  // today so the milestone calendar has something to schedule
                  // from. Editable below, and never overwritten if already set.
                  if (mode === 'incubation' && !incubator.incubationStart) {
                    patch.incubationStart = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
                  }
                  saveIncubator(incubator.id, patch)
                }}
              >
                {(Object.keys(TEMP_MODES) as TempMode[]).map((m) => (
                  <option key={m} value={m}>
                    {TEMP_MODES[m].label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Badge tone={d.running ? 'green' : 'brand'}>{d.modeLabel}</Badge>
          )}
          {canEdit && (
            <label className="flex items-center gap-2">
              <span className="label">Started</span>
              <input
                type="date"
                className="rounded-sm border border-default bg-inset px-2 py-1.5 text-sm text-primary"
                value={incubator.incubationStart?.slice(0, 10) ?? ''}
                onChange={(e) => saveIncubator(incubator.id, { incubationStart: e.target.value || null })}
              />
            </label>
          )}
          {incubator.location && <span className="text-sm text-muted">{incubator.location}</span>}
          {day != null && <span className="text-sm font-medium text-secondary">Day {day}</span>}
          {incubator.capacity != null && (
            <span className="text-sm text-faint">capacity {incubator.capacity}</span>
          )}
          {canEdit && (
            <Link
              to={`/incubation/scan?incubator=${incubator.id}`}
              className="btn-primary ml-auto px-3 py-1.5 text-sm"
              onClick={onClose}
            >
              <QrCode size={16} className="mr-1 inline" />
              Add trays
            </Link>
          )}
        </div>
        {/* The cloud poller reads this mode to decide how often to log readings. */}
        {canEdit && (
          <p className="-mt-3 text-xs text-faint">
            {d.running
              ? incubator.incubationStart
                ? 'Running — sensors logged every 15 minutes; milestones scheduled from the start date.'
                : 'Running — sensors logged every 15 minutes. Set a start date so the calendar can schedule milestones.'
              : 'Off — sensors are only checked every 6 hours. Set the mode when you start a run so readings are logged properly.'}
          </p>
        )}

        {/* Manual heat-pump control. Deliberately sits beneath the mode: the
            two are related but NOT linked, and seeing them together is how a
            contradiction between them gets noticed. */}
        <AcControl
          incubatorId={incubator.id}
          deviceIdsRaw={incubator.sensiboDeviceId}
          bandC={[d.tempMin, d.tempMax]}
          canEdit={canEdit}
        />

        {p && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>{p.stage}</span>
              <span>
                {p.overdue ? `${p.daysOverdue}d past schedule` : `${p.pct}% · ${p.daysRemaining}d left`}
              </span>
            </div>
            <Gauge pct={p.pct} tone={p.stage === 'emergence' ? 'amber' : 'brand'} />
          </div>
        )}

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', color: 'var(--warn-fg)' }}>
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
              <span className="text-sm text-muted">
                latest {fmtWhen(latest.at)} ·{' '}
                <span className={tempOut ? 'font-semibold text-danger' : 'font-semibold text-primary'}>
                  {formatTemp(latest.tempC)}
                </span>{' '}
                / {targetLabel} ·{' '}
                <span className={humOut ? 'font-semibold text-danger' : ''}>{latest.humidityPct}%</span> RH /{' '}
                {d.running ? fmtRange(d.humMin, d.humMax, '%', `${incubator.humidityTargetPct}%`) : '—'}
              </span>
            )}
          </div>
          <ReadingsChart readings={myReadings} incubatorId={incubator.id} targetC={targetC} tolerance={tolC} />
        </section>

        {/* Add inspection */}
        {canEdit && (
          <section className="rounded-lg bg-overlay p-3">
            <h3 className="mb-2 font-semibold">Log an inspection</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label">Period</span>
                <select className="input w-32" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                  <option value="manual">Manual</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Thermometer °C</span>
                <input
                  className="input w-28"
                  type="number"
                  step="0.1"
                  value={thermTemp}
                  onChange={(e) => setThermTemp(e.target.value)}
                  placeholder={goveeTempC != null ? String(goveeTempC) : '—'}
                />
              </label>
              <div className="pb-1 text-sm text-muted">
                Govee {goveeTempC != null ? formatTemp(goveeTempC) : '—'}
                {tempDiffC != null && (
                  <>
                    {' · Δ '}
                    <span className={tempAlert ? 'font-semibold text-danger' : 'text-secondary'}>
                      {tempDiffC > 0 ? '+' : ''}
                      {tempDiffC}°C
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {(
                [
                  ['Heat pumps OK', heatPumpsOk, setHeatPumpsOk],
                  ['Fans OK', fansOk, setFansOk],
                  ['Black lights OK', blackLightsOk, setBlackLightsOk],
                  ['Bees emerging', beesEmerging, setBeesEmerging],
                  ['Parasites emerging', parasitesEmerging, setParasitesEmerging],
                ] as const
              ).map(([label, val, set]) => (
                <label key={label} className="flex items-center gap-2">
                  <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>

            {/* Trays examined: pull a few from set positions, open cells, record
                the stage seen. Compared against the schedule as you go. */}
            <div className="mt-3 rounded-sm border border-default p-2">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="label">Trays examined</span>
                {expectedStage && (
                  <span className="text-xs text-faint">
                    day {day} should be “{expectedStage}”
                  </span>
                )}
              </div>

              {observations.length > 0 && (
                <ul className="mb-2 divide-y divide-subtle rounded-sm border border-subtle">
                  {observations.map((o, i) => {
                    const delta = o.devStage ? stageDelta(o.devStage, day) : null
                    return (
                      <li key={`${o.trayNumber}-${i}`} className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm">
                        <span className="font-mono text-primary">{o.trayNumber}</span>
                        <span className="text-xs text-muted">
                          {o.stackPosition} / {o.depthPosition}
                          {o.cellsOpened != null ? ` · ${o.cellsOpened} cells` : ''}
                        </span>
                        <span className="text-xs text-secondary">{o.devStage}</span>
                        {delta != null && delta !== 0 && (
                          <Badge tone={delta < 0 ? 'amber' : 'green'}>
                            {delta < 0 ? `${-delta} behind` : `${delta} ahead`}
                          </Badge>
                        )}
                        <button
                          className="btn-ghost ml-auto px-1 py-0 text-xs"
                          onClick={() => setObservations((prev) => prev.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="label">Tray</span>
                  <input className="input w-28" value={obsTray} onChange={(e) => setObsTray(e.target.value)} placeholder="Tray0417" />
                </label>
                <TrayScanButton
                  title="Scan the tray you examined"
                  resolve={(scanned) => {
                    const match = findTrays(trays, scanned)[0]
                    // Unknown labels are still accepted — a tray can be examined
                    // before it's been assigned — but say so rather than silently
                    // filling in something that matched nothing.
                    return match
                      ? { ok: true, title: match.trayNumber, detail: 'Added to this inspection' }
                      : { ok: true, title: scanned, detail: 'Not on record — recorded as scanned' }
                  }}
                  onScan={(label) => {
                    // Use the stored label when it's known, so a prefix
                    // mismatch (Trays0417 vs Tray0417) still records correctly.
                    setObsTray(findTrays(trays, label)[0]?.trayNumber ?? label)
                  }}
                />
                <label className="block">
                  <span className="label">Stack</span>
                  <select className="input w-24" value={obsStack} onChange={(e) => setObsStack(e.target.value)}>
                    {STACK_POSITIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Depth</span>
                  <select className="input w-24" value={obsDepth} onChange={(e) => setObsDepth(e.target.value)}>
                    {DEPTH_POSITIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Cells</span>
                  <input className="input w-16" type="number" value={obsCells} onChange={(e) => setObsCells(e.target.value)} />
                </label>
                <label className="block min-w-48 flex-1">
                  <span className="label">Stage seen</span>
                  <select className="input w-full" value={obsStage} onChange={(e) => setObsStage(e.target.value)}>
                    <option value="">Choose a stage…</option>
                    {DEV_STAGES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <button className="btn-ghost" onClick={addObservation} disabled={!obsTray.trim() || !obsStage}>
                  Add tray
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-end gap-3">
              <label className="block flex-1">
                <span className="label">Notes</span>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you see?" />
              </label>
              <button className="btn-primary" onClick={submit}>
                Save inspection
              </button>
            </div>
            <p className="mt-1 text-xs text-faint">Logged as {s.user.name}.</p>
          </section>
        )}

        {/* Inspection history */}
        <section>
          <h3 className="mb-2 font-semibold">Inspection history</h3>
          {mine.length === 0 ? (
            <p className="text-sm text-muted">No inspections logged yet.</p>
          ) : (
            <ul className="divide-y divide-subtle rounded-lg border border-subtle">
              {mine.map((i) => (
                <li key={i.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {i.period && <Badge tone="brand">{i.period}</Badge>}
                    {i.healthScore > 0 && <Badge tone={healthTone(i.healthScore)}>{i.healthScore}</Badge>}
                    {i.thermometerTempC != null && (
                      <span className="text-xs text-secondary">
                        therm {formatTemp(i.thermometerTempC)}
                        {i.goveeTempC != null && <> · govee {formatTemp(i.goveeTempC)}</>}
                        {i.tempDiffC != null && (
                          <>
                            {' · Δ '}
                            <span className={i.tempAlert ? 'font-semibold text-danger' : 'text-muted'}>
                              {i.tempDiffC > 0 ? '+' : ''}
                              {i.tempDiffC}°C
                            </span>
                          </>
                        )}
                      </span>
                    )}
                    {inspectionChips(i)}
                  </div>
                  {i.notes && <div className="mt-1 text-sm text-primary">{i.notes}</div>}
                  {/* Trays examined during this inspection. */}
                  {trayInspections
                    .filter((t) => t.inspectionId === i.id)
                    .map((t) => (
                      <div key={t.id} className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-mono text-secondary">{t.trayNumber}</span>
                        <span>
                          {t.stackPosition} / {t.depthPosition}
                          {t.cellsOpened != null ? ` · ${t.cellsOpened} cells` : ''}
                        </span>
                        <span className="text-secondary">{t.devStage}</span>
                        {t.notes && <span>“{t.notes}”</span>}
                      </div>
                    ))}
                  <div className="mt-0.5 text-xs text-faint">
                    {fmtWhen(i.at)}
                    {i.inspector ? ` · ${i.inspector}` : ''}
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
