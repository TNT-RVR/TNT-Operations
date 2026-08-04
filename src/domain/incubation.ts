/**
 * Incubation timing + weight/threshold math. Pure functions — no React, no DB.
 *
 * TWO layers live here:
 *
 *  1. `incubationProgress` — an APP-side convenience (progress bar + coarse
 *     stage) used by the dashboard and incubation screens. It has NO counterpart
 *     in the old Python; the old app tracked "incubation day" and discrete event
 *     dates instead (see layer 2). Keep it, but it is not the authority.
 *
 *  2. A faithful port of `bee-incubation/incubation_calc.py` — the authoritative
 *     leafcutter-bee business math: raw-weight / tray-volume calculations, the
 *     temperature-mode presets + threshold checks, upcoming-event extraction, and
 *     unit conversion. Ported operation-for-operation and locked with tests.
 *
 * Day arithmetic difference from the Python: the old code compared against the
 * machine's LOCAL `datetime.now()`. Because TNT Operations stores everything in
 * UTC (see CLAUDE.md), the ported date helpers take an explicit `now: Date` and
 * compare UTC calendar days — deterministic and testable, no hidden clock.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1 — app progress helper (no Python counterpart)
// ═══════════════════════════════════════════════════════════════════════════

/** Default incubation length for leafcutter bees at ~30°C, in days. */
/**
 * How long a run is working toward — Expected Release, day 23 of the milestone
 * schedule (see INCUBATION_MILESTONES).
 *
 * This was 21, which matched nothing: every run past day 21 read "100% · 0d
 * left" while the calendar still had Expected Release and Latest Release ahead
 * of it. A drift test pins this to the milestone.
 */
export const DEFAULT_INCUBATION_DAYS = 23

export type Stage = 'idle' | 'early' | 'mid' | 'emergence' | 'complete'

