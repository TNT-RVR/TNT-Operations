/**
 * Hypoxia — controlled-atmosphere bee storage.
 *
 * A chamber holds its oxygen near 10% by purging with nitrogen, which slows the
 * bees' metabolism and is meant to let them store far longer than cold alone
 * allows. The hardware is an Arduino Nano per chamber, bridged to ThingsBoard
 * by an ESP32-C3; a poller copies the telemetry into Supabase and commands go
 * back out through a Netlify function.
 *
 * ── What this screen is careful about ────────────────────────────────────────
 *
 * It shows the READING, never what the app believes. A chamber's stored
 * setpoint is only what was last sent — the firmware owns the real value and a
 * power cycle would return it to defaults without telling anyone. So the target
 * is shown as context beside the measurement, never in place of it.
 *
 * Manual commands are separated and gated. Opening a valve or the blast door
 * bypasses the chamber's own control, and NOTHING in the firmware closes them
 * again: a chamber left open does not hold its atmosphere. Those live behind a
 * disclosure, need a confirm, and are admin-only — enforced in the function,
 * not here, because a disabled button is a UI state rather than a gate.
 */
import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, InfoDot, Input, PageHeader, Stat } from '@/components/ui'
import { AlertTriangle, ChevronDown, Wind } from 'lucide-react'
import type { HypoxiaChamber, HypoxiaReadingRow } from '@/data/types'
import { HypoxiaChart } from './HypoxiaChart'
import { LinkChamberModal } from './LinkChamberModal'
import {
  AIR_O2_PCT,
  COMMANDS,
  SETPOINT_MAX_PCT,
  SETPOINT_MIN_PCT,
  VERDICT_LABEL,
  chamberVerdict,
  isSilent,
  setpointCommand,
  type ChamberVerdict,
  type HypoxiaReading,
} from '@/domain/hypoxia'

const TZ = 'America/Edmonton'
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const TONE: Record<ChamberVerdict, 'green' | 'amber' | 'red' | 'blue' | 'neutral'> = {
  'in-band': 'green',
  above: 'amber',
  below: 'amber',
  purging: 'blue',
  maintenance: 'neutral',
  fault: 'red',
}

/** A stored row read as the domain reads a live line. */
function asReading(r: HypoxiaReadingRow): HypoxiaReading {
  return {
    pod: 0,
    o2Pct: r.o2Pct,
    tempC: r.tempC ?? 0,
    rhPct: r.rhPct ?? 0,
    valve1: r.valve1,
    valve2: r.valve2,
    blowerDuty: r.blowerDuty,
    circulationDuty: r.circulationDuty,
    purging: r.purging,
    maintenance: r.maintenance,
    warn: r.warn,
    error: r.error,
  }
}

