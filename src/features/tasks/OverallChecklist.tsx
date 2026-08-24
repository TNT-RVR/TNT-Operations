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
 * Colour: a completed cell is a solid `--done-fill` blue box with white text —
 * the spreadsheet's own convention, so it reads without explanation. Not honey:
 * honey is the app's single accent and the rule is one primary honey element per
 * view, which a grid half-full of it would drown. `--done-fill` exists because
 * every other blue here is a FOREGROUND colour and unreadable as a fill.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CalendarClock, Columns3, RefreshCw, X } from 'lucide-react'
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

const HIDDEN_KEY = 'tnt.checklist.hiddenColumns.v1'

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
  const {
    fields,
    fieldChecklist,
    fieldChecklistLoading,
    loadFieldChecklist,
    saveChecklistCell,
    syncChecklistSheet,
    fieldSeasons,
    fieldAliases,
    loadFieldSeasons,
  } = useData()
  const session = useSession()
  const canEdit = session.can('tasks', 'edit')
  // A crew tablet has Tasks but not Shelter Maps, so the name is a link only
  // where the destination is actually reachable.
  const canSeeMaps = session.can('maps')

  const thisYear = String(new Date().getFullYear())
  const [year, setYear] = useState(thisYear)
  const [editing, setEditing] = useState<{ fieldName: string; step: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState('')
  const [pickingColumns, setPickingColumns] = useState(false)
  /**
   * Columns hidden on THIS device.
   *
   * Hiding is a view, never a delete: the marks stay, the sync keeps carrying
   * them, and the spreadsheet keeps its column. TNT does not bait every field
   * every season, so a Mouse Poison column of dashes is noise most of the time
   * — but the seasons where it was baited still need their record.
   *
   * Per device rather than per account, like the map's layer switches: it is a
   * preference about a screen, and syncing it would mean one person tidying
   * their own view changes what the office sees.
   */
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
    } catch {
      // A device that refuses storage still gets working toggles, just not
      // remembered ones.
    }
  }, [hidden])
  const steps = useMemo(() => CHECKLIST_STEPS.filter((s) => !hidden.has(s.key)), [hidden])

  useEffect(() => {
    void loadFieldChecklist(year)
  }, [loadFieldChecklist, year])
  // Season Setup is the field list now; a year it has not been used for
  // simply returns nothing and the map's list is used instead.
  useEffect(() => {
    void loadFieldSeasons(year)
  }, [loadFieldSeasons, year])

  /**
   * Seasons offered: whatever the fields carry, this one, and the NEXT one.
   *
   * Next season is there so planning can start before a single field is stamped
   * with it — and because selecting it and syncing is what creates its tab in
   * the spreadsheet, copied from this year's header.
   */
  const years = useMemo(() => {
    const ys = new Set<string>([thisYear, String(Number(thisYear) + 1)])
    for (const s of fieldSeasons) ys.add(s.year)
    for (const f of fields) {
      const y = String(f.geometry?.year ?? '').trim()
      if (y) ys.add(y)
    }
    return [...ys].sort().reverse()
  }, [fields, fieldSeasons, thisYear])

  const mapped = useMemo(
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
   * The rows: the season's fields, then any marks belonging to no field.
   *
   * Fields come from SEASON SETUP (`field_seasons`) when that season has been
   * set up, and fall back to the map's own list otherwise. That fallback is the
   * whole migration strategy in one expression: 2027 is declared in Season
   * Setup and reads from it, while a season nobody has set up yet keeps working
   * exactly as before.
   *
   * The name a row's marks are FILED under is resolved in three steps, most
   * proven first:
   *   1. a mark already linked to this field — whatever it is filed as, that is
   *      what the sheet calls it, and it is a fact rather than a guess;
   *   2. a registered sheet ALIAS for the field;
   *   3. the field's own name.
   *
   * Writing under anything else would create a second row for the same work and
   * grow a duplicate line in the spreadsheet on the next sync.
   */
  const rows = useMemo(() => {
    const seasonRows = fieldSeasons.filter((s) => s.year === year && s.field)
    const aliasFor = new Map<string, string>()
    for (const a of fieldAliases) if (a.source === 'sheet') aliasFor.set(a.fieldId, a.alias)

    // Marks carry the map's field id, so a season is matched to them through
    // the map row it was backfilled from.
    const markNameByMapField = new Map<string, string>()
    for (const c of cells) if (c.shelterFieldId) markNameByMapField.set(c.shelterFieldId, c.fieldName)

    const onMap =
      seasonRows.length > 0
        ? seasonRows
            .map((s) => ({
              key: s.id,
              label: s.field!.name,
              filed:
                (s.shelterFieldId ? markNameByMapField.get(s.shelterFieldId) : undefined) ??
                aliasFor.get(s.fieldId) ??
                s.field!.name,
              fieldId: s.shelterFieldId ?? null,
              onMap: true,
            }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : mapped.map((f) => ({
            key: f.id,
            label: f.name,
            filed: markNameByMapField.get(f.id) ?? f.name,
            fieldId: f.id as string | null,
            onMap: true,
          }))

    const covered = new Set(onMap.map((r) => r.filed))
    const orphans = [...new Set(cells.map((c) => c.fieldName))]
      .filter((n) => !covered.has(n))
      .sort()
      .map((n) => ({ key: `name:${n}`, label: n, filed: n, fieldId: null, onMap: false }))
    return [...onMap, ...orphans]
  }, [mapped, fieldSeasons, fieldAliases, cells, year])

  const byKey = useMemo(() => indexCells(cells as ChecklistCell[]), [cells])
  const progress = useMemo(
    // Only the visible steps: a total that counts a column you have chosen not
    // to track reads as permanently unfinished work.
    () => checklistProgress(cells as ChecklistCell[], rows.map((r) => r.filed), steps.map((s) => s.key)),
    [cells, rows, steps],
  )

  const save = async (
    fieldName: string,
    step: string,
    patch: { plannedDate?: string | null; completedDate?: string | null; note?: string },
  ) => {
    const key = cellKey(fieldName, step)
    setBusy(key)
    setError('')
    const row = rows.find((r) => r.filed === fieldName)
    const r = await saveChecklistCell({
      year,
      fieldName,
      step,
      shelterFieldId: row?.fieldId ?? null,
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
          <div className="relative">
            <Button variant="ghost" onClick={() => setPickingColumns((v) => !v)}>
              <Columns3 size={16} /> Columns{hidden.size > 0 ? ` (${steps.length}/${CHECKLIST_STEPS.length})` : ''}
            </Button>
            {pickingColumns && (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-default bg-raised p-2 shadow-lg">
                {CHECKLIST_STEPS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-overlay">
                    <input
                      type="checkbox"
                      checked={!hidden.has(s.key)}
                      onChange={(e) =>
                        setHidden((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.delete(s.key)
                          else next.add(s.key)
                          return next
                        })
                      }
                    />
                    <span className="text-primary">{s.label}</span>
                  </label>
                ))}
                <p className="px-2 pt-1 text-xs text-faint">Hiding only affects this device. Nothing is deleted.</p>
              </div>
            )}
          </div>
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
          <StatTile label="Fields" value={rows.length} hint={`${mapped.length} on the map`} />
          <StatTile label="Steps done" value={progress.done} hint={`of ${progress.total}`} tone="good" />
          <StatTile label="Planned" value={progress.planned} hint="dated, not yet done" />
          <StatTile label="Complete" value={`${progress.pct}%`} />
        </div>

        {rows.length === 0 ? (
          <EmptyState>
            Nothing recorded for {year}, and no field carries that season on the map.
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th sticky left-0 z-10 bg-overlay text-left">Field</th>
                  {steps.map((s) => (
                    <th key={s.key} className="th text-left" title={s.hint}>
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-subtle">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium text-primary">
                      {row.fieldId && canSeeMaps ? (
                        // Straight to this field on the office map. The checklist
                        // is usually where someone first notices a field needs
                        // looking at, and retyping its name into the map's search
                        // is the step that gets skipped.
                        <Link to={`/maps?field=${row.fieldId}`} className="hover:text-brand hover:underline">
                          {row.label}
                        </Link>
                      ) : (
                        row.label
                      )}
                      {row.onMap && row.filed !== row.label && (
                        <span className="block text-xs text-faint">filed as “{row.filed}” in the sheet</span>
                      )}
                      {!row.onMap && (
                        <span className="block text-xs text-faint">not on this season&rsquo;s map</span>
                      )}
                    </td>
                    {steps.map((s) => {
                      const filed = row.filed
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
                              title={cell?.note || `${row.label} — ${s.label}`}
                              className={
                                state === 'done'
                                  ? // Solid blue with white text — the spreadsheet's own convention
                                    // for a finished step, and what makes it readable at a glance
                                    // down fourteen rows.
                                    'rounded-sm border border-transparent px-2 py-1 text-xs font-semibold'
                                  : state === 'planned'
                                    ? 'rounded-sm border border-dashed border-default px-2 py-1 text-xs text-muted'
                                    : 'rounded-sm border border-transparent px-2 py-1 text-xs text-faint hover:border-subtle'
                              }
                              style={
                                state === 'done'
                                  ? { background: 'var(--done-fill)', color: 'var(--on-done)' }
                                  : undefined
                              }
                            >
                              {state === 'done'
                                ? shortDate(cell?.completedDate ?? null)
                                : state === 'planned'
                                  ? shortDate(cell?.plannedDate ?? null)
                                  : '—'}
                              {late != null && late !== 0 && (
                                <span
                                  className="ml-1 font-normal"
                                  // Muted ink vanishes on the blue, so on a done cell this steps
                                  // back by opacity rather than by colour.
                                  style={
                                    state === 'done' ? { color: 'var(--on-done)', opacity: 0.8 } : { color: 'var(--text-muted)' }
                                  }
                                >
                                  {late > 0 ? `+${late}d` : `${late}d`}
                                </span>
                              )}
                            </button>
                            {canEdit && state !== 'done' && (
                              <button
                                type="button"
                                aria-label={`Mark ${s.label} done for ${row.label}`}
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
