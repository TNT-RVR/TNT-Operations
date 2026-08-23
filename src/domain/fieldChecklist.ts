/**
 * The Overall Checklist: which season jobs are done on which field.
 *
 * The steps are the columns of the spreadsheet TNT has kept since 2023, in the
 * order they happen in the season. Gallons / Structures / Image / Type are on
 * that sheet too and are NOT steps — they are counts and attributes, recorded
 * elsewhere in the app, and putting them here would make a checklist that can
 * never be finished.
 *
 * The one idea worth stating: a cell holds TWO dates, not a date and a colour.
 * In the sheet, a planned date and a completed date are the same cell, told
 * apart by a blue fill — so "we plan to pull structures on the 20th" and "we
 * pulled them on the 20th" look identical to anything that reads the file, and
 * the plan is destroyed the moment the work happens. Keeping both means the
 * schedule survives contact with reality, and "late" becomes answerable.
 */

export interface ChecklistStepDef {
  key: string
  label: string
  /** What finishing it means, for the tooltip and the sheet's column note. */
  hint: string
}

export const CHECKLIST_STEPS: ChecklistStepDef[] = [
  { key: 'flag', label: 'Flag', hint: 'Field flagged and staked out' },
  { key: 'structures_in', label: 'Structures In', hint: 'Shelters delivered and placed' },
  { key: 'mouse_poison', label: 'Mouse Poison', hint: 'Bait set in the shelters' },
  { key: 'bees_in', label: 'Bees In', hint: 'Trays out and bees released' },
  { key: 'structures_out', label: 'Structures Out', hint: 'Shelters pulled at end of season' },
]

export const STEP_KEYS = CHECKLIST_STEPS.map((s) => s.key)

/** One field × one step. Absent from the store until someone marks something. */
export interface ChecklistCell {
  year: string
  fieldName: string
  step: string
  plannedDate: string | null
  completedDate: string | null
  note: string
}

export type CellState = 'empty' | 'planned' | 'done'

/**
 * Done beats planned. A cell can hold both — that is the normal end state, and
 * the pair is what says whether the work landed when it was meant to.
 */
export function cellState(cell?: Pick<ChecklistCell, 'plannedDate' | 'completedDate'> | null): CellState {
  if (!cell) return 'empty'
  if (cell.completedDate) return 'done'
  if (cell.plannedDate) return 'planned'
  return 'empty'
}

/**
 * Days late, or null when it cannot be said. Negative is early.
 *
 * Only meaningful with BOTH dates: a completed step that was never planned is
 * not late, it was unplanned, and reporting that as 0 days late would be a
 * number nobody should act on.
 */
export function daysLate(cell?: Pick<ChecklistCell, 'plannedDate' | 'completedDate'> | null): number | null {
  if (!cell?.plannedDate || !cell.completedDate) return null
  const planned = Date.parse(`${cell.plannedDate}T00:00:00Z`)
  const done = Date.parse(`${cell.completedDate}T00:00:00Z`)
  if (!Number.isFinite(planned) || !Number.isFinite(done)) return null
  return Math.round((done - planned) / 86_400_000)
}

/** Progress across a season: how many of the possible marks are done. */
export function checklistProgress(
  cells: ChecklistCell[],
  fieldNames: string[],
  steps: string[] = STEP_KEYS,
): { done: number; planned: number; total: number; pct: number } {
  const wanted = new Set(fieldNames)
  const stepSet = new Set(steps)
  let done = 0
  let planned = 0
  for (const c of cells) {
    if (!wanted.has(c.fieldName) || !stepSet.has(c.step)) continue
    const state = cellState(c)
    if (state === 'done') done++
    else if (state === 'planned') planned++
  }
  const total = fieldNames.length * steps.length
  return { done, planned, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/**
 * Stable lookup key. The store is a flat list; the grid wants a map.
 *
 * The separator is the ASCII unit separator, not a space or a dash: field
 * names carry both ("BASF Lethbridge Test Plot", "Hytech Carrots #9"), so a
 * printable delimiter could be produced by a name and a step in combination
 * and collide with a different pair.
 */
const SEP = String.fromCharCode(31) // ASCII unit separator
export const cellKey = (fieldName: string, step: string): string => `${fieldName}${SEP}${step}`

export function indexCells(cells: ChecklistCell[]): Map<string, ChecklistCell> {
  const m = new Map<string, ChecklistCell>()
  for (const c of cells) m.set(cellKey(c.fieldName, c.step), c)
  return m
}

/** One checklist mark, placed on a day. */
export interface ChecklistCalendarEntry {
  date: string
  fieldName: string
  step: string
  stepLabel: string
  kind: 'planned' | 'done'
}

/**
 * Checklist marks as calendar entries.
 *
 * DERIVED, never stored twice. A mark already has a date and a field; copying
 * it into `calendar_events` would mean two records of one fact, and the day a
 * step moves is the day they start disagreeing.
 *
 * A cell with both dates contributes only its COMPLETED day. The plan is
 * history the moment the work happens — the calendar should say when the field
 * was worked, and "planned for the 8th" still sitting on the 8th after it was
 * done on the 11th is a diary of intentions rather than of work. The checklist
 * itself still shows both, and the gap between them.
 */
export function checklistCalendarEntries(cells: ChecklistCell[]): ChecklistCalendarEntry[] {
  const labels = new Map(CHECKLIST_STEPS.map((s) => [s.key, s.label]))
  const out: ChecklistCalendarEntry[] = []
  for (const c of cells) {
    const date = c.completedDate ?? c.plannedDate
    if (!date) continue
    out.push({
      date,
      fieldName: c.fieldName,
      step: c.step,
      stepLabel: labels.get(c.step) ?? c.step,
      kind: c.completedDate ? 'done' : 'planned',
    })
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.fieldName.localeCompare(b.fieldName) || a.step.localeCompare(b.step),
  )
}
