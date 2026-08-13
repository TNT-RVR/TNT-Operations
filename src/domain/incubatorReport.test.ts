import { describe, it, expect } from 'vitest'
import {
  buildIncubatorReport,
  buildKeyDates,
  classifyDay,
  daysInclusive,
  modePeriods,
  readingsCsv,
  reportFilename,
  type ReportInput,
  type ReportReading,
  type ReportTray,
} from './incubatorReport'

// The app's real conversion, simplified: these fixtures use midday UTC so the
// Edmonton date never straddles midnight and the tests stay about the report.
const toYmd = (iso: string) => iso.slice(0, 10)
const fmtLocal = (iso: string) => iso.replace('T', ' ').replace('Z', '')

const INC = {
  id: 'inc1',
  name: 'Incubator 3',
  location: 'Shop',
  tempTargetC: 30,
  humidityTargetPct: 55,
  incubationStart: '2026-05-01',
  capacity: 400,
}

const reading = (day: string, hour: number, tempC: number, humidityPct = 50): ReportReading => ({
  at: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  tempC,
  humidityPct,
})

const tray = (over: Partial<ReportTray> = {}): ReportTray => ({
  id: 't1',
  trayNumber: '101',
  sampleId: 's1',
  incubatorId: 'inc1',
  volumeGal: 2,
  weightLbs: 20,
  inDate: '2026-05-01',
  outDate: null,
  coolDate: null,
  status: 'in',
  ...over,
})

const build = (over: Partial<ReportInput> = {}) =>
  buildIncubatorReport({
    incubator: INC,
    readings: [],
    trays: [],
    inspections: [],
    from: '2026-05-01',
    to: '2026-05-10',
    toYmd,
    today: '2026-05-10',
    ...over,
  })

describe('daysInclusive', () => {
  it('counts both ends', () => {
    expect(daysInclusive('2026-05-01', '2026-05-01')).toBe(1)
    expect(daysInclusive('2026-05-01', '2026-05-10')).toBe(10)
  })

  it('crosses a month, a year, and a leap day', () => {
    expect(daysInclusive('2026-01-31', '2026-02-01')).toBe(2)
    expect(daysInclusive('2025-12-31', '2026-01-01')).toBe(2)
    expect(daysInclusive('2024-02-28', '2024-03-01')).toBe(3) // 2024 is a leap year
    expect(daysInclusive('2023-02-28', '2023-03-01')).toBe(2)
  })

  it('spans years, for a multi-season report', () => {
    expect(daysInclusive('2024-01-01', '2026-01-01')).toBe(732) // 366 + 365 + 1
  })
})

describe('classifyDay', () => {
  it('names each regime from its measured temperature', () => {
    expect(classifyDay(4)).toBe('cool_storage')
    expect(classifyDay(30)).toBe('incubation')
    expect(classifyDay(14)).toBe('holding')
  })

  it('calls a chamber below freezing off, not cool storage', () => {
    expect(classifyDay(-5)).toBe('off')
  })

  it('refuses to round a between-bands day into the nearest regime', () => {
    // 21 °C is above holding (10–18) and below incubation (25–35). A chamber on
    // its way up was in neither, and saying "incubation" would be a tidy lie.
    expect(classifyDay(21)).toBe('transition')
  })

  it('includes the band edges', () => {
    expect(classifyDay(0)).toBe('cool_storage')
    expect(classifyDay(12)).toBe('cool_storage')
    expect(classifyDay(25)).toBe('incubation')
    expect(classifyDay(35)).toBe('incubation')
  })
})

describe('modePeriods', () => {
  const day = (date: string, tempC: number | null) => ({
    date,
    tempC,
    humidityPct: null,
    tempMinC: tempC,
    tempMaxC: tempC,
  })

  it('collapses consecutive days in one regime into a single period', () => {
    const p = modePeriods([
      day('2026-05-01', 30),
      day('2026-05-02', 30.5),
      day('2026-05-03', 29.5),
    ])
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ mode: 'incubation', from: '2026-05-01', to: '2026-05-03', days: 3 })
    expect(p[0].meanTempC).toBeCloseTo(30, 5)
  })

  it('starts a new period when the regime changes', () => {
    const p = modePeriods([day('2026-05-01', 4), day('2026-05-02', 4), day('2026-05-03', 30)])
    expect(p.map((x) => [x.mode, x.days])).toEqual([
      ['cool_storage', 2],
      ['incubation', 1],
    ])
  })

  it('BREAKS a run across a gap in the readings', () => {
    // Bridging would claim the incubator held a setting through days nobody
    // measured — and the usual reason for a gap is the thing being unplugged.
    const p = modePeriods([day('2026-05-01', 30), day('2026-05-02', null), day('2026-05-03', 30)])
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ from: '2026-05-01', to: '2026-05-01' })
    expect(p[1]).toMatchObject({ from: '2026-05-03', to: '2026-05-03' })
  })

  it('returns nothing for a window with no readings at all', () => {
    expect(modePeriods([day('2026-05-01', null), day('2026-05-02', null)])).toEqual([])
  })
})

