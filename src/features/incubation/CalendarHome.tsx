import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { PageHeader, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import {
  INCUBATION_MILESTONES,
  TEMP_MODES,
  milestoneEvents,
  milestonesToIcs,
  incubationStartFor,
  formatDays,
  daysFromNow,
  dailyMeanTempByIncubator,
  holdingDays,
  runWindow,
  type MilestoneEvent,
} from '@/domain/incubation'

const TZ = 'America/Edmonton'
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Today in the operation's timezone, as YYYY-MM-DD. */
function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Calendar grid for a month: whole weeks, Monday-first, as YYYY-MM-DD. */
export function monthGrid(year: number, month0: number): string[][] {
  const first = new Date(Date.UTC(year, month0, 1))
  // Monday-first offset (JS weeks start Sunday).
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(first)
  start.setUTCDate(start.getUTCDate() - lead)

  const weeks: string[][] = []
  const cur = new Date(start)
  for (let w = 0; w < 6; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      week.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    weeks.push(week)
    // Stop once we're past the month and the week is complete.
    if (Number(week[6].slice(5, 7)) - 1 > month0 || (month0 === 11 && week[6].slice(0, 4) > String(year))) break
  }
  return weeks
}

export default function CalendarHome() {
  const { incubators, trays, readings, loadReadings } = useData()
  const today = todayYmd()
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month0, setMonth0] = useState(() => Number(today.slice(5, 7)) - 1)

  const events = useMemo(() => milestoneEvents(incubators, trays), [incubators, trays])

  /** Colour per incubator so a run reads as one thread across the month. */
  const colorOf = useMemo(() => {
    const palette = ['--data-honey', '--data-teal', '--data-lime', '--blue-500', '--red-500', '--amber-500']
    const m = new Map<string, string>()
    incubators.forEach((i, idx) => m.set(i.id, `var(${palette[idx % palette.length]})`))
    return m
  }, [incubators])

  const byDate = useMemo(() => {
    const m = new Map<string, MilestoneEvent[]>()
    for (const e of events) {
      const list = m.get(e.date)
      if (list) list.push(e)
      else m.set(e.date, [e])
    }
    return m
  }, [events])

  const weeks = useMemo(() => monthGrid(year, month0), [year, month0])

  /** Incubators actually on a schedule, with where they are in it. */
  const scheduled = useMemo(
    () =>
      incubators
        .map((i) => ({ inc: i, start: incubationStartFor(i, trays) }))
        .filter((r): r is { inc: (typeof incubators)[number]; start: string } => r.start !== null),
    [incubators, trays],
  )

  // (scheduled is declared above so the holding-day window can use it)
  // Readings are hydrated only for a recent window, so pull the visible month
  // for the incubators on a schedule (loadReadings is cached per incubator).
  const monthStartIso = useMemo(() => new Date(Date.UTC(year, month0, 1)).toISOString(), [year, month0])
  useEffect(() => {
    for (const inc of incubators) void loadReadings(inc.id, monthStartIso)
  }, [incubators, monthStartIso, loadReadings])

  /**
   * Days each incubator sat at HOLDING temperature, limited to its own run
   * window. Shown, not applied: holding slows development, but by how much
   * isn't recorded, so the milestone dates stay put and these days explain why
   * a run may run late.
   */
  const held = useMemo(() => {
    const toYmd = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
    const all = holdingDays(dailyMeanTempByIncubator(readings, toYmd))
    // Only mark days that fall inside the run — an idle box between seasons
    // isn't "holding", it's just sitting there.
    const windows = new Map(scheduled.map(({ inc, start }) => [inc.id, runWindow(start)]))
    const out = new Map<string, Set<string>>()
    for (const [incId, days] of all) {
      const w = windows.get(incId)
      if (!w) continue
      const inRun = new Set([...days].filter((d) => d >= w.from && d <= w.to))
      if (inRun.size) out.set(incId, inRun)
    }
    return out
  }, [readings, scheduled])


  const upcoming = useMemo(() => {
    const now = new Date()
    return events
      .map((e) => ({ e, away: daysFromNow(e.date, now) ?? 0 }))
      .filter((r) => r.away >= 0 && r.away <= 30)
      .sort((a, b) => a.away - b.away)
      .slice(0, 8)
  }, [events])

  function step(delta: number) {
    const m = month0 + delta
    setYear((y) => y + Math.floor(m / 12))
    setMonth0(((m % 12) + 12) % 12)
  }

  function exportIcs() {
    const ics = milestonesToIcs(events, new Date().toISOString())
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `incubation-timeline-${today}.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Incubation milestones across every running incubator" />
      <div className="space-y-4 p-4 md:p-6">
        {scheduled.length === 0 ? (
          <EmptyState>
            No incubator has an incubation start date yet. Set one on an incubator, or scan trays in — the start is
            taken from the most common in-date of its active trays.
          </EmptyState>
        ) : (
          <>
            {/* Month controls */}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-ghost px-2 py-1" onClick={() => step(-1)} aria-label="Previous month">
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-44 text-center font-display text-lg font-bold text-primary">
                {MONTHS[month0]} {year}
              </span>
              <button className="btn-ghost px-2 py-1" onClick={() => step(1)} aria-label="Next month">
                <ChevronRight size={18} />
              </button>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => {
                  setYear(Number(today.slice(0, 4)))
                  setMonth0(Number(today.slice(5, 7)) - 1)
                }}
              >
                Today
              </button>
              <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={exportIcs}>
                <Download size={14} className="mr-1 inline" />
                Export .ics
              </button>
            </div>

            {/* Month grid */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px] overflow-hidden rounded-lg border border-subtle">
                <div className="grid grid-cols-7 border-b border-subtle bg-overlay">
                  {DOW.map((d) => (
                    <div key={d} className="px-2 py-1 font-mono text-xs uppercase tracking-wide text-muted">
                      {d}
                    </div>
                  ))}
                </div>
                {weeks.map((week) => (
                  <div key={week[0]} className="grid grid-cols-7 border-b border-subtle last:border-b-0">
                    {week.map((ymd) => {
                      const inMonth = Number(ymd.slice(5, 7)) - 1 === month0
                      const isToday = ymd === today
                      const dayEvents = byDate.get(ymd) ?? []
                      return (
                        <div
                          key={ymd}
                          className={`min-h-20 border-r border-subtle p-1 last:border-r-0 ${
                            inMonth ? '' : 'opacity-40'
                          } ${isToday ? 'bg-brand-subtle' : ''}`}
                        >
                          <div className={`font-mono text-xs ${isToday ? 'font-bold text-brand' : 'text-faint'}`}>
                            {Number(ymd.slice(8, 10))}
                          </div>
                          {/* Cool days: a thin bar per incubator that sat below
                              the incubation band that day. */}
                          <div className="flex gap-0.5">
                            {scheduled
                              .filter(({ inc }) => held.get(inc.id)?.has(ymd))
                              .map(({ inc }) => (
                                <span
                                  key={inc.id}
                                  className="h-1 flex-1 rounded-full opacity-60"
                                  style={{ background: colorOf.get(inc.id) }}
                                  title={`${inc.name} — at holding temperature this day`}
                                />
                              ))}
                          </div>
                          <div className="mt-0.5 space-y-0.5">
                            {dayEvents.map((e) => (
                              <div
                                key={`${e.incubatorId}-${e.day}`}
                                className="truncate rounded-sm px-1 py-0.5 text-[10px] leading-tight text-on-brand"
                                style={{ background: colorOf.get(e.incubatorId) }}
                                title={`${e.incubatorName} — ${e.label} (Day ${e.day})`}
                              >
                                {e.incubatorName} · {e.label}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* What's coming */}
            {upcoming.length > 0 && (
              <section>
                <h2 className="mb-2 font-semibold">Next 30 days</h2>
                <ul className="divide-y divide-subtle rounded-lg border border-subtle">
                  {upcoming.map(({ e, away }) => (
                    <li key={`${e.incubatorId}-${e.day}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: colorOf.get(e.incubatorId) }}
                      />
                      <span className="text-sm text-primary">{e.label}</span>
                      <span className="text-sm text-muted">{e.incubatorName}</span>
                      <span className="ml-auto font-mono text-xs text-faint">
                        {e.date} · {formatDays(away)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Legend: the schedule itself, and where each incubator sits in it */}
            <section className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {INCUBATION_MILESTONES.map((m) => (
                  <Badge key={m.day} tone="brand">
                    {m.label} · Day {m.day}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-faint">
                A bar under a date marks a day that incubator sat at holding temperature ({TEMP_MODES.holding.min}–
                {TEMP_MODES.holding.max}°C) during its run. Development slows while held, so a held run can emerge
                later than these fixed milestones suggest — the dates are not adjusted, because how much holding
                delays emergence isn’t recorded anywhere.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {scheduled.map(({ inc, start }) => (
                  <span key={inc.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: colorOf.get(inc.id) }}
                    />
                    {inc.name} — started {start}
                    {(held.get(inc.id)?.size ?? 0) > 0 && (
                      <span className="text-faint">· {held.get(inc.id)!.size} holding d</span>
                    )}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
