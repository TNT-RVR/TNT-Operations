/**
 * Everything an incubator's history report needs, assembled from raw rows.
 *
 * Pure — no React, no jsPDF, no DOM. The PDF and the CSV are two renderings of
 * the ONE structure this builds, so the two can never disagree about what
 * happened; a number that appears in both came from the same computation.
 *
 * The report covers an arbitrary window — a week, a season, three years — so
 * everything here is written to survive a range with gaps in it. An incubator
 * that was switched off for eight months has no readings for those months, and
 * that is data, not an error.
 */
import {
  TEMP_MODES,
  INCUBATION_MILESTONES,
  addDays,
  type TempMode,
} from './incubation'

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ReportReading {
  at: string
  tempC: number
  humidityPct: number
}

export interface ReportTray {
  id: string
  trayNumber: string
  sampleId: string | null
  incubatorId: string | null
  volumeGal: number | null
  weightLbs: number | null
  inDate: string | null
  outDate: string | null
  coolDate: string | null
  status: string
}

export interface ReportInspection {
  at: string
  inspector?: string | null
  tempC?: number | null
  humidityPct?: number | null
  heatPumpsOk?: boolean | null
  fansOk?: boolean | null
  blackLightsOk?: boolean | null
  beesEmerging?: boolean | null
  parasitesEmerging?: boolean | null
  notes?: string | null
}