export interface IncubationProgress {
  /** Past the expected-release day — the run is running long, not finished. */
  overdue: boolean
  /** Whole days past the expected release (0 when not overdue). */
  daysOverdue: number
  daysElapsed: number
  daysRemaining: number
  pct: number
  stage: Stage
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Progress of an incubation batch.
 * @param startedAt ISO UTC start, or null when idle.
 * @param now       ISO UTC "current" time (passed in so callers stay testable).
 * @param days      Expected incubation length (defaults to 21).
 */
export function incubationProgress(
  startedAt: string | null,
  now: string,
  days: number = DEFAULT_INCUBATION_DAYS,
): IncubationProgress {
  if (!startedAt)
    return { daysElapsed: 0, daysRemaining: days, pct: 0, stage: 'idle', overdue: false, daysOverdue: 0 }

  const elapsedMs = Date.parse(now) - Date.parse(startedAt)
  const daysElapsed = Math.max(0, elapsedMs / DAY_MS)
  const daysRemaining = Math.max(0, days - daysElapsed)
  const pct = Math.max(0, Math.min(100, (daysElapsed / days) * 100))

  let stage: Stage
  if (pct >= 100) stage = 'complete'
  else if (pct >= 85) stage = 'emergence'
  else if (pct >= 40) stage = 'mid'
  else stage = 'early'

  const daysOverdue = Math.max(0, daysElapsed - days)
  return {
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysRemaining: Math.round(daysRemaining * 10) / 10,
    pct: Math.round(pct),
    stage,
    overdue: daysOverdue > 0,
    daysOverdue: Math.round(daysOverdue),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2 — faithful port of incubation_calc.py
// ═══════════════════════════════════════════════════════════════════════════

/** Python `round()` — round half to even ("banker's rounding"). */
function pyRound(value: number, ndigits = 0): number {
  if (!Number.isFinite(value)) return value
  const m = 10 ** ndigits
  const scaled = value * m
  const floor = Math.floor(scaled)
  const frac = scaled - floor
  const rounded =
    Math.abs(frac - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled)
  return rounded / m
}

/** Format a number the way Python's `str(float)` would (integers keep a `.0`). */
function pyFloatStr(v: number): string {
  return Number.isInteger(v) ? `${v}.0` : `${v}`
}

// ── Weight / Volume calculations ──────────────────────────────────────────────

/**
 * Pounds of raw (ungraded) bee cells needed to fill one tray with `targetGals`
 * gallons of LIVE bees. `livePct` is a 0–1 fraction (e.g. 0.82 for 82% live).
 * Mirrors `calc_raw_weight_per_tray`.
 */
export function calcRawWeightPerTray(livePct: number, targetGals = 2.0, lbsPerGal = 2.2): number {
  if (livePct <= 0) return 0.0
  const rawGalsNeeded = targetGals / livePct
  return pyRound(rawGalsNeeded * lbsPerGal, 3)
}

export interface SampleSummary {
  liveGalsTotal: number
  trayCountExact: number
  trayCount: number
  rawGalsPerTray: number
  rawLbsPerTray: number
}

/**
 * From a sample's total raw volume + live %, derive live-bee gallons, how many
 * trays it fills, and the raw load per tray. Mirrors `calc_sample_summary`.
 */
export function calcSampleSummary(
  totalVolumeGal: number,
  livePct: number,
  targetGalsPerTray = 2.0,
  lbsPerGal = 2.2,
): SampleSummary {
  if (!totalVolumeGal || !livePct || livePct <= 0) {
    return {
      liveGalsTotal: 0.0,
      trayCountExact: 0.0,
      trayCount: 0,
      rawGalsPerTray: 0.0,
      rawLbsPerTray: 0.0,
    }
  }
  const liveGals = totalVolumeGal * livePct
  const trayCountExact = liveGals / targetGalsPerTray
  const trayCount = Math.trunc(trayCountExact)
  const rawGalsPerTray = targetGalsPerTray / livePct
  return {
    liveGalsTotal: pyRound(liveGals, 2),
    trayCountExact: pyRound(trayCountExact, 2),
    trayCount,
    rawGalsPerTray: pyRound(rawGalsPerTray, 3),
    rawLbsPerTray: pyRound(rawGalsPerTray * lbsPerGal, 3),
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

interface Ymd {
  year: number
  month: number
  day: number
}

/** UTC calendar-day number (days since the Unix epoch). */
function utcDayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

function nowDayNumber(now: Date): number {
  return utcDayNumber(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
}

/** Build a validated Y-M-D, rejecting overflow (e.g. month 13, Feb 30). */
function mkYmd(year: number, month: number, day: number): Ymd | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) {
    return null
  }
  return { year, month, day }
}

/**
 * Parse an ISO or common date string (uses the first 10 chars, like the Python).
 * Tries `%Y-%m-%d`, then `%m/%d/%Y`, then `%d/%m/%Y`. Mirrors `parse_date`.
 */
export function parseDate(dateStr: string | null | undefined): Ymd | null {
  if (!dateStr) return null
  const s = dateStr.slice(0, 10)
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const r = mkYmd(+m[1], +m[2], +m[3])
    if (r) return r
  }
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  if (m) {
    const md = mkYmd(+m[3], +m[1], +m[2]) // %m/%d/%Y
    if (md) return md
    const dm = mkYmd(+m[3], +m[2], +m[1]) // %d/%m/%Y
    if (dm) return dm
  }
  return null
}

/** Signed whole days from `now` to `dateStr` (negative = past). Mirrors `days_from_now`. */
export function daysFromNow(dateStr: string | null | undefined, now: Date): number | null {
  const d = parseDate(dateStr)
  if (d === null) return null
  return utcDayNumber(d.year, d.month, d.day) - nowDayNumber(now)
}

/** Human-readable relative day. Mirrors `format_days` (its code, not its docstring). */
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 0) return `in ${days}d`
  return `${Math.abs(days)}d ago`
}

// ── Event extraction ──────────────────────────────────────────────────────────

/** A leafcutter incubation batch — the fields the calc reads (all optional). */
export interface Batch {
  id?: string | number
  name?: string | null
  incubatorName?: string | null
  startDate?: string | null
  vaponaIn?: string | null
  vaponaOut?: string | null
  airOut?: string | null
  male10pctEmergence?: string | null
  earliestCool?: string | null
  estimatedRelease?: string | null
  latestRelease?: string | null
}

export interface BatchEvent {
  label: string
  date: string
  daysAway: number
  urgent: boolean
  batchName: string
  batchId: string | number | undefined
  incubatorName: string
}

/** (batch field, display label) pairs, in the Python's order. */
export const BATCH_EVENT_FIELDS: Array<[keyof Batch, string]> = [
  ['vaponaIn', 'Vapona In'],
  ['vaponaOut', 'Vapona Out'],
  ['airOut', 'Air Out'],
  ['male10pctEmergence', '10% Male Emergence'],
  ['earliestCool', 'Earliest Cool'],
  ['estimatedRelease', 'Est. Release'],
  ['latestRelease', 'Latest Release'],
]

/** Stable ascending sort by `daysAway` (ties keep insertion order). */
function sortByDaysAway(events: BatchEvent[]): BatchEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.daysAway - b.e.daysAway || a.i - b.i)
    .map((x) => x.e)
}

