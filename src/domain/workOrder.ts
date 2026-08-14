import type { CrewTask } from './supplies'

/**
 * Work orders — booking a crew onto a field for a day.
 *
 * A work order is not its own table. It is a calendar event that happens to
 * carry a crew, a task and a field: `jobsForCrew` treats exactly those events
 * as jobs and ignores the rest. Keeping one table means a booking shows up on
 * the calendar beside the deliveries and the incubator milestones, which is
 * where somebody looks when they ask "what is happening Thursday".
 *
 * This module is the rules — what a valid booking is, and what to call it —
 * kept out of the form so it can be tested without a browser.
 */

export interface WorkOrderDraft {
  crewId: string
  task: CrewTask | ''
  fieldId: string
  startDate: string
  /** Last day of a multi-day job; blank for a single day. */
  endDate?: string
  /** Optional; a sensible one is generated when left blank. */
  title?: string
  notes?: string
}

export interface WorkOrderInput {
  title: string
  startDate: string
  endDate: string | null
  crewId: string
  task: CrewTask
  fieldId: string
  notes: string
  category: string
  startTime: null
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** What each job is called, everywhere it is shown. */
export const TASK_LABEL: Record<CrewTask, string> = {
  shelter: 'Shelters',
  tray: 'Trays',
  removal: 'Shelter removal',
}

/**
 * The default name for a booking.
 *
 * "Shelters — Bow Island NW" reads at a glance on a calendar grid where the
 * cell is two centimetres wide. The crew is deliberately left out: the card
 * already says whose it is, and repeating it costs the field name.
 */
export function workOrderTitle(task: CrewTask, fieldName: string): string {
  return `${TASK_LABEL[task]} — ${fieldName || 'field'}`
}

/**
 * Check a draft and turn it into something `saveCalendarEvent` accepts.
 *
 * Every field is required except the title, the end date and the notes. A
 * booking missing a crew, a task or a field is not a work order at all — it
 * would save as an ordinary calendar entry and then quietly never appear on
 * anyone's work-order screen, which is worse than refusing it.
 *
 * Errors come back as a list rather than one at a time so the form can mark
 * everything wrong at once instead of making somebody fix it in four rounds.
 */
export function buildWorkOrder(
  draft: WorkOrderDraft,
  fieldName: string,
): { ok: true; input: WorkOrderInput } | { ok: false; errors: string[] } {
  const errors: string[] = []

  if (!draft.crewId) errors.push('Pick a crew.')
  if (!draft.task || !(draft.task in TASK_LABEL)) errors.push('Pick a job.')
  if (!draft.fieldId) errors.push('Pick a field.')

  if (!YMD.test(draft.startDate)) {
    errors.push('Pick a date.')
  } else if (draft.endDate) {
    if (!YMD.test(draft.endDate)) errors.push('The last day is not a date.')
    // An end before the start is almost always a typo in the month. Refusing
    // it beats booking a job that spans no days and shows up nowhere.
    else if (draft.endDate < draft.startDate) errors.push('The last day is before the first day.')
  }

  if (errors.length) return { ok: false, errors }

  const task = draft.task as CrewTask
  return {
    ok: true,
    input: {
      title: draft.title?.trim() || workOrderTitle(task, fieldName),
      startDate: draft.startDate,
      // A one-day job stores null rather than repeating the start date, so
      // that "does this span days" is one comparison everywhere.
      endDate: draft.endDate && draft.endDate > draft.startDate ? draft.endDate : null,
      crewId: draft.crewId,
      task,
      fieldId: draft.fieldId,
      notes: draft.notes?.trim() ?? '',
      category: 'work',
      startTime: null,
    },
  }
}

/**
 * Bookings that already cover this crew on any of these days.
 *
 * Double-booking a crew is not forbidden — a crew can genuinely do shelters in
 * the morning and trays after lunch — but it is worth saying out loud before
 * it is saved, because the usual cause is two people booking the same crew
 * without talking to each other.
 */
export function clashesFor(
  events: Array<{ id: string; crewId?: string | null; startDate: string; endDate?: string | null; title: string }>,
  crewId: string,
  startDate: string,
  endDate: string | null,
): Array<{ id: string; title: string }> {
  if (!crewId || !YMD.test(startDate)) return []
  const last = endDate && endDate > startDate ? endDate : startDate
  return events
    .filter((e) => e.crewId === crewId)
    .filter((e) => {
      const eLast = e.endDate && e.endDate > e.startDate ? e.endDate : e.startDate
      return e.startDate <= last && eLast >= startDate
    })
    .map((e) => ({ id: e.id, title: e.title }))
}
