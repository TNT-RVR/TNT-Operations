import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useData } from '@/data/context'
import { useSeasonFields } from './useSeasonFields'
import { buildWorkOrder, clashesFor, workOrderTitle, type WorkOrderDraft } from '@/domain/workOrder'

const TZ = 'America/Edmonton'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

const empty = (): WorkOrderDraft => ({
  crewId: '',
  task: 'shelter',
  fieldId: '',
  startDate: today(),
  endDate: '',
  title: '',
  notes: '',
})

/**
 * The booking form, for a new work order or an existing one.
 *
 * One component for both because they are the same eight questions; a separate
 * edit form is how the two drift until one of them forgets a field.
 *
 * Admin only, at both call sites. Anyone can still add plain entries on the
 * calendar; what is restricted is telling a crew what their day is.
 */
export function WorkOrderForm({
  initial,
  onDone,
  onCancel,
}: {
  /** The booking being changed. Absent means a new one. */
  initial?: WorkOrderDraft
  onDone?: () => void
  onCancel: () => void
}) {
  const { fields, crews, calendarEvents, saveCalendarEvent } = useData()
  const [draft, setDraft] = useState<WorkOrderDraft>(initial ?? empty())
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Editing anything clears the complaints. Leaving "Pick a field." on screen
  // after a field has been picked reads as the form still refusing.
  const set = <K extends keyof WorkOrderDraft>(k: K, v: WorkOrderDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setErrors((e) => (e.length ? [] : e))
  }

  const fieldName = fields.find((f) => f.id === draft.fieldId)?.name ?? ''

  /** Only fields with geometry can be worked — the maps need a boundary. */
  const seasonList = useSeasonFields()
  const workable = useMemo(() => seasonList.filter((f) => f.geometry), [seasonList])

  // Warned about, never blocked: a crew doing shelters in the morning and
  // trays after lunch is a real day, not a mistake.
  const clashes = useMemo(
    () => clashesFor(calendarEvents, draft.crewId, draft.startDate, draft.endDate || null, draft.id),
    [calendarEvents, draft.crewId, draft.startDate, draft.endDate, draft.id],
  )

  const submit = async () => {
    const built = buildWorkOrder(draft, fieldName)
    if (!built.ok) {
      setErrors(built.errors)
      return
    }
    setErrors([])
    setSaving(true)
    const res = await saveCalendarEvent(built.input)
    setSaving(false)
    if (!res.ok) {
      setErrors([res.error ?? 'Could not save the work order.'])
      return
    }
    setDraft(empty())
    onDone?.()
    onCancel()
  }

  return (
    <div className="rounded-md border border-default p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-semibold text-primary">
          {draft.id ? 'Edit work order' : 'New work order'}
        </span>
        <button className="ml-auto text-faint hover:text-primary" onClick={onCancel} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Crew</span>
          <select
            className="input w-full"
            value={draft.crewId}
            onChange={(e) => set('crewId', e.target.value)}
          >
            <option value="">Pick a crew…</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Job</span>
          <select
            className="input w-full"
            value={draft.task}
            onChange={(e) => set('task', e.target.value as WorkOrderDraft['task'])}
          >
            <option value="shelter">Shelter placement</option>
            <option value="tray">Tray placement</option>
            <option value="removal">Shelter removal</option>
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Field</span>
          <select
            className="input w-full"
            value={draft.fieldId}
            onChange={(e) => set('fieldId', e.target.value)}
          >
            <option value="">Pick a field…</option>
            {workable.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">Day</span>
          <input
            type="date"
            className="input w-full"
            value={draft.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
            Last day <span className="normal-case text-faint">(if it runs over)</span>
          </span>
          <input
            type="date"
            className="input w-full"
            value={draft.endDate}
            min={draft.startDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
            Name <span className="normal-case text-faint">(optional)</span>
          </span>
          <input
            className="input w-full"
            value={draft.title}
            placeholder={draft.task ? workOrderTitle(draft.task, fieldName) : ''}
            onChange={(e) => set('title', e.target.value)}
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs uppercase tracking-wide text-faint">
            Notes for the crew <span className="normal-case text-faint">(optional)</span>
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={draft.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>

      {clashes.length > 0 && (
        <p className="mt-2 text-xs text-amber-600">
          That crew is already booked then: {clashes.map((c) => c.title).join(', ')}. You can still
          book this if they are doing both.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--danger-fg)' }}>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          className="rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--brand)' }}
          onClick={() => void submit()}
          disabled={saving}
        >
          {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Book it'}
        </button>
        <button
          className="rounded-md border border-default px-3 py-2 text-sm text-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The "New work order" button, and the form it opens.
 *
 * Behind a button rather than always open: the screen is read many times a day
 * by crews and written to a few times a week by the office, and a form sitting
 * above the day's jobs would push them off a phone screen.
 */
export function NewWorkOrder({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        className="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-sm font-semibold text-primary"
        onClick={() => setOpen(true)}
      >
        <Plus size={15} />
        New work order
      </button>
    )
  }
  return <WorkOrderForm onDone={onCreated} onCancel={() => setOpen(false)} />
}