/** Events on a batch within `lookaheadDays` of `now`. Mirrors `get_upcoming_events`. */
export function getUpcomingEvents(batch: Batch, now: Date, lookaheadDays = 30): BatchEvent[] {
  const events: BatchEvent[] = []
  for (const [field, label] of BATCH_EVENT_FIELDS) {
    const val = batch[field] as string | null | undefined
    if (!val) continue
    const days = daysFromNow(val, now)
    if (days !== null && days >= -1 && days <= lookaheadDays) {
      events.push({
        label,
        date: val.slice(0, 10),
        daysAway: days,
        urgent: days <= 1,
        batchName: batch.name || '—',
        batchId: batch.id,
        incubatorName: batch.incubatorName || '—',
      })
    }
  }
  return sortByDaysAway(events)
}

/** Upcoming events across many batches, sorted. Mirrors `get_all_events`. */
export function getAllEvents(batches: Batch[], now: Date, lookaheadDays = 30): BatchEvent[] {
  const events: BatchEvent[] = []
  for (const batch of batches) events.push(...getUpcomingEvents(batch, now, lookaheadDays))
  return sortByDaysAway(events)
}

/** Which day of incubation the batch is on (Day 1 = start date). Mirrors `get_incubation_day`. */
export function getIncubationDay(batch: Batch, now: Date): number | null {
  const start = parseDate(batch.startDate)
  if (start === null) return null
  return nowDayNumber(now) - utcDayNumber(start.year, start.month, start.day) + 1
}

// ── Temperature-mode presets + threshold checks ───────────────────────────────

export type TempMode = 'off' | 'cool_storage' | 'incubation' | 'holding'

export interface TempModeConfig {
  label: string
  min: number | null
  max: number | null
}

export const TEMP_MODES: Record<TempMode, TempModeConfig> = {
  off: { label: 'Off', min: null, max: null },
  cool_storage: { label: 'Cool Storage', min: 0.0, max: 12.0 },
  incubation: { label: 'Incubation', min: 25.0, max: 35.0 },
  holding: { label: 'Holding Temp', min: 10.0, max: 18.0 },
}

/** An incubator as the temp checks read it (the fields they touch). */
export interface IncubatorTemp {
  id?: string | number
  name?: string
  tempMode?: TempMode | string | null
}

/** [min, max] °C for the incubator's current mode, [null, null] when Off. Mirrors `get_temp_range`. */
export function getTempRange(incubator: IncubatorTemp): [number | null, number | null] {
  const mode = (incubator.tempMode || 'incubation') as string
  const cfg = (TEMP_MODES as Record<string, TempModeConfig>)[mode] ?? TEMP_MODES.incubation
  return [cfg.min, cfg.max]
}

export interface IncubatorDisplay {
  /** Human label for the current mode/state (e.g. "Incubation", "Off", "Idle"). */
  modeLabel: string
  /** Whether the incubator is running (any mode other than Off). */
  running: boolean
  /** Temperature target band for the mode, if known. */
  tempMin: number | null
  tempMax: number | null
  /** Humidity target band (real values from the DB, if present). */
  humMin: number | null
  humMax: number | null
}

/**
 * Derive display values for an incubator, preferring the live-DB temp mode +
 * humidity band and falling back to the app's simple status/target when those
 * aren't present (mock mode). Keeps the incubation screens truthful to the
 * data without each component re-deriving the same logic.
 */
