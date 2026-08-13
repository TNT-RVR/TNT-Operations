import { useMemo, useState } from 'react'
import { ClipboardList, CalendarDays, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { crewOf } from '@/domain/crews'
import { fieldSupplies, supplyLines, jobsForCrew } from '@/domain/supplies'
import { getTentPositions } from '@/domain/tentGrid'

const TZ = 'America/Edmonton'

/**
 * Today's job for this crew, and what to load for it.
 *
 * The point of scheduling in the calendar is that nobody has to be told twice:
 * the office books "Crew 2, shelters, Bow Island, Thursday" and on Thursday
 * the crew's own screen already knows. Picking the field by hand each morning
 * is how a crew ends up working the wrong quarter.
 *
 * Shown, never forced. It offers the field rather than switching to it — a
 * crew that has moved on to somewhere else should not have the map yanked out
 * from under them by a booking somebody made last week.
 */
export function ScheduledJob({
  task,
  currentFieldId,
  onUseField,
}: {
  task: 'shelter' | 'tray'
  currentFieldId: string | null
  onUseField: (fieldId: string) => void
}) {
  const { fields, crews, crewMembers, calendarEvents, placedShelters } = useData()
  const session = useSession()

  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const myCrewId = crewOf(crewMembers, session.user.id)

  const job = useMemo(() => {
    if (!myCrewId) return null
    return jobsForCrew(calendarEvents, myCrewId, today).find((j) => j.task === task) ?? null
  }, [calendarEvents, myCrewId, today, task])

  const field = fields.find((f) => f.id === (job?.fieldId ?? currentFieldId))

  const supplies = useMemo(() => {
    if (!field?.geometry) return null
    let count = 0
    try {
      count = getTentPositions(field.geometry).length
    } catch {
      count = 0
    }
    const placed = placedShelters.filter(
      (p) => p.fieldId === field.id && p.status === 'placed',
    ).length
    return fieldSupplies(field.geometry as Record<string, unknown>, count, placed)
  }, [field, placedShelters])

  const crewName = crews.find((c) => c.id === myCrewId)?.name ?? 'Your crew'
  const lines = supplies ? supplyLines(task, supplies) : []

  /**
   * Dismissed for the rest of the day.
   *
   * This is a map screen; a banner across the top of it every minute of a
   * shift earns nothing after the first read. It comes back tomorrow, and the
   * button brings it back sooner.
   */
  const dismissKey = `field.schedule.dismissed.${today}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === '1'
    } catch {
      return false
    }
  })
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(dismissKey, '1')
    } catch {
      /* private mode — it just comes back on reload */
    }
  }

  // Not on a crew: say so rather than showing nothing. An empty space is
  // indistinguishable from a broken screen, and the fix is one tap away.
  if (!myCrewId) {
    if (dismissed) return null
    return (
      <div className="flex items-center gap-2 rounded-md border border-default bg-inset px-2 py-1 text-xs">
        <CalendarDays size={14} className="text-faint" />
        <span className="text-muted">
          You are not on a crew, so nothing is scheduled here.{' '}
          <Link to="/field/crews" className="text-brand underline">
            Join one
          </Link>
        </span>
        <button className="ml-auto text-faint hover:text-primary" onClick={dismiss} aria-label="Hide">
          <X size={14} />
        </button>
      </div>
    )
  }

  if (dismissed) {
    return (
      <button
        className="rounded-md border border-default bg-inset px-2 py-1 text-xs text-muted"
        onClick={() => {
          setDismissed(false)
          try {
            localStorage.removeItem(dismissKey)
          } catch {
            /* nothing to clear */
          }
        }}
      >
        <ClipboardList size={13} className="mr-1 inline" />
        {job ? job.title : "Today's job"}
      </button>
    )
  }

  return (
    <div className="rounded-md border border-default bg-inset p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays size={15} className="text-brand" />
        {job ? (
          <>
            <span className="font-semibold text-primary">{job.title}</span>
            <span className="text-xs text-muted">
              {crewName} · {fields.find((f) => f.id === job.fieldId)?.name ?? 'unknown field'}
            </span>
            {job.fieldId !== currentFieldId && (
              <button
                className="ml-auto text-xs text-brand underline"
                onClick={() => onUseField(job.fieldId)}
              >
                Open this field
              </button>
            )}
            <button
              className={`${job.fieldId !== currentFieldId ? '' : 'ml-auto'} text-faint hover:text-primary`}
              onClick={dismiss}
              aria-label="Hide today's job"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-muted">
              {crewName} has nothing booked for {task === 'tray' ? 'trays' : 'shelters'} today.
            </span>
            <button
              className="ml-auto text-faint hover:text-primary"
              onClick={dismiss}
              aria-label="Hide today's job"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      {/* The packing list, for the field being worked — scheduled or chosen.
          Computed from the field's own acres and gallons rather than a list
          kept by hand, which would go stale without anyone noticing. */}
      {lines.length > 0 && field && (
        <div className="mt-2 border-t border-default pt-2">
          <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-faint">
            <ClipboardList size={13} />
            Load for {field.name}
          </div>
          <ul className="space-y-0.5">
            {lines.map((l) => (
              <li key={l.item} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono font-semibold text-primary">{l.qty}</span>
                <span className="text-secondary">{l.item}</span>
                {l.note && <span className="text-faint">— {l.note}</span>}
              </li>
            ))}
          </ul>
          {supplies && supplies.unknowns.length > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Missing from the field: {supplies.unknowns.join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
