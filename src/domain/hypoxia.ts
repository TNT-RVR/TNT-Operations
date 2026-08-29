/**
 * The hypoxia chamber contract — telemetry in, commands out.
 *
 * Controlled-atmosphere storage for leafcutter bees: a chamber holds its oxygen
 * down near 10% by purging with nitrogen, which slows the bees' metabolism and
 * is meant to let them store far longer than cold alone allows.
 *
 * ── The hardware, and why this file exists ──────────────────────────────────
 *
 * An Arduino Nano runs each chamber: it reads O2, temperature and humidity, and
 * drives two valves, a blower, a circulation fan and a servo blast door. It
 * emits ONE JSON line of telemetry and accepts short text commands. An ESP32-C3
 * sits beside it as a bridge — UART to the Nano, Wi-Fi/BLE out — and forwards
 * that line verbatim to ThingsBoard, which is where commands come back from.
 *
 * So the Nano's line and its command words ARE the contract, and this module is
 * that contract written down once, in the app's own terms. Ported from
 * `TNT2_NANO.ino` (telemetry at `sendTelemetry`, commands at the `cmd` handler).
 * If the firmware changes, this is what has to change with it.
 *
 * Pure functions — no React, no network. Transport lives elsewhere.
 */

/** One telemetry line, as the app wants it. */
export interface HypoxiaReading {
  /** Which chamber the Nano thinks it is. */
  pod: number
  /** Oxygen, percent by volume. Ambient air is ~20.9. */
  o2Pct: number
  tempC: number
  /** Relative humidity, whole percent. */
  rhPct: number
  /** Nitrogen inlet and exhaust valves. */
  valve1: boolean
  valve2: boolean
  /** Blower and circulation fan duty, 0–255 as the firmware drives them. */
  blowerDuty: number
  circulationDuty: number
  /** A purge cycle is running: door open, blower on, then reseal. */
  purging: boolean
  /**
   * Maintenance mode. The chamber stops regulating and lets a person drive the
   * valves by hand — so a reading taken in maintenance is not evidence the
   * control loop is working.
   */
  maintenance: boolean
  warn: boolean
  error: boolean
}

/** Ambient oxygen, for sanity-checking a sensor rather than trusting it. */
export const AIR_O2_PCT = 20.9

/** Firmware defaults, from TNT2_NANO.ino: 10.0% target, 1.0% deadband. */
export const DEFAULT_SETPOINT_PCT = 10
export const DEFAULT_DEADBAND_PCT = 1

/**
 * Parse the Nano's line.
 *
 * Deliberately strict about the numbers and forgiving about nothing. A chamber
 * reporting a value this cannot read is a chamber whose state is unknown, and
 * unknown must not arrive in the app as a plausible-looking zero — 0% oxygen is
 * a readable number and a catastrophic one.
 */