export function incubatorDisplay(inc: {
  tempMode?: string | null
  humidityMin?: number | null
  humidityMax?: number | null
  status?: string
}): IncubatorDisplay {
  const key = inc.tempMode || ''
  const cfg = (TEMP_MODES as Record<string, TempModeConfig>)[key]
  if (cfg) {
    return {
      modeLabel: cfg.label,
      running: key !== 'off',
      tempMin: cfg.min,
      tempMax: cfg.max,
      humMin: inc.humidityMin ?? null,
      humMax: inc.humidityMax ?? null,
    }
  }
  // No live mode → fall back to the app's simple active/idle status.
  const active = inc.status === 'active'
  return {
    modeLabel: active ? 'Active' : 'Idle',
    running: active,
    tempMin: null,
    tempMax: null,
    humMin: inc.humidityMin ?? null,
    humMax: inc.humidityMax ?? null,
  }
}

/**
 * Out-of-range problems for a reading (empty = OK). Off mode → no alerts.
 * Note: like the Python, `humidity` is accepted but not yet checked.
 * Mirrors `check_temp_humidity`.
 */
export function checkTempHumidity(
  incubator: IncubatorTemp,
  tempC: number,
  _humidity: number,
): string[] {
  const problems: string[] = []
  const name = incubator.name ?? `Incubator ${incubator.id ?? '?'}`
  const [tMin, tMax] = getTempRange(incubator)
  if (tMin === null || tMax === null) return problems // Off mode

  if (tempC < tMin) {
    problems.push(`${name}: Temp ${tempC.toFixed(1)}°C below minimum ${pyFloatStr(tMin)}°C`)
  } else if (tempC > tMax) {
    problems.push(`${name}: Temp ${tempC.toFixed(1)}°C above maximum ${pyFloatStr(tMax)}°C`)
  }
  return problems
}

// ── Unit conversion ───────────────────────────────────────────────────────────

export function cToF(c: number): number {
  return pyRound((c * 9) / 5 + 32, 1)
}

export function fToC(f: number): number {
  return pyRound(((f - 32) * 5) / 9, 1)
}

export function formatTemp(tempC: number, unit: 'C' | 'F' = 'C'): string {
  if (unit === 'F') return `${cToF(tempC).toFixed(1)}°F`
  return `${tempC.toFixed(1)}°C`
}

// ── Season / units ────────────────────────────────────────────────────────────

export const LBS_PER_KG = 0.45359237

/** Pounds → kilograms, passing null through. */
export function lbsToKg(lbs: number | null | undefined): number | null {
  return lbs == null ? null : lbs * LBS_PER_KG
}

/** Per-pound → per-kilogram (e.g. bees per lb → bees per kg). */
export function perLbToPerKg(perLb: number | null | undefined): number | null {
  return perLb == null ? null : perLb / LBS_PER_KG
}

/**
 * The season a tray usage belongs to.
 *
 * There is no season column: it's derived from the tray's own operational
 * dates, newest meaningful one first. `samples.import_date` is the import
 * timestamp (uniformly 2026) and must NOT be used for this.
 * Returns null for a tray with no dates at all — "undated" is a real bucket.
 */
export function trayYear(tray: {
  outDate?: string | null
  coolDate?: string | null
  inDate?: string | null
}): number | null {
  for (const d of [tray.outDate, tray.coolDate, tray.inDate]) {
    if (!d) continue
    const y = Number(String(d).slice(0, 4))
    if (Number.isFinite(y) && y > 0) return y
  }
  return null
}

/**
 * The nominal weight of one filled tray, in kg — the sample's "Kg for 2 gal".
 *
 * Tray weight is LOOKED UP from the sample, never copied onto the tray: an
 * x-ray correction must flow through to every tray of that lot. (In the live
 * data 0 of 4,643 trays carry their own weight; `trays.weight_lbs` is reserved
 * for an actual measurement.)
 */
export function trayWeightKg(sample: {
  kgPer2Gal?: number | null
  lbsPer2Gal?: number | null
} | null | undefined): number | null {
  if (!sample) return null
  if (sample.kgPer2Gal != null) return sample.kgPer2Gal
  return lbsToKg(sample.lbsPer2Gal)
}

// ── Incubation milestone schedule ────────────────────────────────────────────

/**
 * The milestone schedule, as day-offsets from the start of an incubation.
 * Ported from the desktop app's `_INC_MILESTONES`; a milestone on "day N" falls
 * on `start + (N - 1)` days, so day 1 IS the start date.
 */
