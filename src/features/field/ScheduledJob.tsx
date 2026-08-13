import { useMemo } from 'react'
import { ClipboardList, CalendarDays } from 'lucide-react'
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

  if (!myCrewId) return null

  const crewName = crews.find((c) => c.id === myCrewId)?.name ?? 'Your crew'
  const lines = supplies ? supplyLines(task, supplies) : []

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
          </>
        ) : (
          <span className="text-xs text-muted">
            {crewName} has nothing booked for {task === 'tray' ? 'trays' : 'shelters'} today.
          </span>
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
