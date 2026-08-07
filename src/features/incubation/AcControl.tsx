import { useCallback, useEffect, useState } from 'react'
import { Power, Thermometer, Wind, RefreshCw } from 'lucide-react'
import { Button, Select } from '@/components/ui'
import { supabase } from '@/data/supabaseClient'
import { useData } from '@/data/context'
import {
  parseDeviceIds,
  describeAcState,
  targetDisagreesWith,
  checkTargetF,
  cToF,
  fToC,
  FAN_LEVELS,
  MIN_TEMP_F,
  MAX_TEMP_F,
  type AcState,
} from '@/domain/sensibo'
import { heatPumpSetting, TEMP_MODES, type TempMode } from '@/domain/incubation'

interface DeviceState {
  deviceId: string
  state?: AcState | null
  error?: string
}

/**
 * Manual AC control for one incubator's heat pump(s).
 *
 * Manual is the whole design, carried over from the desktop app: nothing here
 * runs on a timer or reacts to a sensor. Software deciding the temperature of
 * three million live bees off one thermometer is a bigger risk than a person
 * forgetting to press a button.
 *
 * Every call goes through a Netlify function — the Sensibo key controls the
 * heat on every incubator and must never be in the browser bundle.
 */
export function AcControl({
  incubatorId,
  deviceIdsRaw,
  bandC,
  tempMode,
  canEdit,
}: {
  incubatorId: string
  deviceIdsRaw: string | null | undefined
  /** The incubator's current temperature mode, for the setpoint reference. */
  tempMode: string | null | undefined
  /** The incubation mode's target band, for spotting a contradictory AC target. */
  bandC: [number | null, number | null]
  canEdit: boolean
}) {
  const { saveIncubator } = useData()
  const ids = parseDeviceIds(deviceIdsRaw)
  const [linking, setLinking] = useState(false)
  const [idInput, setIdInput] = useState(deviceIdsRaw ?? '')
  const [devices, setDevices] = useState<DeviceState[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tempInput, setTempInput] = useState('')
  const [confirmOff, setConfirmOff] = useState(false)

  const call = useCallback(
    async (method: 'GET' | 'POST', body?: Record<string, unknown>) => {
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
      const token = data.session?.access_token
      if (!token) throw new Error('Sign in first.')
      const url =
        method === 'GET'
          ? `/.netlify/functions/sensibo?deviceIds=${encodeURIComponent(ids.join(','))}`
          : '/.netlify/functions/sensibo'
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify({ ...body, deviceIds: ids.join(',') }) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`)
      return json
    },
    [ids],
  )

  const refresh = useCallback(async () => {
    if (!ids.length) return
    setLoading(true)
    setError(null)
    try {
      const r = await call('GET')
      setDevices(r.devices ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the AC.')
    } finally {
      setLoading(false)
    }
  }, [call, ids.length])

  // Read once when the incubator is opened. NOT on a timer: this talks to
  // physical equipment, and polling it from every open screen is rude.
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incubatorId, deviceIdsRaw])

  async function send(change: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const r = await call('POST', change)
      const failed = (r.results ?? []).filter((x: { ok: boolean }) => !x.ok)
      if (failed.length) {
        // Say which unit refused, rather than a blanket failure — with two
        // heads on one incubator, one failing is the thing worth knowing.
        setError(
          `${failed.length} of ${r.results.length} units refused: ${failed
            .map((f: { deviceId: string; error: string }) => `${f.deviceId} (${f.error})`)
            .join('; ')}`,
        )
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the AC.')
    } finally {
      setBusy(false)
      setConfirmOff(false)
    }
  }


  /**
   * What to set the pump to for the current mode. One line — the number is
   * the whole point, and this card already carries plenty.
   */
  const pump = heatPumpSetting(tempMode || 'off')
  const setpoint =
    pump.targetF != null ? (
      <p className="text-sm text-secondary">
        Set to <span className="text-base font-semibold text-primary">{pump.targetF}°F</span>{' '}
        <span className="text-faint">for {TEMP_MODES[(tempMode || 'off') as TempMode]?.label ?? tempMode}</span>
      </p>
    ) : pump.goalC != null ? (
      <p className="text-sm text-muted">{pump.note}</p>
    ) : null

  /** Link or change the Sensibo device id(s) for this incubator. */
  const deviceEditor = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={idInput}
        onChange={(e) => setIdInput(e.target.value)}
        placeholder="Sensibo device ID, or several separated by commas"
        className="input flex-1 min-w-[16rem]"
        aria-label="Sensibo device IDs"
      />
      <Button
        size="sm"
        onClick={() => {
          saveIncubator(incubatorId, { sensiboDeviceId: idInput.trim() || null })
          setLinking(false)
        }}
      >
        Save
      </Button>
      {ids.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIdInput(deviceIdsRaw ?? '')
            setLinking(false)
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  )

  if (!ids.length) {
    return (
      <div className="card space-y-2">
        <div className="font-semibold text-primary">Heat pump</div>
        {setpoint}
        <p className="text-xs text-muted">
          No Sensibo device is linked to this incubator. The ID is in the Sensibo app, on the unit's settings
          page. An incubator with two heads takes both, separated by a comma — they're then controlled together.
        </p>
        {canEdit && deviceEditor}
      </div>
    )
  }

  const first = devices?.[0]?.state ?? null
  const anyOn = (devices ?? []).some((d) => d.state?.on)
  const disagreement = targetDisagreesWith(first, bandC)
  const readErrors = (devices ?? []).filter((d) => d.error)

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-primary">
            Heat pump{ids.length > 1 ? `s (${ids.length}, controlled together)` : ''}
          </div>
          <p className="mt-1 text-sm text-muted">
            {loading ? 'Reading…' : describeAcState(first)}
            {first?.targetTemperature != null && first.on !== false && (
              <span className="text-faint">
                {' '}
                ({fToC(first.targetTemperature).toFixed(0)}°C)
              </span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading || busy}>
          <RefreshCw size={14} className="mr-1 inline" />
          Refresh
        </Button>
      </div>

      {setpoint}

      {/* An AC fighting the incubation mode is worth seeing before the bees
          find out. Advisory only — nothing here changes on its own. */}
      {disagreement && <p className="text-sm text-danger">{disagreement}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {readErrors.length > 0 && (
        <p className="text-xs text-danger">
          Couldn't read {readErrors.map((d) => d.deviceId).join(', ')} — check the unit is online.
        </p>
      )}

      {canEdit && (
        <div className="space-y-2 border-t border-default pt-3">
          {/* Power. Turning heat OFF on a running incubator is confirmed:
              it's a physical act on live bees and easy to hit by accident. */}
          {confirmOff ? (
            <div className="rounded-sm border border-danger p-2">
              <p className="text-sm text-danger">
                Turn the heat pump off? The incubator will stop being held at temperature.
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="danger" size="sm" onClick={() => void send({ on: false })} disabled={busy}>
                  Yes, turn it off
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmOff(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => (anyOn ? setConfirmOff(true) : void send({ on: true }))}
              >
                <Power size={14} className="mr-1 inline" />
                {anyOn ? 'Turn off' : 'Turn on'}
              </Button>

              <label className="flex items-center gap-1 text-sm text-muted">
                <Thermometer size={14} />
                <input
                  type="number"
                  min={MIN_TEMP_F}
                  max={MAX_TEMP_F}
                  step={1}
                  placeholder={String(first?.targetTemperature ?? cToF(30))}
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  className="input w-20"
                  aria-label="Target temperature in Fahrenheit"
                />
                °F
                <Button
                  size="sm"
                  disabled={busy || !tempInput.trim()}
                  onClick={() => {
                    const f = Number(tempInput)
                    const check = checkTargetF(f)
                    if (!check.ok) return setError(check.message ?? 'Bad temperature.')
                    void send({ targetTemperature: f })
                    setTempInput('')
                  }}
                >
                  Set
                </Button>
              </label>

              <label className="flex items-center gap-1 text-sm text-muted">
                <Wind size={14} />
                <Select
                  className="w-28"
                  value={first?.fanLevel ?? 'auto'}
                  onChange={(e) => void send({ fanLevel: e.target.value })}
                  disabled={busy}
                >
                  {FAN_LEVELS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          )}
          <p className="text-xs text-faint">
            These controls are manual. Nothing here follows the sensor or changes on its own — setting the
            incubator's mode above does not move the AC.
          </p>
          {linking ? (
            deviceEditor
          ) : (
            <button className="text-xs text-muted underline" onClick={() => setLinking(true)}>
              {ids.length > 1 ? `${ids.length} devices linked` : `Device ${ids[0]}`} — change
            </button>
          )}
        </div>
      )}
    </div>
  )
}
