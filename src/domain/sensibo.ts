/**
 * Sensibo AC control for the incubators — the rules, without the plumbing.
 *
 * Ported from the desktop app's sensibo_client.py, including its central
 * decision: MANUAL CONTROL ONLY. No closed loop, no thermostat behaviour, no
 * acting on a sensor reading. The app changes the AC when a person presses a
 * button, and not otherwise — anything else would have software deciding the
 * temperature of three million live bees on the strength of one sensor.
 *
 * The units run in FAHRENHEIT. Targets are entered, sent and displayed in °F,
 * matching the equipment and the desktop app, even though every other
 * temperature in this system is Celsius.
 */

/** Fan levels most units accept. A unit that refuses one says so, and that
 *  error is shown rather than swallowed — the set varies by AC model. */
export const FAN_LEVELS = ['auto', 'low', 'medium', 'high'] as const
export type FanLevel = (typeof FAN_LEVELS)[number]

/** Modes worth exposing. Heat and cool are what an incubator actually uses. */
export const AC_MODES = ['heat', 'cool', 'fan', 'dry', 'auto'] as const
export type AcMode = (typeof AC_MODES)[number]

/** The equipment's own range, in °F. Matches the desktop app. */
export const MIN_TEMP_F = 62
export const MAX_TEMP_F = 86

export interface AcState {
  on?: boolean
  mode?: string
  targetTemperature?: number
  temperatureUnit?: string
  fanLevel?: string
}

/**
 * Split a stored device-id field into a clean list.
 *
 * An incubator may have MORE THAN ONE AC unit; their ids live comma-separated
 * in a single column and are controlled together — telling one head pump to
 * heat while its neighbour cools would fight itself.
 */
export function parseDeviceIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  return String(raw)
    .replace(/[;\n]/g, ',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface TempCheck {
  ok: boolean
  message?: string
}

/**
 * Whether a target temperature can be sent.
 *
 * Refused outside the equipment's range rather than clamped: silently sending
 * 86 when someone asked for 95 would leave them believing the incubator is
 * somewhere it isn't.
 */
export function checkTargetF(f: number): TempCheck {
  if (!Number.isFinite(f)) return { ok: false, message: 'Enter a temperature.' }
  if (!Number.isInteger(f)) return { ok: false, message: 'These units take whole degrees.' }
  if (f < MIN_TEMP_F || f > MAX_TEMP_F) {
    return { ok: false, message: `The units accept ${MIN_TEMP_F}–${MAX_TEMP_F}°F. ${f}°F is outside that.` }
  }
  return { ok: true }
}

/** °F → °C, for showing an AC target next to the incubator's Celsius band. */
export const fToC = (f: number): number => ((f - 32) * 5) / 9
/** °C → °F, rounded to the whole degrees the units take. */
export const cToF = (c: number): number => Math.round((c * 9) / 5 + 32)

/**
 * Merge a requested change over the current state.
 *
 * Only the named fields change. Setting a temperature must not turn a unit on,
 * and toggling power must not silently reset a mode someone chose — so the
 * current state is read first and used as the base.
 */
export function mergeAcState(
  current: AcState | null,
  change: { on?: boolean; targetTemperature?: number; mode?: string; fanLevel?: string },
): AcState {
  // No known state: start somewhere sane rather than sending a bare command.
  const base: AcState = current ?? {
    on: false,
    mode: change.mode ?? 'heat',
    targetTemperature: change.targetTemperature ?? 72,
    temperatureUnit: 'F',
  }
  const next: AcState = { ...base }
  if (change.on !== undefined) next.on = change.on
  if (change.mode !== undefined) next.mode = change.mode
  if (change.targetTemperature !== undefined) {
    next.targetTemperature = change.targetTemperature
    // Always state the unit alongside the number. A target sent without it can
    // be read as Celsius by the unit, which is a 40-degree mistake.
    next.temperatureUnit = 'F'
  }
  if (change.fanLevel !== undefined) next.fanLevel = change.fanLevel
  return next
}

/**
 * A short human description of what an AC is doing, for the incubator card.
 */
export function describeAcState(state: AcState | null): string {
  if (!state) return 'No reading'
  if (state.on === false) return 'Off'
  const bits: string[] = []
  if (state.mode) bits.push(state.mode)
  if (state.targetTemperature != null) {
    const unit = state.temperatureUnit === 'C' ? 'C' : 'F'
    bits.push(`${state.targetTemperature}°${unit}`)
  }
  if (state.fanLevel && state.fanLevel !== 'auto') bits.push(`fan ${state.fanLevel}`)
  return bits.length ? `On · ${bits.join(' · ')}` : 'On'
}

/**
 * Whether an AC target contradicts the incubation mode the incubator is set to.
 *
 * Advisory only — it never changes anything, it just says so. A heat pump set
 * to 62°F while the incubator is supposed to be holding 30°C is a mistake
 * worth seeing before the bees find out.
 */
export function targetDisagreesWith(
  state: AcState | null,
  bandC: [number | null, number | null],
): string | null {
  if (!state || state.on === false || state.targetTemperature == null) return null
  const [minC, maxC] = bandC
  if (minC == null || maxC == null) return null
  const targetC = state.temperatureUnit === 'C' ? state.targetTemperature : fToC(state.targetTemperature)
  if (targetC < minC - 1) {
    return `The AC is set to ${targetC.toFixed(0)}°C, below this mode's ${minC}–${maxC}°C band.`
  }
  if (targetC > maxC + 1) {
    return `The AC is set to ${targetC.toFixed(0)}°C, above this mode's ${minC}–${maxC}°C band.`
  }
  return null
}