export const INCUBATION_MILESTONES: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Incubation Start' },
  { day: 7, label: 'Vapona In' },
  { day: 13, label: 'Vapona Out' },
  { day: 14, label: 'Earliest We Can Cool' },
  { day: 18, label: '10% Male Emergence' },
  { day: 23, label: 'Expected Release' },
  { day: 37, label: 'Latest Release' },
]

/** A milestone resolved onto a calendar date for one incubator. */
export interface MilestoneEvent {
  /** YYYY-MM-DD. */
  date: string
  day: number
  label: string
  incubatorId: string
  incubatorName: string
}

/** Add whole days to a YYYY-MM-DD date, staying in UTC to avoid TZ drift. */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * When an incubator's current incubation started.
 *
 * Prefers the explicit `incubationStart`, EXCEPT the literal "none", which the
 * desktop app treats as "schedule deliberately removed — do not auto-derive".
 * Otherwise falls back to the most common in-date among its active trays.
 */
export function incubationStartFor(
  incubator: { id: string; incubationStart?: string | null },
  trays: Array<{ incubatorId: string | null; status: string; inDate: string | null }>,
): string | null {
  const raw = (incubator.incubationStart ?? '').trim()
  if (raw.toLowerCase() === 'none') return null
  if (raw) return raw.slice(0, 10)

  const counts = new Map<string, number>()
  for (const t of trays) {
    if (t.incubatorId !== incubator.id || t.status !== 'active' || !t.inDate) continue
    const d = t.inDate.slice(0, 10)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [d, n] of counts) {
    // Ties resolve to the earlier date, so the schedule doesn't jump around.
    if (n > bestN || (n === bestN && best !== null && d < best)) {
      best = d
      bestN = n
    }
  }
  return best
}