export function parseTelemetry(raw: unknown): HypoxiaReading | null {
  const j = typeof raw === 'string' ? safeJson(raw) : raw
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>

  const num = (k: string): number | null => {
    const v = o[k]
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const flag = (k: string): boolean => num(k) === 1

  const o2 = num('o2')
  const t = num('t')
  const rh = num('rh')
  // Without these three there is no reading, only a heartbeat.
  if (o2 === null || t === null || rh === null) return null
  // The sensor cannot legitimately report these, so they are a fault, not data.
  if (o2 < 0 || o2 > 100) return null

  return {
    pod: num('pod') ?? 1,
    o2Pct: o2,
    tempC: t,
    rhPct: rh,
    valve1: flag('v1'),
    valve2: flag('v2'),
    blowerDuty: num('blow') ?? 0,
    circulationDuty: num('circ') ?? 0,
    purging: flag('purge'),
    maintenance: flag('maint'),
    warn: flag('w'),
    error: flag('e'),
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What a command does to a chamber full of bees, which decides how the UI
 * should treat it.
 *
 *   routine    everyday operation; a button is enough.
 *   setpoint   changes what the chamber aims for; worth confirming the number.
 *   manual     drives an output DIRECTLY, with the control loop bypassed. A
 *              valve left open is a chamber that does not hold its atmosphere,
 *              and nothing in the firmware closes it for you.
 *   calibration takes the sensor out of service while it runs.
 */
export type CommandRisk = 'routine' | 'setpoint' | 'manual' | 'calibration'

export interface HypoxiaCommand {
  /** The exact string the firmware matches on. */
  wire: string
  label: string
  risk: CommandRisk
  /** Why someone would send it, in the words of the person sending it. */
  hint: string
}

/**
 * Tenths, not percent.
 *
 * `SP=` and `DB=` are parsed by `parseTenths` in the firmware: `SP=100` is
 * 10.0%, not 100%. Sending a percent figure straight through would set the
 * target to 1.0% oxygen — an atmosphere that holds nothing alive — and the
 * firmware would accept it without complaint. This conversion is the only place
 * that knows, and the reason it is a function with a test rather than a `* 10`
 * at a call site.
 */
export function toTenths(percent: number): number {
  return Math.round(percent * 10)
}

/** Setpoint bounds. Nitrogen storage runs low, but not at zero. */
export const SETPOINT_MIN_PCT = 1
export const SETPOINT_MAX_PCT = 21

export function setpointCommand(percent: number): HypoxiaCommand | { error: string } {
  if (!Number.isFinite(percent)) return { error: 'Setpoint must be a number.' }
  if (percent < SETPOINT_MIN_PCT || percent > SETPOINT_MAX_PCT) {
    return {
      error: `Setpoint must be between ${SETPOINT_MIN_PCT}% and ${SETPOINT_MAX_PCT}% oxygen. Ambient air is ${AIR_O2_PCT}%.`,
    }
  }
  return {
    wire: `SP=${toTenths(percent)}`,
    label: `Set target to ${percent}% O₂`,
    risk: 'setpoint',
    hint: 'What the chamber holds. The firmware default is 10%.',
  }
}

export function deadbandCommand(percent: number): HypoxiaCommand | { error: string } {
  if (!Number.isFinite(percent) || percent <= 0) {
    return { error: 'Deadband must be more than zero, or the chamber purges constantly.' }
  }
  if (percent > 5) return { error: 'A deadband over 5% lets the chamber drift too far to be worth holding.' }
  return {
    wire: `DB=${toTenths(percent)}`,
    label: `Set deadband to ${percent}%`,
    risk: 'setpoint',
    hint: 'How far O₂ may drift before the chamber acts. Default 1%.',
  }
}

/** The fixed command vocabulary, as the firmware spells it. */
export const COMMANDS: HypoxiaCommand[] = [
  { wire: 'RUN=ON', label: 'Start regulating', risk: 'routine', hint: 'The chamber holds its setpoint on its own.' },
  { wire: 'RUN=OFF', label: 'Stop regulating', risk: 'routine', hint: 'The chamber stops acting. Oxygen drifts back to ambient.' },
  { wire: 'PURGE', label: 'Purge now', risk: 'routine', hint: 'One nitrogen purge cycle: door open, blow, reseal.' },
  { wire: 'MAINT=ON', label: 'Maintenance mode on', risk: 'manual', hint: 'Hands control to a person. The chamber stops regulating itself.' },
  { wire: 'MAINT=OFF', label: 'Maintenance mode off', risk: 'routine', hint: 'Returns the chamber to its own control.' },
  { wire: 'V1=ON', label: 'Open valve 1', risk: 'manual', hint: 'Nitrogen inlet. Stays open until you close it by hand.' },
  { wire: 'V1=OFF', label: 'Close valve 1', risk: 'manual', hint: 'Shuts the nitrogen inlet. Nothing else closes it for you.' },
  { wire: 'V2=ON', label: 'Open valve 2', risk: 'manual', hint: 'Exhaust. Stays open until you close it by hand.' },
  { wire: 'V2=OFF', label: 'Close valve 2', risk: 'manual', hint: 'Shuts the exhaust. Nothing else closes it for you.' },
  { wire: 'SERVO=OPEN', label: 'Open blast door', risk: 'manual', hint: 'The chamber cannot hold its atmosphere while this is open.' },
  { wire: 'SERVO=CLOSE', label: 'Close blast door', risk: 'manual', hint: 'Reseals the chamber so it can hold an atmosphere again.' },
  { wire: 'CAL=AIR', label: 'Calibrate to air', risk: 'calibration', hint: `Teaches the sensor that open air is ${AIR_O2_PCT}%. Do it with the chamber open.` },
  { wire: 'CAL=CHAMBER', label: 'Calibrate in chamber', risk: 'calibration', hint: 'The two-burst calibration. Takes the chamber out of service.' },
  { wire: 'CAL=ABORT', label: 'Abort calibration', risk: 'routine', hint: 'Stops a calibration and returns everything to idle.' },
]

export const commandByWire = (wire: string): HypoxiaCommand | undefined =>
  COMMANDS.find((c) => c.wire === wire.toUpperCase())

// ═══════════════════════════════════════════════════════════════════════════
// Reading a chamber's state
// ═══════════════════════════════════════════════════════════════════════════

export type ChamberVerdict = 'in-band' | 'above' | 'below' | 'purging' | 'maintenance' | 'fault'

/**
 * What a chamber is doing, in one word.
 *
 * Order matters and is the whole point. A fault outranks everything: a chamber
 * reporting an error while sitting at its setpoint is not "in band", it is a
 * chamber whose reading cannot be trusted. Maintenance outranks the band for
 * the same reason — in maintenance the loop is not running, so being at target
 * is a coincidence rather than evidence.
 */
export function chamberVerdict(
  r: HypoxiaReading,
  setpointPct: number = DEFAULT_SETPOINT_PCT,
  deadbandPct: number = DEFAULT_DEADBAND_PCT,
): ChamberVerdict {
  if (r.error) return 'fault'
  if (r.maintenance) return 'maintenance'
  if (r.purging) return 'purging'
  if (r.o2Pct > setpointPct + deadbandPct) return 'above'
  if (r.o2Pct < setpointPct - deadbandPct) return 'below'
  return 'in-band'
}

/** Plain-words state, for a card that has to be read at a glance. */
export const VERDICT_LABEL: Record<ChamberVerdict, string> = {
  'in-band': 'Holding',
  above: 'Above target',
  below: 'Below target',
  purging: 'Purging',
  maintenance: 'Maintenance',
  fault: 'Fault',
}

/**
 * How stale a reading is allowed to be before the chamber counts as silent.
 *
 * The ESP32 publishes at most every 15 seconds (`TB_PUB_MIN_MS`), so anything
 * beyond a few minutes means the bridge, the Wi-Fi or the Nano has stopped —
 * and a chamber nobody is hearing from is the one worth an alert, exactly like
 * `sensor_offline` on the incubators.
 */
export const SILENT_AFTER_MIN = 10

export function isSilent(lastSeenIso: string | null, now: Date = new Date()): boolean {
  if (!lastSeenIso) return true
  const t = Date.parse(lastSeenIso)
  if (!Number.isFinite(t)) return true
  return now.getTime() - t > SILENT_AFTER_MIN * 60_000
}
