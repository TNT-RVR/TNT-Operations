import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Flame, Power, RefreshCw, Snowflake } from 'lucide-react'
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

/**
 * A two-position switch.
 *
 * It reads like a toggle and behaves like two buttons: pressing a side sends
 * THAT command, rather than sending the opposite of whatever the app believes
 * is current. That distinction is the whole reason "off" was unreachable for
 * as long as it was — these pumps report nothing back, so a switch that flips
 * relative to a guess can end up refusing to send half its commands.
 *
 * When the state is unknown neither side is lit, which is the honest picture
 * for a pump nobody has touched through the app yet.
 */
function Switch<T extends string>({
  options,
  value,
  onPick,
  disabled,
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode; tone?: 'brand' | 'warm' | 'cold' }>
  value: T | null
  onPick: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div
      className="inline-flex rounded-pill p-0.5"
      style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-default)' }}
      role="group"
    >
      {options.map((o) => {
        const active = value === o.value
        const bg =
          o.tone === 'warm' ? 'var(--warn-bg)' : o.tone === 'cold' ? 'var(--info-bg)' : 'var(--brand)'
        const fg =
          o.tone === 'warm' ? 'var(--warn-fg)' : o.tone === 'cold' ? 'var(--info-fg)' : 'var(--on-brand)'
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(o.value)}
            className="flex items-center gap-1 rounded-pill px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50"
            style={
              active
                ? { background: bg, color: fg }
                : { background: 'transparent', color: 'var(--text-muted)' }
            }
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** One labelled line of the control panel. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-xs uppercase tracking-wide text-faint">{label}</span>
      {children}
    </div>
  )
}