/** Every milestone date for the incubators that have a start date. */
export function milestoneEvents(
  incubators: Array<{ id: string; name: string; incubationStart?: string | null }>,
  trays: Array<{ incubatorId: string | null; status: string; inDate: string | null }>,
): MilestoneEvent[] {
  const out: MilestoneEvent[] = []
  for (const inc of incubators) {
    const start = incubationStartFor(inc, trays)
    if (!start) continue
    for (const m of INCUBATION_MILESTONES) {
      out.push({
        date: addDays(start, m.day - 1),
        day: m.day,
        label: m.label,
        incubatorId: inc.id,
        incubatorName: inc.name,
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.incubatorName.localeCompare(b.incubatorName))
}

/**
 * All-day VEVENTs for the milestone list, matching the desktop app's export so
 * the same file imports into Google Calendar. DTEND is the exclusive next day.
 */
export function milestonesToIcs(events: MilestoneEvent[], stampIso: string): string {
  const stamp = `${stampIso.slice(0, 19).replace(/[-:]/g, '')}Z`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TNT Operations//Incubation Timeline//EN',
    'CALSCALE:GREGORIAN',
  ]
  for (const e of events) {
    const d0 = e.date.replace(/-/g, '')
    const d1 = addDays(e.date, 1).replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      // Stable per incubator+milestone, so re-importing updates rather than duplicates.
      `UID:${e.incubatorId}-${e.day}@tnt-operations`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d0}`,
      `DTEND;VALUE=DATE:${d1}`,
      `SUMMARY:${e.incubatorName} — ${e.label} (Day ${e.day})`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Mean temperature per incubator per calendar day.
 *
 * `toYmd` maps a reading's ISO timestamp to a local calendar day, so the caller
 * decides the timezone (and this stays pure/testable).
 */
export function dailyMeanTempByIncubator(
  readings: Array<{ incubatorId: string; at: string; tempC: number }>,
  toYmd: (iso: string) => string,
): Map<string, Map<string, number>> {
  const sums = new Map<string, Map<string, { total: number; n: number }>>()
  for (const r of readings) {
    if (r.tempC == null || !Number.isFinite(r.tempC)) continue
    const day = toYmd(r.at)
    let byDay = sums.get(r.incubatorId)
    if (!byDay) sums.set(r.incubatorId, (byDay = new Map()))
    const cur = byDay.get(day)
    if (cur) {
      cur.total += r.tempC
      cur.n++
    } else byDay.set(day, { total: r.tempC, n: 1 })
  }

  const out = new Map<string, Map<string, number>>()
  for (const [incId, byDay] of sums) {
    const means = new Map<string, number>()
    for (const [day, { total, n }] of byDay) means.set(day, total / n)
    out.set(incId, means)
  }
  return out
}

/**
 * Days an incubator sat at HOLDING temperature — the deliberate pre-release
 * hold, which slows development.
 *
 * Only the holding band counts. Incubation days obviously don't; neither does
 * an incubator that is simply switched off (shop ambient is ~19-21 C, above the
 * band) nor cool storage (below it). That keeps the marks to intentional
 * holding rather than any time the box happened to be cold.
 *
 * NOTE: mode history is not recorded anywhere — only the CURRENT temp_mode is
 * stored — so this is derived from what the sensors measured, which is the only
 * record of what a run actually experienced.
 *
 * This REPORTS; it does not adjust the schedule. How much holding delays
 * emergence isn't recorded, so shifting milestone dates would invent a number.
 */
export function holdingDays(
  means: Map<string, Map<string, number>>,
  band: { min: number | null; max: number | null } = TEMP_MODES.holding,
): Map<string, Set<string>> {
  const lo = band.min ?? -Infinity
  const hi = band.max ?? Infinity
  const out = new Map<string, Set<string>>()
  for (const [incId, byDay] of means) {
    const days = new Set<string>()
    for (const [day, mean] of byDay) if (mean >= lo && mean <= hi) days.add(day)
    if (days.size) out.set(incId, days)
  }
  return out
}

/** Inclusive date window a run occupies: its start through the last milestone. */
export function runWindow(startYmd: string): { from: string; to: string } {
  const lastDay = INCUBATION_MILESTONES[INCUBATION_MILESTONES.length - 1].day
  return { from: startYmd, to: addDays(startYmd, lastDay - 1) }
}

// ── Tray inspections ─────────────────────────────────────────────────────────

/**
 * Leafcutter developmental stages, in order, as recorded when cells are opened
 * during an inspection. Ported verbatim from the desktop app's `DEV_STAGES` —
 * the labels ARE the stored values, so they must match exactly.
 */
export const DEV_STAGES = [
  'Day 1 — Worm/Larva',
  'Day 3 — Whitening',
  'Day 5 — Nonsymmetrical',
  'Day 8–9 — Pupal',
  'Day 10 — Pink-Eyed',
  'Day 13 — Male dark eye / Female red eye',
  'Day 14–15 — Male fully dark / Female darkening',
  'Day 17–18 — Male emergence',
  'Day 20 — Female emergence',
] as const

/** Where in the stack a sampled tray came from. */
export const STACK_POSITIONS = ['Top', 'Middle', 'Bottom'] as const
/** How deep in the incubator the sampled tray came from. */
export const DEPTH_POSITIONS = ['Front', 'Middle', 'Back'] as const

/** First day of the range a stage label describes ("Day 8–9 — Pupal" → 8). */
export function stageStartDay(stage: string): number | null {
  const m = /^Day\s+(\d+)/.exec(stage.trim())
  return m ? Number(m[1]) : null
}

/**
 * The stage a tray should be showing on a given incubation day — the latest
 * stage whose start day has been reached.
 *
 * Used to compare what was actually seen against the schedule. Note this is the
 * nominal timeline: holding or cool storage slows development, so a run that
 * was held will legitimately read behind (see holdingDays).
 */
export function expectedStageForDay(day: number | null | undefined): string | null {
  if (day == null || day < 1) return null
  let best: string | null = null
  for (const stage of DEV_STAGES) {
    const start = stageStartDay(stage)
    if (start != null && day >= start) best = stage
  }
  return best
}

/** How far an observed stage sits from the expected one, in stage steps. */
export function stageDelta(observed: string, day: number | null | undefined): number | null {
  const expected = expectedStageForDay(day)
  if (!expected) return null
  const oi = DEV_STAGES.indexOf(observed as (typeof DEV_STAGES)[number])
  const ei = DEV_STAGES.indexOf(expected as (typeof DEV_STAGES)[number])
  if (oi < 0 || ei < 0) return null
  return oi - ei
}