export default function HypoxiaHome() {
  const { hypoxiaChambers, hypoxiaReadings, loadHypoxia } = useData()
  const s = useSession()
  const [loading, setLoading] = useState(true)
  const [linking, setLinking] = useState(false)
  // Linking picks which physical box gets valve and blast-door commands, so it
  // is admin-only here and refused server-side for anyone else.
  const canLink = s.user.role === 'admin' || s.user.role === 'developer'

  useEffect(() => {
    void loadHypoxia().finally(() => setLoading(false))
  }, [loadHypoxia])

  /** Newest reading per chamber. The list arrives newest-first. */
  const latest = useMemo(() => {
    const m = new Map<string, HypoxiaReadingRow>()
    for (const r of hypoxiaReadings) if (!m.has(r.chamberId)) m.set(r.chamberId, r)
    return m
  }, [hypoxiaReadings])

  return (
    <div>
      <PageHeader
        title="Hypoxia"
        subtitle="Controlled-atmosphere storage — oxygen held low with nitrogen purges"
        actions={canLink ? <Button onClick={() => setLinking(true)}>Add chamber</Button> : undefined}
      />
      {linking && <LinkChamberModal onClose={() => setLinking(false)} />}
      <div className="space-y-4 p-4 md:p-6">
        {loading ? (
          <p className="text-sm text-muted">Loading chambers…</p>
        ) : hypoxiaChambers.length === 0 ? (
          <EmptyState>
            {canLink
              ? 'No chambers yet. Press “Add chamber” to pick one of your ThingsBoard devices — the app will read its telemetry and send its commands there.'
              : 'No chambers yet. An admin needs to link each one to its ThingsBoard device.'}
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {hypoxiaChambers.map((c) => (
              <ChamberCard key={c.id} chamber={c} reading={latest.get(c.id) ?? null} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ChamberCard({ chamber, reading }: { chamber: HypoxiaChamber; reading: HypoxiaReadingRow | null }) {
  const s = useSession()
  const { sendHypoxiaCommand } = useData()
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [confirming, setConfirming] = useState('')
  const [setpoint, setSetpoint] = useState(String(chamber.setpointPct))

  const canCommand = s.can('incubation', 'edit')
  // Mirrors the function's rule. The function is the gate; this only decides
  // whether to draw a button that would be refused.
  const canManual = s.user.role === 'admin' || s.user.role === 'developer'

  const silent = isSilent(chamber.lastSeenAt)
  const r = reading ? asReading(reading) : null
  const verdict = r ? chamberVerdict(r, chamber.setpointPct, chamber.deadbandPct) : null

  async function send(wire: string) {
    setBusy(wire)
    setNote('')
    const res = await sendHypoxiaCommand(chamber.id, wire)
    setBusy('')
    setConfirming('')
    setNote(res.ok ? `Sent ${wire}.` : (res.error ?? 'Could not send'))
  }

  const routine = COMMANDS.filter((c) => c.risk === 'routine')
  const manual = COMMANDS.filter((c) => c.risk !== 'routine' && c.risk !== 'setpoint')

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display font-bold text-primary">{chamber.name}</h2>
          <p className="text-xs text-muted">
            {chamber.location || 'No location set'}
            {!chamber.hasKey && ' · no device key'}
          </p>
        </div>
        {silent ? <Badge tone="red">Silent</Badge> : verdict && <Badge tone={TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>}
      </div>

      {/*
        A chamber nobody is hearing from is the worst state to be unaware of, so
        it replaces the readings rather than sitting beside stale ones that
        still look like measurements.
      */}
      {silent ? (
        <div className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-xs text-secondary">
          <p className="mb-1 flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle size={14} /> Not reporting
          </p>
          {chamber.lastSeenAt
            ? `Last heard from ${when(chamber.lastSeenAt)}. The figures below would be that old, so they are not shown.`
            : 'This chamber has never reported. Check the bridge is powered and on Wi-Fi.'}
        </div>
      ) : r && reading ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Oxygen" value={`${r.o2Pct.toFixed(1)}%`} hint={`target ${chamber.setpointPct}% ±${chamber.deadbandPct}`} />
            <Stat label="Temperature" value={reading.tempC == null ? '—' : `${reading.tempC.toFixed(1)}°C`} />
            <Stat label="Humidity" value={reading.rhPct == null ? '—' : `${reading.rhPct}%`} />
          </div>
          <p className="text-xs text-faint">
            Read {when(reading.at)} · air is {AIR_O2_PCT}%
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
            <span>Valve 1 {r.valve1 ? 'open' : 'closed'}</span>
            <span>Valve 2 {r.valve2 ? 'open' : 'closed'}</span>
            <span>Blower {r.blowerDuty}</span>
            <span>Circulation {r.circulationDuty}</span>
            {r.warn && <span className="text-warn">Warning flag</span>}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">No readings stored yet.</p>
      )}

      {/*
        History. Shown even while the chamber is silent — what it was doing
        before it went quiet is exactly what somebody wants at that moment.
      */}
      <div className="border-t border-subtle pt-3">
        <HypoxiaChart
          chamberId={chamber.id}
          setpointPct={chamber.setpointPct}
          deadbandPct={chamber.deadbandPct}
        />
      </div>

      {canCommand && (
        <div className="space-y-3 border-t border-subtle pt-3">
          <div className="flex flex-wrap gap-2">
            {routine.map((c) => (
              <Button
                key={c.wire}
                variant={c.wire === 'PURGE' ? 'primary' : 'ghost'}
                onClick={() => send(c.wire)}
                disabled={!!busy || !chamber.hasKey}
              >
                {busy === c.wire ? 'Sending…' : c.label}
              </Button>
            ))}
            <InfoDot
              note={{
                title: 'Everyday controls',
                body: routine.map((c) => `${c.label} — ${c.hint}`),
              }}
            />
          </div>

          {/* Setpoint: a number worth confirming, so it is typed rather than nudged. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="label">Target O₂ (%)</span>
              <Input
                type="number"
                step="0.1"
                min={SETPOINT_MIN_PCT}
                max={SETPOINT_MAX_PCT}
                className="w-28"
                value={setpoint}
                onChange={(e) => setSetpoint(e.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              disabled={!!busy || !chamber.hasKey}
              onClick={() => {
                const built = setpointCommand(Number(setpoint))
                if ('error' in built) return setNote(built.error)
                void send(built.wire)
              }}
            >
              Set target
            </Button>
          </div>

          {/*
            Manual controls, behind a disclosure and a confirm.

            Each of these bypasses the chamber's own control and stays that way
            until somebody undoes it — the firmware will not. Admin-only, and
            the function refuses anyone else regardless of what is drawn here.
          */}
          <details open={showManual} onToggle={(e) => setShowManual((e.target as HTMLDetailsElement).open)}>
            <summary className="group inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted">
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
              Manual and calibration
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-xs text-warn">
                These bypass the chamber&rsquo;s own control and stay that way until you undo them. A valve or the
                blast door left open means the chamber is not holding its atmosphere.
              </p>
              {!canManual && (
                <p className="text-xs text-muted">Admins only — the server refuses these from other accounts.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {manual.map((c) => (
                  <span key={c.wire} className="inline-flex items-center gap-1">
                    {confirming === c.wire ? (
                      <>
                        <Button variant="danger" disabled={!!busy} onClick={() => send(c.wire)}>
                          Confirm {c.label}
                        </Button>
                        <button className="text-xs text-muted underline" onClick={() => setConfirming('')}>
                          cancel
                        </button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={!canManual || !!busy || !chamber.hasKey}
                        onClick={() => setConfirming(c.wire)}
                      >
                        {c.label}
                      </Button>
                    )}
                    <InfoDot note={{ title: c.label, body: [c.hint] }} />
                  </span>
                ))}
              </div>
            </div>
          </details>

          {note && <p className="text-xs text-secondary">{note}</p>}
          {!chamber.hasKey && (
            <p className="flex items-center gap-2 text-xs text-warn">
              <Wind size={14} /> No device key issued, so nothing is listening for commands.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