interface DeviceState {
  deviceId: string
  state?: AcState | null
  /** State is what someone last SET, not something the unit reported. */
  remembered?: boolean
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
      } else if ((r.unconfirmed ?? []).length) {
        // The command was accepted and the pod still reads the other way. It
        // matters most for OFF: "done" over a heat pump that is still running
        // is how a batch gets cooked.
        setError(
          `The command was sent but ${r.unconfirmed.length === r.results.length ? 'the unit' : `${r.unconfirmed.length} of ${r.results.length} units`} ` +
            `still reads the other way. Check the heat pump itself — it may be out of range of the Sensibo, or switched at the wall.`,
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
   * Every mode and the temperature to dial in — a reference chart, not a
   * readout. Three rows; the current mode is highlighted so the one that
   * matters right now is findable without reading the others.
   */
  const setpoint = (
    <table className="text-sm">
      <tbody>
        {(Object.keys(TEMP_MODES) as TempMode[])
          .filter((m) => m !== 'off')
          .map((m) => {
            const p = heatPumpSetting(m)
            const current = m === tempMode
            return (
              <tr key={m} className={current ? 'font-semibold text-primary' : 'text-secondary'}>
                <td className="py-0.5 pr-4">{TEMP_MODES[m].label}</td>
                <td className="py-0.5 pr-2 text-right tabular-nums">
                  {p.targetF != null ? `${p.targetF}°F` : '—'}
                </td>
                <td className="py-0.5 text-right tabular-nums text-faint">{p.goalC}°C</td>
              </tr>
            )
          })}
      </tbody>
    </table>
  )

  /** Link or change the Sensibo device id(s) for this incubator. */
  const deviceEditor = (
    <div className="space-y-1">
      <p className="text-xs text-faint">
        The ID is in the Sensibo app, on the unit's settings page. Two heads take both IDs,
        separated by a comma — they're then controlled together.
      </p>
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
    </div>
  )

  if (!ids.length) {
    // No Sensibo linked: the chart is the entire point of the card. Linking is
    // a once-per-incubator job and stays behind a link rather than sitting
    // open on a screen people read every day.
    return (
      // Tighter padding than a normal card and the link on the title row: with
      // no device attached there are only four lines here, and card-standard
      // spacing left more empty space than content.
      <div className="card p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-primary">Heat pump</span>
          {canEdit && !linking && (
            <button className="text-xs text-muted underline" onClick={() => setLinking(true)}>
              Link a Sensibo device
            </button>
          )}
        </div>
        <div className="mt-1">{setpoint}</div>
        {canEdit && linking && <div className="mt-2">{deviceEditor}</div>}
      </div>
    )
  }

  const first = devices?.[0]?.state ?? null
  const remembered = !!devices?.[0]?.remembered
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
          {/* Shown when there is something to show — either the unit reported,
              or we remember what someone last set it to. A pump that has never
              been touched through the app has neither, and gets no line. */}
          {first && (
            <p className="mt-1 text-sm text-muted">
              {loading ? 'Reading…' : describeAcState(first)}
              {first.targetTemperature != null && first.on !== false && (
                <span className="text-faint"> ({fToC(first.targetTemperature).toFixed(0)}°C)</span>
              )}
              {/* Never dress a remembered command up as a reading: the pump
                  can be changed at the wall and this would not know. */}
              {remembered && <span className="text-faint"> · last set here, not confirmed by the unit</span>}
            </p>
          )}
        </div>
        {first && (
          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading || busy}>
            <RefreshCw size={14} className="mr-1 inline" />
            Refresh
          </Button>
        )}
      </div>

      {/* An AC fighting the incubation mode is worth seeing before the bees
          find out. Advisory only — nothing here changes on its own. */}
      {disagreement && <p className="text-sm text-danger">{disagreement}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {readErrors.length > 0 && (
        <p className="text-xs text-danger">
          Couldn't read {readErrors.map((d) => d.deviceId).join(', ')} — check the unit is online.
        </p>
      )}

      {/* Controls left, reference chart right — the chart is looked at WHILE
          setting the temperature, so side by side beats stacked. Wraps back to
          one column on a phone. */}
      <div className="flex flex-wrap items-start gap-4 border-t border-default pt-3">
        <div className="min-w-[20rem] flex-1 space-y-2">
          {canEdit && (
            <>
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
            /*
              Four labelled rows: power, mode, target, fan.

              These were one wrapping line, which on a narrow card broke
              wherever it felt like — power and mode buttons ending up on
              different rows from each other with a temperature box in
              between. Nothing was grouped and nothing was named, so the row
              had to be read left to right to work out what any button did.

              A row per decision, each one labelled, in the order somebody
              actually sets a pump: is it running, is it heating or cooling,
              what is it aiming for, how hard is the fan.
            */
            <div className="space-y-2">
              <Row label="Power">
                <Switch
                  value={anyOn ? 'on' : first ? 'off' : null}
                  disabled={busy}
                  onPick={(v) => (v === 'on' ? void send({ on: true }) : setConfirmOff(true))}
                  options={[
                    { value: 'on', label: 'On', icon: <Power size={14} /> },
                    { value: 'off', label: 'Off', icon: <Power size={14} /> },
                  ]}
                />
              </Row>

              {/* Heat and cool are both real incubator states — 30°C
                  incubation heats, cool storage cools — and a unit left in
                  the wrong one blows against the target all day. */}
              <Row label="Mode">
                <Switch
                  value={first?.mode === 'heat' || first?.mode === 'cool' ? first.mode : null}
                  disabled={busy}
                  onPick={(m) => void send({ mode: m })}
                  options={[
                    { value: 'heat', label: 'Heat', icon: <Flame size={14} />, tone: 'warm' },
                    { value: 'cool', label: 'Cool', icon: <Snowflake size={14} />, tone: 'cold' },
                  ]}
                />
              </Row>

              <Row label="Target">
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
                <span className="text-sm text-muted">°F</span>
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
                {/* The rest of this system is Celsius; the units are not. Show
                    what a typed °F actually means before it is sent. */}
                {tempInput.trim() !== '' && Number.isFinite(Number(tempInput)) && (
                  <span className="text-xs text-faint">
                    = {fToC(Number(tempInput)).toFixed(0)}°C
                  </span>
                )}
              </Row>

              <Row label="Fan">
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
              </Row>
            </div>
          )}
          {linking ? (
            deviceEditor
          ) : (
            <button className="text-xs text-muted underline" onClick={() => setLinking(true)}>
              {ids.length > 1 ? `${ids.length} devices linked` : `Device ${ids[0]}`} — change
            </button>
          )}
            </>
          )}
        </div>
        <div className="shrink-0">{setpoint}</div>
      </div>
    </div>
  )
}
