/**
 * Work that was booked, is not finished, and whose day has passed.
 *
 * A booking used to vanish the morning after its last date. The work did not
 * vanish with it — the field still shows 34 of 48 shelters out — but nothing
 * told anybody to go back, and a half-placed quarter is exactly the thing that
 * gets found in September.
 *
 * There is no "finished" button anywhere and there should not be one: it is
 * state somebody has to remember to press, and it goes stale on the first busy
 * afternoon. The placements already say what is done, so this reads them.
 */

import type { ScheduledJob } from './supplies'

/**
 * How far back to keep looking.
 *
 * Long enough that a job pushed by a week of rain is still in front of people,
 * short enough that a booking nobody ever intends to finish falls off instead
 * of sitting at the top of the screen forever. Anything older is a question
 * for the office, not a job for a crew.
 */
export const OVERDUE_LOOKBACK_DAYS = 14

export interface FieldProgress {
  /** Shelters placed in that field this season. */
  placed: number
  /** Shelters the field's grid calls for. */
  planned: number
}

export interface OverdueJob extends ScheduledJob {
  lastDate: string
  /** Days since the last booked day. Always 1 or more. */
  daysLate: number
  /** Placement progress, when the job is one we can measure. */
  progress: FieldProgress | null
}

/**
 * Is this job demonstrably finished?
 *
 * Only shelter placement can answer honestly: every shelter is a row, so
 * "placed >= planned" is a fact. Tray placement and removal have no such
 * count, and guessing at them would either hide real unfinished work or
 * declare it done on no evidence — so they are treated as unfinished until
 * somebody cancels the booking. Unknowable stays unknown.
 */
export function jobIsComplete(
  task: ScheduledJob['task'],
  progress: FieldProgress | null,
): boolean {
  if (task !== 'shelter') return false
  if (!progress || progress.planned <= 0) return false
  return progress.placed >= progress.planned
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5)

/**
 * The jobs that ran out of days without running out of work.
 *
 * Newest first: a quarter left yesterday is more likely to be picked up than
 * one left a fortnight ago, and the list should read in the order somebody
 * would act on it.
 */
export function overdueJobs(
  jobs: Array<ScheduledJob & { lastDate: string }>,
  today: string,
  progressFor: (fieldId: string) => FieldProgress | null,
): OverdueJob[] {
  const out: OverdueJob[] = []
  for (const j of jobs) {
    // Still running today is not late, however long ago it started.
    if (j.lastDate >= today) continue
    const daysLate = daysBetween(j.lastDate, today)
    if (daysLate < 1 || daysLate > OVERDUE_LOOKBACK_DAYS) continue
    const progress = progressFor(j.fieldId)
    if (jobIsComplete(j.task, progress)) continue
    out.push({ ...j, daysLate, progress })
  }
  return out.sort((a, b) => a.daysLate - b.daysLate || a.title.localeCompare(b.title))
}