export interface ReportInput {
  incubator: {
    id: string
    name: string
    location: string
    tempTargetC: number
    humidityTargetPct: number
    tempMode?: string | null
    incubationStart?: string | null
    capacity?: number | null
  }
  readings: ReportReading[]
  trays: ReportTray[]
  inspections: ReportInspection[]
  /** Inclusive calendar-date window, `YYYY-MM-DD`. */
  from: string
  to: string
  /** ISO → `YYYY-MM-DD` in the operation's timezone. Injected so this stays pure. */
  toYmd: (iso: string) => string
  /** Today, `YYYY-MM-DD`. Passed in rather than read, to keep this pure. */
  today: string
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/** Min / max / mean of one measurement, with WHEN the extremes happened. */
export interface MetricStats {
  min: number
  max: number
  mean: number
  /** ISO timestamps of the extremes — "when did it get that cold" matters. */
  minAt: string
  maxAt: string
  count: number
}

/** A stretch of days the incubator spent in one temperature regime. */
export interface ModePeriod {
  mode: TempMode | 'transition'
  label: string
  from: string
  to: string
  days: number
  meanTempC: number
}

/** Trays entering the incubator on one date. */
export interface TrayIntake {
  date: string
  trays: number
  gallons: number
  trayNumbers: string[]
}

export interface KeyDate {
  label: string
  planned: string | null
  actual: string | null
  /** actual − planned, in days. Null when either is missing. */
  varianceDays: number | null
}

export interface DailyPoint {
  date: string
  tempC: number | null
  humidityPct: number | null
  tempMinC: number | null
  tempMaxC: number | null
}

export interface IncubatorReport {
  incubator: ReportInput['incubator']
  from: string
  to: string
  generatedFor: { days: number }
  temp: MetricStats | null
  humidity: MetricStats | null
  daily: DailyPoint[]
  modePeriods: ModePeriod[]
  intake: TrayIntake[]
  totals: { trays: number; gallons: number; weightLbs: number; samples: number; undated: number }
  keyDates: KeyDate[]
  inspections: ReportInspection[]
  /** Readings actually inside the window, oldest first — what the CSV writes. */
  windowReadings: ReportReading[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const inWindow = (ymd: string, from: string, to: string) => ymd >= from && ymd <= to

/** Calendar days from `from` to `to`, inclusive. Dates are plain YMD strings. */
export function daysInclusive(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.floor((b - a) / 86_400_000) + 1
}

function stats(values: Array<{ v: number; at: string }>): MetricStats | null {
  if (values.length === 0) return null
  let min = values[0]
  let max = values[0]
  let total = 0
  for (const x of values) {
    if (x.v < min.v) min = x
    if (x.v > max.v) max = x
    total += x.v
  }
  return {
    min: min.v,
    max: max.v,
    mean: total / values.length,
    minAt: min.at,
    maxAt: max.at,
    count: values.length,
  }
}

/**
 * Which regime a day's mean temperature sits in.
 *
 * There is no record of anyone flipping a switch — `incubators.temp_mode` holds
 * only the CURRENT setting, with no history — so the mode timeline is read back
 * out of what the sensors measured. That is arguably the better source anyway:
 * it says what the incubator actually did, not what someone meant to set. It
 * also works retroactively over years of readings, which a log started today
 * never could.
 *
 * A day whose mean falls between two bands is `transition` rather than being
 * forced into the nearest one — a chamber on its way from 4 °C to 30 °C was in
 * neither regime, and saying so is more useful than a tidy lie.
 */
export function classifyDay(meanTempC: number): TempMode | 'transition' {
  for (const mode of ['cool_storage', 'incubation', 'holding'] as TempMode[]) {
    const band = TEMP_MODES[mode]
    if (band.min != null && band.max != null && meanTempC >= band.min && meanTempC <= band.max) {
      return mode
    }
  }
  // Below every band is a chamber that is off (or a room in winter), not a
  // transition — cool storage bottoms out at 0 °C.
  if (meanTempC < (TEMP_MODES.cool_storage.min ?? 0)) return 'off'
  return 'transition'
}

const modeLabel = (m: TempMode | 'transition') =>
  m === 'transition' ? 'Transition' : TEMP_MODES[m].label

/**
 * Collapse per-day classifications into runs.
 *
 * A gap in the readings BREAKS a run rather than bridging it. Bridging would
 * claim the incubator held a setting through a period nobody measured, and the
 * commonest reason for a gap is the thing being unplugged.
 */
export function modePeriods(daily: DailyPoint[]): ModePeriod[] {
  const out: ModePeriod[] = []
  let cur: (ModePeriod & { total: number; n: number }) | null = null

  const flush = () => {
    if (!cur) return
    out.push({
      mode: cur.mode,
      label: cur.label,
      from: cur.from,
      to: cur.to,
      days: daysInclusive(cur.from, cur.to),
      meanTempC: cur.total / cur.n,
    })
    cur = null
  }

  for (const d of daily) {
    if (d.tempC == null) {
      flush()
      continue
    }
    const mode = classifyDay(d.tempC)
    // A run continues only across consecutive calendar days in the same mode.
    if (cur && cur.mode === mode && addDays(cur.to, 1) === d.date) {
      cur.to = d.date
      cur.total += d.tempC
      cur.n++
    } else {
      flush()
      cur = {
        mode,
        label: modeLabel(mode),
        from: d.date,
        to: d.date,
        days: 1,
        meanTempC: d.tempC,
        total: d.tempC,
        n: 1,
      }
    }
  }
  flush()
  return out
}

// ── The builder ──────────────────────────────────────────────────────────────

export function buildIncubatorReport(input: ReportInput): IncubatorReport {
  const { incubator, from, to, toYmd } = input

  // ── Readings inside the window ──
  const windowReadings = input.readings
    .filter((r) => inWindow(toYmd(r.at), from, to))
    .sort((a, b) => a.at.localeCompare(b.at))

  const tempVals: Array<{ v: number; at: string }> = []
  const humVals: Array<{ v: number; at: string }> = []
  const byDay = new Map<string, { t: number[]; h: number[] }>()

  for (const r of windowReadings) {
    const day = toYmd(r.at)
    let bucket = byDay.get(day)
    if (!bucket) byDay.set(day, (bucket = { t: [], h: [] }))
    if (Number.isFinite(r.tempC)) {
      tempVals.push({ v: r.tempC, at: r.at })
      bucket.t.push(r.tempC)
    }
    if (Number.isFinite(r.humidityPct)) {
      humVals.push({ v: r.humidityPct, at: r.at })
      bucket.h.push(r.humidityPct)
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

  // Every calendar day in the window gets a row, present in the data or not —
  // the chart has to show a gap as a gap, not close it up.
  const daily: DailyPoint[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = byDay.get(d)
    daily.push({
      date: d,
      tempC: b ? mean(b.t) : null,
      humidityPct: b ? mean(b.h) : null,
      tempMinC: b && b.t.length ? Math.min(...b.t) : null,
      tempMaxC: b && b.t.length ? Math.max(...b.t) : null,
    })
  }

  // ── Trays that were in this incubator during the window ──
  //
  // Matched on the date they went IN, which is the event being reported. A tray
  // whose in-date precedes the window still counts toward what the incubator
  // HELD, so the totals below use a wider test than the intake list.
  const mine = input.trays.filter((t) => t.incubatorId === incubator.id)

  const intakeByDate = new Map<string, TrayIntake>()
  for (const t of mine) {
    if (!t.inDate) continue
    const day = t.inDate.slice(0, 10)
    if (!inWindow(day, from, to)) continue
    let row = intakeByDate.get(day)
    if (!row) intakeByDate.set(day, (row = { date: day, trays: 0, gallons: 0, trayNumbers: [] }))
    row.trays++
    row.gallons += t.volumeGal ?? 0
    row.trayNumbers.push(t.trayNumber)
  }
  const intake = [...intakeByDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  // Held during the window. `in_date` is nullable in the real data, so a tray
  // can be assigned to this incubator with no date on it at all — dropping
  // those would quietly undercount, which is the worst thing a report can do.
  //   · in-date known    → the ordinary overlap test
  //   · only an out-date → it was in there until then, so it counts if it left
  //                        on or after the window opened
  //   · no dates at all  → nothing places it in time. It is assigned to this
  //                        incubator, so it is presumed to be in there NOW, and
  //                        counts only for a window reaching today. Counted
  //                        separately as `undated` so the total can be explained.
  let undated = 0
  const held = mine.filter((t) => {
    const inD = t.inDate?.slice(0, 10)
    const outD = (t.outDate ?? t.coolDate)?.slice(0, 10)
    if (inD) return inD <= to && (!outD || outD >= from)
    if (outD) return outD >= from && outD <= to
    if (to >= input.today) {
      undated++
      return true
    }
    return false
  })

  const totals = {
    trays: held.length,
    gallons: held.reduce((s, t) => s + (t.volumeGal ?? 0), 0),
    weightLbs: held.reduce((s, t) => s + (t.weightLbs ?? 0), 0),
    samples: new Set(held.map((t) => t.sampleId).filter(Boolean)).size,
    undated,
  }

  // ── Key dates: what the schedule said against what happened ──
  const keyDates = buildKeyDates(incubator.incubationStart ?? null, held)

  const inspections = input.inspections
    .filter((i) => inWindow(toYmd(i.at), from, to))
    .sort((a, b) => a.at.localeCompare(b.at))

  return {
    incubator,
    from,
    to,
    generatedFor: { days: daysInclusive(from, to) },
    temp: stats(tempVals),
    humidity: stats(humVals),
    daily,
    modePeriods: modePeriods(daily),
    intake,
    totals,
    keyDates,
    inspections,
    windowReadings,
  }
}

/**
 * The run's milestones, planned against actual.
 *
 * Planned dates come from the milestone offsets off the incubation start. The
 * only actual we can observe is the release — a tray leaving, which is its
 * cool-date or out-date. Everything else has no recorded actual, and is shown
 * as planned-only rather than being quietly filled in with the plan.
 */
export function buildKeyDates(incubationStart: string | null, trays: ReportTray[]): KeyDate[] {
  if (!incubationStart) return []
  const start = incubationStart.slice(0, 10)

  const outs = trays
    .map((t) => (t.outDate ?? t.coolDate)?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort()
  const firstOut = outs[0] ?? null

  return INCUBATION_MILESTONES.map(({ day, label }) => {
    const planned = addDays(start, day - 1)
    // "Expected Release" is the one milestone with something to compare against.
    const actual = /release/i.test(label) ? firstOut : null
    return {
      label,
      planned,
      actual,
      varianceDays: actual ? daysInclusive(planned, actual) - 1 : null,
    }
  })
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? '' : String(v)
  // Excel reads a leading =, +, - or @ as a formula. Prefixing an apostrophe is
  // the standard defence and survives the round trip.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/**
 * Temperature and humidity for the window, one row per reading.
 *
 * Deliberately just the readings — this is the file you open in Excel to do
 * your own arithmetic, so it carries measurements and nothing derived. The
 * narrative belongs in the PDF.
 */
export function readingsCsv(
  report: IncubatorReport,
  fmtLocal: (iso: string) => string,
): string {
  const rows = [['Timestamp (America/Edmonton)', 'Temperature (C)', 'Temperature (F)', 'Humidity (%)']]
  for (const r of report.windowReadings) {
    rows.push([
      fmtLocal(r.at),
      Number.isFinite(r.tempC) ? r.tempC.toFixed(2) : '',
      Number.isFinite(r.tempC) ? (r.tempC * 9 / 5 + 32).toFixed(2) : '',
      Number.isFinite(r.humidityPct) ? String(r.humidityPct) : '',
    ])
  }
  // CRLF: Excel on Windows is the destination, and it is the RFC's line ending.
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** `Incubator-3_2026-04-01_2026-06-30.csv` — sortable, no spaces. */
export function reportFilename(name: string, from: string, to: string, ext: string): string {
  const safe = name.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'incubator'
  return `${safe}_${from}_${to}.${ext}`
}
