/**
 * Overall Checklist — the season at a glance: every field down the side, every
 * step across the top.
 *
 * Replaces the spreadsheet TNT has kept since 2023. Two things it does that the
 * sheet cannot:
 *
 * 1. **The field list is live.** Rows are this season's fields straight from the
 *    map, so a field added there appears here without anyone re-typing a name —
 *    and the two can never drift apart, which is the failure the sheet has every
 *    year.
 * 2. **Planned and done are different things.** In the sheet both are the same
 *    cell, told apart by a blue fill, so the plan is destroyed the moment the
 *    work happens. Here a plan is an outline, a completion is filled, and a cell
 *    that has both says how many days apart they were.
 *
 * Colour: completed cells are `--info-fg` blue, not honey. Honey is the app's
 * single accent and the rule is one primary honey element per view — a grid
 * where half the cells are honey would drown that. Blue is also what Darren has
 * highlighted "done" with for three seasons, so it reads without explanation.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, CalendarClock, RefreshCw, X } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal, Select, StatTile } from '@/components/ui'
import { todayInTz } from '@/domain/tasks'
import {
  CHECKLIST_STEPS,
  cellKey,
  cellState,
  checklistProgress,
  daysLate,
  indexCells,
  type ChecklistCell,
} from '@/domain/fieldChecklist'
import { TasksChrome } from './TasksChrome'

/** "2026-06-08" → "Jun 8". The year is the page's, not each cell's. */
function shortDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function OverallChecklist() {
  const { fields, fieldChecklist, fieldChecklistLoading, loadFieldChecklist, saveChecklistCell, syncChecklistSheet } =
    useData()
  const canEdit = useSession().can('tasks', 'edit')

  const thisYear = String(new Date().getFullYear())
  const [year, setYear] = useState(thisYear)
  const [editing, setEditing] = useState<{ fieldName: string; step: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState('')

  useEffect(() => {
    void loadFieldChecklist(year)
  }, [loadFieldChecklist, year])

  /** Seasons offered: whatever the fields carry, plus the current one. */
  const years = useMemo(() => {
    const ys = new Set<string>([thisYear])
    for (const f of fields) {
      const y = String(f.geometry?.year ?? '').trim()
      if (y) ys.add(y)
    }
    return [...ys].sort().reverse()
  }, [fields, thisYear])

  const rows = useMemo(
    () =>
      fields
        .filter((f) => String(f.geometry?.year ?? '').trim() === year)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [fields, year],
  )

  const cells = useMemo(() => fieldChecklist.filter((c) => c.year === year), [fieldChecklist, year])
  /**
   * When the sheet and the app last agreed, read off the rows themselves —
   * there is no separate sync-state row to drift from what actually happened.
   */
  const lastSynced = useMemo(() => {
    const stamps = cells.map((c) => c.syncedAt).filter(Boolean) as string[]
    return stamps.length ? stamps.sort().at(-1)! : null
  }, [cells])
  /**
   * The name a field's marks are filed under.
   *
   * The spreadsheet names a field by company AND description ("Proven Seeds SE
   * 14-9-15"); the map names it by the description alone and keeps the company
   * separately. So an imported mark does not sit under the map's name — but the
   * import linked it to the field, and that link is the authority here.
   *
   * Every read AND write for the row then uses the name the mark already
   * carries. Writing under the map's name instead would create a second row for
   * the same work, and the sheet would grow a duplicate line the next time it
   * synced.
   */
  const filedAs = useMemo(() => {
    const byField = new Map<string, string>()
    for (const c of cells) if (c.shelterFieldId) byField.set(c.shelterFieldId, c.fieldName)
    return byField
  }, [cells])
  const nameFor = (f: { id: string; name: string }) => filedAs.get(f.id) ?? f.name

  const byKey = useMemo(() => indexCells(cells as ChecklistCell[]), [cells])
  const progress = useMemo(
    () => checklistProgress(cells as ChecklistCell[], rows.map(nameFor)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cells, rows, filedAs],
  )

  const save = async (
    fieldName: string,
    step: string,
    patch: { plannedDate?: string | null; completedDate?: string | null; note?: string },
  ) => {
    const key = cellKey(fieldName, step)
    setBusy(key)
    setError('')
    const field = rows.find((f) => nameFor(f) === fieldName)
    const r = await saveChecklistCell({
      year,
      fieldName,
      step,
      shelterFieldId: field?.id ?? null,
      ...patch,
    })
    setBusy('')
    if (!r.ok) setError(r.error ?? 'Could not save')
  }

  const runSync = async () => {
    setSyncing(true)
    setSyncNote('')
    setError('')
    const r = await syncChecklistSheet(year)
    setSyncing(false)
    if (r.ok) {
      setSyncNote(
        r.toApp || r.toSheet
          ? `Synced — ${r.toApp ?? 0} in from the sheet, ${r.toSheet ?? 0} out to it.`
          : 'Synced — already in step.',
      )
    } else setError(r.error ?? 'Sync failed')
  }

  const current = editing ? byKey.get(cellKey(editing.fieldName, editing.step)) : undefined

  return (
    <TasksChrome
      title="Overall Checklist"
      subtitle="Every field this season, and what has been done to it"
      actions={
        <div className="flex items-center gap-2">
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          {canEdit && (
            <Button variant="ghost" disabled={syncing} onClick={() => void runSync()}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : undefined} />
              {syncing ? 'Syncing…' : 'Sync sheet'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 p-4 md:p-6">
        {error && <p className="text-xs text-danger">{error}</p>}
        {syncNote && <p className="text-xs text-secondary">{syncNote}</p>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Fields" value={rows.length} hint={`${year} season`} />
          <StatTile label="Steps done" value={progress.done} hint={`of ${progress.total}`} tone="good" />
          <StatTile label="Planned" value={progress.planned} hint="dated, not yet done" />
          <StatTile label="Complete" value={`${progress.pct}%`} />
        </div>

        {rows.length === 0 ? (
          <EmptyState>
            No fields carry a {year} season yet — the rows here come from the map, so add or stamp a field there
            and it appears.
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th sticky left-0 z-10 bg-overlay text-left">Field</th>
                  {CHECKLIST_STEPS.map((s) => (
                    <th key={s.key} className="th text-left" title={s.hint}>
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="border-t border-subtle">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium text-primary">
                      {f.name}
                      {nameFor(f) !== f.name && (
                        <span className="block text-xs text-faint">filed as “{nameFor(f)}” in the sheet</span>
                      )}
                    </td>
                    {CHECKLIST_STEPS.map((s) => {
                      const filed = nameFor(f)
                      const cell = byKey.get(cellKey(filed, s.key))
                      const state = cellState(cell)
                      const late = daysLate(cell)
                      const key = cellKey(filed, s.key)
                      return (
                        <td key={s.key} className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setEditing({ fieldName: filed, step: s.key })}
                              title={cell?.note || `${f.name} — ${s.label}`}
                              className={
                                state === 'done'
                                  ? 'rounded-sm border border-info/50 bg-info/15 px-2 py-1 text-xs font-semibold text-info'
                                  : state === 'planned'
                                    ? 'rounded-sm border border-dashed border-default px-2 py-1 text-xs text-muted'
                                    : 'rounded-sm border border-transparent px-2 py-1 text-xs text-faint hover:border-subtle'
                              }
                            >
                              {state === 'done'
                                ? shortDate(cell?.completedDate ?? null)
                                : state === 'planned'
                                  ? shortDate(cell?.plannedDate ?? null)
                                  : '—'}
                              {late != null && late !== 0 && (
                                <span className="ml-1 font-normal text-muted">
                                  {late > 0 ? `+${late}d` : `${late}d`}
                                </span>
                              )}
                            </button>
                            {canEdit && state !== 'done' && (
                              <button
                                type="button"
                                aria-label={`Mark ${s.label} done for ${f.name}`}
                                title={`Mark done today`}
                                disabled={busy === key}
                                onClick={() => void save(filed, s.key, { completedDate: todayInTz() })}
                                className="rounded-sm p-1 text-faint transition hover:bg-[color:var(--hover-wash)] hover:text-info disabled:opacity-50"
                              >
                                <Check size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-faint">
          {fieldChecklistLoading
            ? 'Loading…'
            : 'Outlined = planned. Filled blue = done. +3d = days later than planned.'}
          {lastSynced && !fieldChecklistLoading && (
            <> · Google Sheet last agreed {new Date(lastSynced).toLocaleString('en-CA', { timeZone: 'America/Edmonton' })}</>
          )}
        </p>
      </div>

      {editing && (
        <CellEditor
          fieldName={editing.fieldName}
          step={editing.step}
          cell={current}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSave={(patch) => save(editing.fieldName, editing.step, patch)}
        />
      )}
    </TasksChrome>
  )
}

/**
 * One cell, in full: the plan, the completion, and the note.
 *
 * Dates are `<input type="date">` rather than free text. The sheet accepts
 * "Half- 7/16/2026" and "Most in June 29th", which is why it can never be
 * sorted or counted — that nuance belongs in the note, and the note is here.
 */
function CellEditor({
  fieldName,
  step,
  cell,
  canEdit,
  onClose,
  onSave,
}: {
  fieldName: string
  step: string
  cell?: { plannedDate: string | null; completedDate: string | null; note: string }
  canEdit: boolean
  onClose: () => void
  onSave: (patch: { plannedDate?: string | null; completedDate?: string | null; note?: string }) => Promise<void>
}) {
  const label = CHECKLIST_STEPS.find((s) => s.key === step)?.label ?? step
  const [planned, setPlanned] = useState(cell?.plannedDate ?? '')
  const [completed, setCompleted] = useState(cell?.completedDate ?? '')
  const [note, setNote] = useState(cell?.note ?? '')
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    setSaving(true)
    await onSave({ plannedDate: planned || null, completedDate: completed || null, note })
    setSaving(false)
    onClose()
  }

  return (
    <Modal title={`${label} — ${fieldName}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="label">Planned</span>
          <Input type="date" value={planned} disabled={!canEdit} onChange={(e) => setPlanned(e.target.value)} />
        </label>

        <label className="block">
          <span className="label">Completed</span>
          <div className="flex gap-2">
            <Input
              type="date"
              value={completed}
              disabled={!canEdit}
              onChange={(e) => setCompleted(e.target.value)}
            />
            {canEdit && (
              <Button variant="ghost" type="button" onClick={() => setCompleted(todayInTz())}>
                <CalendarClock size={15} /> Today
              </Button>
            )}
          </div>
        </label>

        {planned && completed && daysLate({ plannedDate: planned, completedDate: completed }) !== 0 && (
          <Badge tone={daysLate({ plannedDate: planned, completedDate: completed })! > 0 ? 'amber' : 'green'}>
            {(() => {
              const d = daysLate({ plannedDate: planned, completedDate: completed })!
              return d > 0 ? `${d} day${d === 1 ? '' : 's'} later than planned` : `${-d} day${d === -1 ? '' : 's'} early`
            })()}
          </Badge>
        )}

        <label className="block">
          <span className="label">Note</span>
          <Input
            value={note}
            disabled={!canEdit}
            placeholder="Half done, rest next week"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setPlanned('')
                setCompleted('')
                setNote('')
              }}
            >
              <X size={15} /> Clear
            </Button>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void commit()}>
              <Check size={16} /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