describe('buildIncubatorReport — measurements', () => {
  const readings = [
    reading('2026-05-01', 6, 28.0, 40),
    reading('2026-05-01', 18, 32.0, 60),
    reading('2026-05-02', 6, 30.0, 50),
  ]

  it('reports the extremes and WHEN they happened', () => {
    const r = build({ readings })
    expect(r.temp).toMatchObject({ min: 28, max: 32, count: 3 })
    expect(r.temp!.mean).toBeCloseTo(30, 5)
    expect(r.temp!.minAt).toBe('2026-05-01T06:00:00.000Z')
    expect(r.temp!.maxAt).toBe('2026-05-01T18:00:00.000Z')
    expect(r.humidity).toMatchObject({ min: 40, max: 60 })
  })

  it('ignores readings outside the window', () => {
    const r = build({
      readings: [...readings, reading('2026-04-30', 12, 99), reading('2026-05-11', 12, -99)],
    })
    expect(r.temp!.max).toBe(32)
    expect(r.temp!.min).toBe(28)
    expect(r.windowReadings).toHaveLength(3)
  })

  it('gives every calendar day a row, including empty ones', () => {
    const r = build({ readings })
    expect(r.daily).toHaveLength(10)
    expect(r.daily[0]).toMatchObject({ date: '2026-05-01', tempMinC: 28, tempMaxC: 32 })
    expect(r.daily[0].tempC).toBeCloseTo(30, 5)
    // Day 3 onwards has nothing — the chart must show that as a gap.
    expect(r.daily[2].tempC).toBeNull()
  })

  it('survives a window with no readings at all', () => {
    const r = build()
    expect(r.temp).toBeNull()
    expect(r.humidity).toBeNull()
    expect(r.modePeriods).toEqual([])
    expect(r.daily.every((d) => d.tempC === null)).toBe(true)
  })

  it('sorts the window readings oldest first for the CSV', () => {
    const r = build({ readings: [reading('2026-05-03', 6, 30), reading('2026-05-01', 6, 28)] })
    expect(r.windowReadings.map((x) => x.at)).toEqual([
      '2026-05-01T06:00:00.000Z',
      '2026-05-03T06:00:00.000Z',
    ])
  })
})

describe('buildIncubatorReport — trays', () => {
  it('groups intake by the date trays went in', () => {
    const r = build({
      trays: [
        tray({ id: 'a', trayNumber: '101', inDate: '2026-05-01' }),
        tray({ id: 'b', trayNumber: '102', inDate: '2026-05-01' }),
        tray({ id: 'c', trayNumber: '103', inDate: '2026-05-04' }),
      ],
    })
    expect(r.intake).toHaveLength(2)
    expect(r.intake[0]).toMatchObject({ date: '2026-05-01', trays: 2, gallons: 4 })
    expect(r.intake[0].trayNumbers).toEqual(['101', '102'])
  })

  it('ignores trays belonging to a different incubator', () => {
    const r = build({ trays: [tray({ incubatorId: 'other' })] })
    expect(r.intake).toEqual([])
    expect(r.totals.trays).toBe(0)
  })

  it('counts a tray that arrived BEFORE the window but was still held', () => {
    // Totals answer "what was in there", which is not the same question as
    // "what arrived during these dates".
    const r = build({ trays: [tray({ inDate: '2026-04-01' })] })
    expect(r.intake).toEqual([])
    expect(r.totals.trays).toBe(1)
    expect(r.totals.gallons).toBe(2)
  })

  it('excludes a tray that had already left before the window', () => {
    const r = build({ trays: [tray({ inDate: '2026-03-01', outDate: '2026-04-01' })] })
    expect(r.totals.trays).toBe(0)
  })

  it('counts an open-ended tray as still held', () => {
    const r = build({ trays: [tray({ inDate: '2026-05-02', outDate: null, coolDate: null })] })
    expect(r.totals.trays).toBe(1)
  })

  it('totals gallons, weight and distinct samples', () => {
    const r = build({
      trays: [
        tray({ id: 'a', sampleId: 's1', volumeGal: 2, weightLbs: 20 }),
        tray({ id: 'b', sampleId: 's1', volumeGal: 2, weightLbs: 21 }),
        tray({ id: 'c', sampleId: 's2', volumeGal: 1.5, weightLbs: 15 }),
      ],
    })
    expect(r.totals).toMatchObject({ trays: 3, gallons: 5.5, weightLbs: 56, samples: 2 })
  })

  it('treats a missing volume as zero rather than NaN', () => {
    const r = build({ trays: [tray({ volumeGal: null, weightLbs: null })] })
    expect(r.totals.gallons).toBe(0)
    expect(r.totals.weightLbs).toBe(0)
  })
})

