import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarDays, ChevronRight, MapPin } from 'lucide-react'
import { PageHeader, EmptyState, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { crewOf } from '@/domain/crews'
import { jobsInWindow } from '@/domain/supplies'
import { overdueJobs, OVERDUE_LOOKBACK_DAYS } from '@/domain/workOrderProgress'
import { TASK_LABEL } from '@/domain/workOrder'
import { NewWorkOrder } from './NewWorkOrder'

const TZ = 'America/Edmonton'
/** How far ahead to look. A season is planned in weeks, not months. */
const HORIZON_DAYS = 21

const ymdIn = (days: number) =>
  new Date(Date.now() + days * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })

const shortDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5) + 1

/**
 * How long a job runs, for the card.
 *
 * A one-day job says nothing — the day heading above it already did. Only a
 * job that spans days has something to add, and what a crew wants from it is
 * how many days they are committed to, not two dates to subtract in their
 * head at six in the morning.
 */
const rangeLabel = (start: string, last: string) =>
  last > start ? `${shortDay(start)} – ${shortDay(last)} · ${daysBetween(start, last)} days` : null

const prettyDay = (ymd: string, today: string) => {
  if (ymd === today) return 'Today'
  if (ymd === ymdIn(1)) return 'Tomorrow'
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Work orders — what is booked, for whom, and what to load.
 *
 * Its own screen rather than a banner over the map. A crew wants this twice a
 * day: loading the trailer in the morning and deciding what is next when a
 * field is finished. A bar across the top of a map for the eight hours in
 * between is in the way, and gets dismissed and then missed.
 *
 * Shows the whole operation, not just your own crew: knowing that Crew 2 is on
 * Bow Island tomorrow is how somebody avoids driving there with a trailer.
 */
export default function ScheduleHome() {
  const {
    fields,
    crews,
    crewMembers,
    calendarEvents,
    placedShelters,
    loadCalendarEvents,
    loadCrews,
  } = useData()
  const session = useSession()

  useEffect(() => {
    void loadCalendarEvents()
  }, [loadCalendarEvents])
  useEffect(() => {
    void loadCrews()
  }, [loadCrews])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const myCrewId = crewOf(crewMembers, session.user.id)
  const isAdmin = session.can('users', 'edit')
  const [mineOnly, setMineOnly] = useState(false)

  /**
   * Every booked job from today to the horizon, each listed once and grouped
   * under the day it starts (or today, if it is already under way).
   */
  const days = useMemo(() => {
    const ids = crews.filter((c) => !mineOnly || c.id === myCrewId).map((c) => c.id)
    const jobs = jobsInWindow(calendarEvents, ids, ymdIn(0), ymdIn(HORIZON_DAYS - 1))
    const byDay = new Map<string, typeof jobs>()
    for (const j of jobs) {
      const list = byDay.get(j.showOn)
      if (list) list.push(j)
      else byDay.set(j.showOn, [j])
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ymd, list]) => ({ ymd, jobs: list }))
  }, [calendarEvents, crews, mineOnly, myCrewId])

  /**
   * Placement progress per field, read from the shelters themselves.
   *
   * No work order carries a "finished" flag and none should: it is state
   * somebody has to remember to set, and it goes stale the first busy
   * afternoon. Every placed shelter is a row, so this is a fact rather than a
   * claim.
   */
  const progressFor = useMemo(() => {
    const placedByField = new Map<string, number>()
    for (const p of placedShelters) {
      if (p.status !== 'placed' || !p.fieldId) continue
      placedByField.set(p.fieldId, (placedByField.get(p.fieldId) ?? 0) + 1)
    }
    return (fieldId: string) => {
      const f = fields.find((x) => x.id === fieldId)
      if (!f) return null
      return { placed: placedByField.get(fieldId) ?? 0, planned: f.shelterCount ?? 0 }
    }
  }, [placedShelters, fields])

  /**
   * Booked work that ran out of days without running out of shelters.
   *
   * These used to disappear the morning after their last date, leaving a
   * half-placed quarter with nothing pointing at it — the sort of thing found
   * in September.
   */
  const overdue = useMemo(() => {
    const ids = crews.filter((c) => !mineOnly || c.id === myCrewId).map((c) => c.id)
    const past = jobsInWindow(calendarEvents, ids, ymdIn(-OVERDUE_LOOKBACK_DAYS), ymdIn(-1))
    return overdueJobs(past, today, progressFor)
  }, [calendarEvents, crews, mineOnly, myCrewId, today, progressFor])

  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name ?? 'Unknown field'
  const crewName = (id: string) => crews.find((c) => c.id === id)?.name ?? 'Crew'

  return (
    <div>
      <PageHeader
        title="Work orders"
        subtitle="What is booked, who has it, and what to load"
        actions={
          myCrewId ? (
            <label className="flex items-center gap-2 text-sm text-secondary">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              Just my crew
            </label>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {/* Booking is the office's job, so it sits above the day list rather
            than inside it — and only for admins. */}
        {isAdmin && <NewWorkOrder onCreated={() => void loadCalendarEvents()} />}

        {!myCrewId && (
          <p className="text-sm text-muted">
            You are not on a crew, so nothing here is yours yet.{' '}
            <Link to="/field/crews" className="text-brand underline">
              Join one
            </Link>
            .
          </p>
        )}

        {/*
          Unfinished, and out of days. Above the schedule on purpose: it is
          work somebody already committed to and did not complete, which beats
          anything merely booked for later.
        */}
        {overdue.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 font-semibold" style={{ color: 'var(--warn-fg)' }}>
              <AlertTriangle size={16} />
              Not finished
            </h2>
            <div className="space-y-2">
              {overdue.map((j) => (
                <Link
                  key={`${j.eventId}-${j.crewId}`}
                  to={`/field/order/${j.eventId}`}
                  className="block rounded-md border p-3"
                  style={{ borderColor: 'var(--warn-bd)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-primary">{j.title}</span>
                    <Badge tone={j.task === 'tray' ? 'green' : j.task === 'removal' ? 'blue' : 'amber'}>
                      {TASK_LABEL[j.task]}
                    </Badge>
                    <span className="text-sm text-secondary">{crewName(j.crewId)}</span>
                    <span className="text-xs" style={{ color: 'var(--warn-fg)' }}>
                      {j.daysLate === 1 ? 'due yesterday' : `${j.daysLate} days past its last day`}
                    </span>
                    {/* Only shelter work can prove how far it got; saying
                        nothing beats inventing a number for the others. */}
                    {j.progress && j.progress.planned > 0 && (
                      <span className="font-mono text-xs text-secondary">
                        {j.progress.placed}/{j.progress.planned} placed
                      </span>
                    )}
                    <span className="ml-auto text-sm text-secondary">
                      <MapPin size={13} className="mr-1 inline text-faint" />
                      {fieldName(j.fieldId)}
                    </span>
                    <ChevronRight size={16} className="text-faint" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {days.length === 0 ? (
          <EmptyState>
            Nothing booked in the next {HORIZON_DAYS} days. Add work on the{' '}
            <Link to="/calendar" className="text-brand underline">
              calendar
            </Link>{' '}
            — pick a crew, a job and a field, and it appears here.
          </EmptyState>
        ) : (
          days.map(({ ymd, jobs }) => (
            <section key={ymd}>
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-primary">
                <CalendarDays size={16} className="text-brand" />
                {prettyDay(ymd, today)}
                <span className="text-xs font-normal text-faint">{ymd}</span>
              </h2>

              <div className="space-y-2">
                {jobs.map((j) => {
                  const isMine = j.crewId === myCrewId

                  // The whole card opens the order. Nothing on the list is a
                  // shortcut past it: the load list and the start button live
                  // on the order itself, so the only way to the map is
                  // through the page that says what to put on the trailer.
                  return (
                    <Link
                      key={`${j.eventId}-${j.crewId}`}
                      to={`/field/order/${j.eventId}`}
                      className="block rounded-md border border-default p-3"
                      style={isMine ? { borderColor: 'var(--brand)' } : undefined}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-primary">{j.title}</span>
                        <Badge
                          tone={j.task === 'tray' ? 'green' : j.task === 'removal' ? 'blue' : 'amber'}
                        >
                          {TASK_LABEL[j.task]}
                        </Badge>
                        <span className="text-sm text-secondary">{crewName(j.crewId)}</span>
                        {isMine && <span className="text-xs text-brand">yours</span>}
                        {/* One card for the whole booking; the span is stated
                            here rather than repeated on every day it covers. */}
                        {rangeLabel(j.startDate, j.lastDate) && (
                          <span className="rounded-pill border border-default px-2 py-0.5 text-xs text-secondary">
                            {rangeLabel(j.startDate, j.lastDate)}
                          </span>
                        )}
                        {j.startDate < j.showOn && (
                          <span className="text-xs text-faint">
                            started {shortDay(j.startDate)}
                          </span>
                        )}
                        <span className="ml-auto text-sm text-secondary">
                          <MapPin size={13} className="mr-1 inline text-faint" />
                          {fieldName(j.fieldId)}
                        </span>
                        <ChevronRight size={16} className="text-faint" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))
        )}

        {/*
          Unscheduled work.

          Plans change in the field — a quarter finishes early, a booking was
          never made, the office is asleep. Routing placement through work
          orders is meant to put the load list in front of people, not to stop
          a crew that has bees on the trailer and somewhere to put them. So the
          door stays open, just plainly marked as being outside the schedule.
        */}
        <details className="rounded-md border border-default">
          <summary className="cursor-pointer px-3 py-2 text-sm text-secondary">
            Working something that isn't booked?
          </summary>
          <div className="flex flex-wrap gap-2 border-t border-default p-3">
            <Link
              to="/field/shelters"
              className="rounded-md border border-default px-3 py-2 text-sm text-primary"
            >
              Shelter placement
            </Link>
            <Link
              to="/field/trays"
              className="rounded-md border border-default px-3 py-2 text-sm text-primary"
            >
              Tray placement
            </Link>
            <p className="w-full text-xs text-faint">
              You'll pick the field yourself, and there is no load list — the
              supplies above are worked out from the booking.
            </p>
          </div>
        </details>
      </div>
    </div>
  )
}
