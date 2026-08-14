import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ClipboardList, MapPin, Play } from 'lucide-react'
import { PageHeader, EmptyState, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { crewOf } from '@/domain/crews'
import { fieldSupplies, supplyLines, jobsInWindow } from '@/domain/supplies'
import { getTentPositions } from '@/domain/tentGrid'
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

  /** Supplies per field, worked out once rather than per row. */
  const suppliesFor = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof fieldSupplies>>()
    return (fieldId: string) => {
      const hit = cache.get(fieldId)
      if (hit) return hit
      const f = fields.find((x) => x.id === fieldId)
      let count = 0
      try {
        if (f?.geometry) count = getTentPositions(f.geometry).length
      } catch {
        count = 0
      }
      const placed = placedShelters.filter((p) => p.fieldId === fieldId && p.status === 'placed').length
      const s = fieldSupplies(f?.geometry as Record<string, unknown> | undefined, count, placed)
      cache.set(fieldId, s)
      return s
    }
  }, [fields, placedShelters])

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
                  const s = suppliesFor(j.fieldId)
                  const lines = supplyLines(j.task, s)
                  const isMine = j.crewId === myCrewId
                  return (
                    <div
                      key={`${j.eventId}-${j.crewId}`}
                      className="rounded-md border border-default p-3"
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
                      </div>

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                        <span className="flex items-center gap-1 uppercase tracking-wide text-faint">
                          <ClipboardList size={12} />
                          Load
                        </span>
                        {lines.map((l) => (
                          <span key={l.item} className="text-secondary">
                            <span className="font-mono font-semibold text-primary">{l.qty}</span> {l.item}
                            {l.note ? <span className="text-faint"> — {l.note}</span> : null}
                          </span>
                        ))}
                      </div>

                      {/* Acres and gallons only ever fed the tray count, so
                          only a tray crew is missing anything without them. */}
                      {j.task === 'tray' && s.unknowns.length > 0 && (
                        <p className="mt-1 text-xs text-amber-600">
                          Missing from the field: {s.unknowns.join(', ')}.
                        </p>
                      )}

                      {/* The way into the map. Reading the order first is the
                          point: the load list above is only useful before the
                          trailer leaves, and a crew that starts from the map
                          has already driven past the moment it mattered. */}
                      <Link
                        className="mt-3 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white"
                        style={{ background: 'var(--brand)' }}
                        // Removal works the shelter map: it is the view that
                        // knows where every shelter was put, which is exactly
                        // what a crew collecting them needs.
                        to={`${j.task === 'tray' ? '/field/trays' : '/field/shelters'}?field=${j.fieldId}`}
                      >
                        <Play size={15} />
                        {j.task === 'removal'
                          ? 'Start shelter removal'
                          : `Start ${j.task === 'tray' ? 'tray' : 'shelter'} placement`}
                      </Link>
                    </div>
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