describe('buildKeyDates', () => {
  it('lays the milestones out from the incubation start', () => {
    const k = buildKeyDates('2026-05-01', [])
    expect(k[0]).toMatchObject({ label: 'Incubation Start', planned: '2026-05-01' })
    expect(k.find((x) => x.label === 'Vapona In')?.planned).toBe('2026-05-07') // day 7
  })

  it('compares the planned release against the first tray actually out', () => {
    const k = buildKeyDates('2026-05-01', [tray({ outDate: '2026-05-25' })])
    const rel = k.find((x) => /release/i.test(x.label))!
    expect(rel.planned).toBe('2026-05-23') // day 23
    expect(rel.actual).toBe('2026-05-25')
    expect(rel.varianceDays).toBe(2)
  })

  it('reports a release that came early as a negative variance', () => {
    const k = buildKeyDates('2026-05-01', [tray({ outDate: '2026-05-20' })])
    expect(k.find((x) => /release/i.test(x.label))!.varianceDays).toBe(-3)
  })

  it('uses the EARLIEST tray out, since that is when the run ended', () => {
    const k = buildKeyDates('2026-05-01', [
      tray({ id: 'a', outDate: '2026-05-28' }),
      tray({ id: 'b', outDate: '2026-05-24' }),
    ])
    expect(k.find((x) => /release/i.test(x.label))!.actual).toBe('2026-05-24')
  })

  it('falls back to the cool date when there is no out date', () => {
    const k = buildKeyDates('2026-05-01', [tray({ outDate: null, coolDate: '2026-05-22' })])
    expect(k.find((x) => /release/i.test(x.label))!.actual).toBe('2026-05-22')
  })

  it('leaves actuals null rather than filling them in with the plan', () => {
    const k = buildKeyDates('2026-05-01', [])
    expect(k.every((x) => x.actual === null && x.varianceDays === null)).toBe(true)
  })

  it('returns nothing when the run has no start date', () => {
    expect(buildKeyDates(null, [tray()])).toEqual([])
  })
})

describe('readingsCsv', () => {
  it('writes a header and one row per reading, in both units', () => {
    const r = build({ readings: [reading('2026-05-01', 6, 30, 55)] })
    const lines = readingsCsv(r, fmtLocal).split('\r\n')
    expect(lines[0]).toBe('Timestamp (America/Edmonton),Temperature (C),Temperature (F),Humidity (%)')
    expect(lines[1]).toBe('2026-05-01 06:00:00.000,30.00,86.00,55')
  })

  it('ends with CRLF, which is what Excel expects', () => {
    const csv = readingsCsv(build({ readings: [reading('2026-05-01', 6, 30)] }), fmtLocal)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('emits only a header when nothing was recorded', () => {
    expect(readingsCsv(build(), fmtLocal).split('\r\n').filter(Boolean)).toHaveLength(1)
  })

  it('neutralises a cell Excel would run as a formula', () => {
    const r = build({ readings: [reading('2026-05-01', 6, 30)] })
    const csv = readingsCsv({ ...r, windowReadings: r.windowReadings }, () => '=cmd|calc')
    expect(csv).toContain("'=cmd|calc")
  })
})

describe('reportFilename', () => {
  it('is sortable and free of spaces', () => {
    expect(reportFilename('Incubator 3', '2026-05-01', '2026-06-30', 'pdf')).toBe(
      'Incubator-3_2026-05-01_2026-06-30.pdf',
    )
  })

  it('strips characters a filesystem would reject', () => {
    expect(reportFilename('A/B:C*?', '2026-01-01', '2026-01-02', 'csv')).toBe(
      'A-B-C_2026-01-01_2026-01-02.csv',
    )
  })

  it('falls back rather than producing a nameless file', () => {
    expect(reportFilename('///', '2026-01-01', '2026-01-02', 'csv')).toBe(
      'incubator_2026-01-01_2026-01-02.csv',
    )
  })
})

describe('trays with no dates recorded', () => {
  // `in_date` is nullable in the live data, so a tray can sit against an
  // incubator with nothing to place it in time. Dropping those silently
  // undercounts "trays held", which is the worst thing a report can do.
  const undatedTray = tray({ inDate: null, outDate: null, coolDate: null })

  it('counts an undated tray for a window that reaches today', () => {
    const r = build({ trays: [undatedTray], today: '2026-05-10' })
    expect(r.totals.trays).toBe(1)
    expect(r.totals.undated).toBe(1)
  })

  it('does NOT count it for a historical window', () => {
    // Nothing says it was in there in 2024; it is in there now.
    const r = build({ trays: [undatedTray], from: '2024-01-01', to: '2024-12-31', today: '2026-05-10' })
    expect(r.totals.trays).toBe(0)
    expect(r.totals.undated).toBe(0)
  })

  it('reports zero undated when every tray has an in-date', () => {
    const r = build({ trays: [tray({ inDate: '2026-05-02' })] })
    expect(r.totals.trays).toBe(1)
    expect(r.totals.undated).toBe(0)
  })

  it('places a tray by its out-date when the in-date is missing', () => {
    const r = build({ trays: [tray({ inDate: null, outDate: '2026-05-05' })] })
    expect(r.totals.trays).toBe(1)
    expect(r.totals.undated).toBe(0)
  })

  it('excludes an out-date-only tray that left before the window', () => {
    const r = build({ trays: [tray({ inDate: null, outDate: '2026-04-01' })] })
    expect(r.totals.trays).toBe(0)
  })
})
