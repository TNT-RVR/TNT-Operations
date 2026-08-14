import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  MapPin,
  Pencil,
  Play,
  Users,
} from 'lucide-react'
import { PageHeader, EmptyState, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { crewOf, membersOf, leadOf } from '@/domain/crews'
import { fieldSupplies, supplyLines } from '@/domain/supplies'
import { getTentPositions } from '@/domain/tentGrid'
import { TASK_LABEL, workOrderTitle } from '@/domain/workOrder'
import { WorkOrderForm } from './NewWorkOrder'

const longDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

/**
 * One work order, in full.
 *
 * The list is a list — enough to find the right job and no more. This is where
 * the job actually is: who it belongs to, which field, what to put on the
 * trailer, anything the office wrote down, and only then the button that
 * starts it.
 *
 * That ordering is the point. The load list is worth nothing after the trailer
 * has left the yard, so the way into the map runs through the page that says
 * what to load rather than around it.
 */
export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    void loadCalendarEvents()
  }, [loadCalendarEvents])
  useEffect(() => {
    void loadCrews()
  }, [loadCrews])

  const isAdmin = session.can('users', 'edit')
  const event = calendarEvents.find((e) => e.id === id)
  const field = fields.find((f) => f.id === event?.fieldId)
  const crew = crews.find((c) => c.id === event?.crewId)
  const mates = useMemo(
    () => (crew ? membersOf(crewMembers, crew.id) : []),
    [crewMembers, crew],
  )
  const lead = crew ? leadOf(crewMembers, crew.id) : null
  const isMine = crew != null && crewOf(crewMembers, session.user.id) === crew.id

  const supplies = useMemo(() => {
    if (!field) return null
    let count = 0
    try {
      if (field.geometry) count = getTentPositions(field.geometry).length
    } catch {
      count = 0
    }
    const placed = placedShelters.filter(
      (p) => p.fieldId === field.id && p.status === 'placed',
    ).length
    return fieldSupplies(field.geometry as Record<string, unknown> | undefined, count, placed)
  }, [field, placedShelters])

  // A work order needs all three to be a job at all; an event missing one is an
  // ordinary calendar entry that somebody reached by guessing at a URL.
  if (!event || !event.crewId || !event.task || !event.fieldId) {
    return (
      <div>
        <PageHeader title="Work order" />
        <div className="p-4 md:p-6">
          <EmptyState>
            That work order is not here — it may have been changed or deleted.{' '}
            <Link to="/field" className="text-brand underline">
              Back to work orders
            </Link>
            .
          </EmptyState>
        </div>
      </div>
    )
  }

  const task = event.task
  const lastDate =
    event.endDate && event.endDate > event.startDate ? event.endDate : event.startDate
  const lines = supplies ? supplyLines(task, supplies) : []

  return (
    <div>
      <PageHeader
        title={event.title}
        subtitle={`${TASK_LABEL[task]} · ${crew?.name ?? 'Crew'}`}
        actions={
          <Link to="/field" className="flex items-center gap-1 text-sm text-secondary">
            <ChevronLeft size={16} />
            All work orders
          </Link>
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {editing ? (
          <WorkOrderForm
            initial={{
              id: event.id,
              crewId: event.crewId,
              task,
              fieldId: event.fieldId,
              startDate: event.startDate,
              endDate: event.endDate ?? '',
              title: event.title === workOrderTitle(task, field?.name ?? '') ? '' : event.title,
              notes: event.notes,
            }}
            onDone={() => void loadCalendarEvents()}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={task === 'tray' ? 'green' : task === 'removal' ? 'blue' : 'amber'}>
                {TASK_LABEL[task]}
              </Badge>
              {isMine && <span className="text-xs text-brand">your crew</span>}
              {isAdmin && (
                <button
                  className="ml-auto flex items-center gap-1 rounded-md border border-default px-2 py-1 text-xs font-semibold text-primary"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={13} />
                  Edit
                </button>
              )}
            </div>

            {/* When, where, who — the three things asked at the yard gate. */}
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-default p-3">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-faint">
                  <CalendarDays size={13} />
                  When
                </dt>
                <dd className="mt-1 text-sm text-primary">
                  {longDay(event.startDate)}
                  {lastDate !== event.startDate && (
                    <span className="block text-secondary">through {longDay(lastDate)}</span>
                  )}
                </dd>
              </div>

              <div className="rounded-md border border-default p-3">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-faint">
                  <MapPin size={13} />
                  Where
                </dt>
                <dd className="mt-1 text-sm text-primary">
                  {field?.name ?? 'Unknown field'}
                  {supplies && (
                    <span className="block text-secondary">
                      {supplies.shelters} shelters in the plan
                    </span>
                  )}
                </dd>
              </div>

              <div className="rounded-md border border-default p-3">
                <dt className="flex items-center gap-1 text-xs uppercase tracking-wide text-faint">
                  <Users size={13} />
                  Who
                </dt>
                <dd className="mt-1 text-sm text-primary">
                  {crew?.name ?? 'Crew'}
                  <span className="block text-secondary">
                    {mates.length} on the crew
                    {lead
                      ? ` · lead ${session.users.find((u) => u.id === lead.userId)?.name ?? ''}`
                      : ' · no lead set'}
                  </span>
                </dd>
              </div>
            </dl>

            {/* The load list, which is the reason this page exists. */}
            <section className="rounded-md border border-default p-3">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                <ClipboardList size={15} className="text-brand" />
                Load before leaving
              </h2>
              <ul className="space-y-1">
                {lines.map((l) => (
                  <li key={l.item} className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-10 font-mono font-semibold text-primary">{l.qty}</span>
                    <span className="text-secondary">{l.item}</span>
                    {l.note && <span className="text-xs text-faint">— {l.note}</span>}
                  </li>
                ))}
              </ul>
              {task === 'tray' && supplies && supplies.unknowns.length > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  Missing from the field: {supplies.unknowns.join(', ')}. The tray count cannot be
                  worked out until those are filled in.
                </p>
              )}
            </section>

            {event.notes.trim() !== '' && (
              <section className="rounded-md border border-default p-3">
                <h2 className="mb-1 text-sm font-semibold text-primary">Notes</h2>
                <p className="whitespace-pre-wrap text-sm text-secondary">{event.notes}</p>
              </section>
            )}

            {/* Last, deliberately: everything above is what the button assumes
                has been read. */}
            <Link
              className="flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-semibold text-white"
              style={{ background: 'var(--brand)' }}
              to={`${task === 'tray' ? '/field/trays' : '/field/shelters'}?field=${event.fieldId}`}
            >
              <Play size={16} />
              {task === 'removal'
                ? 'Start shelter removal'
                : `Start ${task === 'tray' ? 'tray' : 'shelter'} placement`}
            </Link>

            <button
              className="w-full text-center text-xs text-faint"
              onClick={() => navigate('/field')}
            >
              Back to all work orders
            </button>
          </>
        )}
      </div>
    </div>
  )
}
