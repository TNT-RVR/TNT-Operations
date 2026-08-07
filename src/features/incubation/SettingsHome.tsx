import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Card, Button, Input, NoAccess } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import {
  TEMP_MODES,
  goalTempKey,
  goalHumidityKey,
  resolveModeGoals,
  cToF,
  type TempMode,
} from '@/domain/incubation'

/**
 * Per-mode goal temperature and humidity — the desktop app's mode settings.
 *
 * Two things live in a temperature mode and they are NOT the same:
 *
 *   • the GOAL — where the mode aims, editable here, one setting shared by
 *     every incubator (as it was in the old app);
 *   • the ALERT BAND — how far it may drift before someone is woken up. Fixed,
 *     and shown here read-only. The cloud poller carries its own copy of the
 *     bands (netlify/functions/poll-govee.mjs), so an editable band on this
 *     screen would change the display without changing what actually alerts.
 *
 * A blank box means "use the default", matching the desktop behaviour.
 */

/** Modes with something to aim at. Off has no goal and no band. */
const EDITABLE_MODES = (Object.keys(TEMP_MODES) as TempMode[]).filter((m) => m !== 'off')

/** How a single number is edited: local text until saved, so a half-typed
 *  "3" on the way to "31" never lands in the database. */
function GoalField({
  label,
  unit,
  saved,
  fallback,
  canEdit,
  onSave,
}: {
  label: string
  unit: string
  saved: string | undefined
  fallback: number | null
  canEdit: boolean
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [text, setText] = useState(saved ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Follow the stored value when it changes underneath us (hydration, or
  // another device saving), but never while a save is in flight.
  useEffect(() => {
    if (status !== 'saving') setText(saved ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])

  const dirty = text.trim() !== (saved ?? '').trim()

  const commit = async () => {
    if (!dirty) return
    const raw = text.trim()
    if (raw !== '' && !Number.isFinite(Number(raw))) {
      setStatus('error')
      setError('Enter a number, or leave it blank for the default.')
      return
    }
    setStatus('saving')
    setError(null)
    const res = await onSave(raw)
    if (res.ok) {
      setStatus('saved')
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2000)
    } else {
      setStatus('error')
      setError(res.error ?? 'Could not save.')
    }
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="label">
        {label} <span className="text-faint">({unit})</span>
      </span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step="0.5"
          className="w-28"
          disabled={!canEdit}
          value={text}
          placeholder={fallback == null ? '—' : String(fallback)}
          onChange={(e) => {
            setText(e.target.value)
            setStatus('idle')
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setText(saved ?? '')
              setStatus('idle')
            }
          }}
        />
        {canEdit && dirty && status !== 'saving' && (
          <Button onClick={commit} className="px-2 py-1 text-xs">
            Save
          </Button>
        )}
        {status === 'saving' && <span className="text-xs text-faint">Saving…</span>}
        {status === 'saved' && <span className="text-xs text-green-600">Saved</span>}
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {!error && !dirty && (saved ?? '').trim() === '' && fallback != null && (
        <span className="text-xs text-faint">Using the default, {fallback}.</span>
      )}
    </label>
  )
}

export default function SettingsHome() {
  const { settings, saveSetting } = useData()
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')
  if (!s.can('incubation', 'view')) return <NoAccess />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incubation settings"
        subtitle="Goal temperature and humidity for each temperature mode. One setting for every incubator."
      />

      {!canEdit && (
        <p className="text-sm text-muted">
          You can see these but not change them. Ask an admin or operator to edit.
        </p>
      )}

      {EDITABLE_MODES.map((mode) => (
        <ModeCard key={mode} mode={mode} settings={settings} canEdit={canEdit} onSave={saveSetting} />
      ))}

      <p className="text-xs text-faint">
        Alert bands are fixed and are not the same as the goals: the goal is where a mode aims, the
        band is how far it may drift before an alert is sent. The cloud monitor keeps its own copy of
        the bands so alerting can&apos;t be changed by accident here.
      </p>
    </div>
  )
}

function ModeCard({
  mode,
  settings,
  canEdit,
  onSave,
}: {
  mode: TempMode
  settings: Record<string, string>
  canEdit: boolean
  onSave: (key: string, value: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const cfg = TEMP_MODES[mode]
  const goals = useMemo(() => resolveModeGoals(mode, settings), [mode, settings])

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-primary">{cfg.label}</h3>
      <div className="flex flex-wrap items-start gap-6">
        <GoalField
          label="Goal temperature"
          unit="°C"
          saved={settings[goalTempKey(mode)]}
          fallback={cfg.goalTempC}
          canEdit={canEdit}
          onSave={(v) => onSave(goalTempKey(mode), v)}
        />
        <GoalField
          label="Goal humidity"
          unit="%"
          saved={settings[goalHumidityKey(mode)]}
          fallback={cfg.goalHumidityPct}
          canEdit={canEdit}
          onSave={(v) => onSave(goalHumidityKey(mode), v)}
        />
        <div className="flex flex-col gap-1">
          <span className="label">In force</span>
          <span className="text-sm text-secondary">
            {goals.tempC == null ? '—' : `${goals.tempC} °C (${Math.round(cToF(goals.tempC))} °F)`}
            {goals.humidityPct == null ? '' : ` · ${goals.humidityPct}% RH`}
          </span>
          <span className="text-xs text-faint">
            Alerts outside {cfg.min}–{cfg.max} °C
          </span>
        </div>
      </div>
    </Card>
  )
}
