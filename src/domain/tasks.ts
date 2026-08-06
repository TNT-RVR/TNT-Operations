/**
 * Task scheduling: recurrence, due status, progress. Pure functions — no React,
 * no DB.
 *
 * ── Dates here are CALENDAR DATES, not instants ──────────────────────────────
 *
 * A task due "August 10" is due all of August 10 in Alberta, and it does not
 * become overdue at 6pm on the 9th because a UTC timestamp said so. So due
 * dates are stored and compared as `YYYY-MM-DD` strings, and "today" is
 * whatever today is in `America/Edmonton` — see `todayInTz`.
 *
 * This is a deliberate exception to the app-wide "times stored UTC" rule, which
 * governs *instants* (a sensor reading, an inspection). A due date is not an
 * instant. Storing it as a timestamp is how you get tasks that go red overnight
 * for people in the wrong timezone.
 *
 * ── Two ways to recur, and they are genuinely different jobs ─────────────────
 *
 *   anchor: 'schedule'    the next occurrence is due one interval after the
 *                         LAST DUE DATE. "Every Monday" stays every Monday even
 *                         if last week's slipped.
 *   anchor: 'completion'  the next occurrence is due one interval after it was
 *                         actually FINISHED. "Service every 90 days" means 90
 *                         days from the last service, not from when it was
 *                         theoretically due.
 *
 * Picking one for everything makes half of them wrong, so each task chooses.
 */

export const TZ = 'America/Edmonton'

// ═══════════════════════════════════════════════════════════════════════════
// Calendar-date helpers
// ═══════════════════════════════════════════════════════════════════════════

/** A calendar date as `YYYY-MM-DD`. */
export type DateOnly = string

/** Today's calendar date in `tz` — not the machine's local date, nor UTC's. */
export function todayInTz(now: Date = new Date(), tz: string = TZ): DateOnly {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Split `YYYY-MM-DD` into numbers. Returns null for anything malformed. */
function parts(d: DateOnly): { y: number; m: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const day = Number(m[3])
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null
  return { y, m: mo, day }
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number): DateOnly => `${y}-${pad(m)}-${pad(d)}`

/** Days in a month, honouring leap years. */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** Whole days from `a` to `b`; negative when `b` is earlier. Null if unparseable. */
export function daysBetween(a: DateOnly, b: DateOnly): number | null {
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return null
  const ua = Date.UTC(pa.y, pa.m - 1, pa.day)
  const ub = Date.UTC(pb.y, pb.m - 1, pb.day)
  return Math.round((ub - ua) / 86_400_000)
}

/** `d` shifted by `n` days. Null if `d` is unparseable. */
export function addDays(d: DateOnly, n: number): DateOnly | null {
  const p = parts(d)
  if (!p) return null
  const t = new Date(Date.UTC(p.y, p.m - 1, p.day + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/**
 * `d` shifted by `n` months, CLAMPED to the end of the target month.
 *
 * Jan 31 + 1 month is Feb 28 (or 29), not March 3. JavaScript's Date rolls the
 * overflow forward, which turns a monthly task into one that drifts later every
 * short month until it falls off the calendar.
 */
export function addMonths(d: DateOnly, n: number): DateOnly | null {
  const p = parts(d)
  if (!p) return null
  const total = (p.y * 12 + (p.m - 1)) + n
  const y = Math.floor(total / 12)
  const m = (total % 12 + 12) % 12 + 1
  return iso(y, m, Math.min(p.day, daysInMonth(y, m)))
}

/** Day of week for a calendar date: 0 = Sunday. Null if unparseable. */
export function weekdayOf(d: DateOnly): number | null {
  const p = parts(d)
  if (!p) return null
  return new Date(Date.UTC(p.y, p.m - 1, p.day)).getUTCDay()
}

// ═══════════════════════════════════════════════════════════════════════════
// Recurrence
// ═══════════════════════════════════════════════════════════════════════════

export type RecurUnit = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurAnchor = 'schedule' | 'completion'

export interface RecurRule {
  unit: RecurUnit
  /** Every N units. 2 + 'weekly' is fortnightly. Must be ≥ 1. */
  interval: number
  /** Which anchor the next due date counts from. */
  anchor: RecurAnchor
  /**
   * For `weekly` only: which days it lands on, 0 = Sunday.
   * Empty means "the same weekday as the current due date".
   */
  weekdays?: number[]
  /** Stop recurring after this date, inclusive. */
  until?: DateOnly | null
}

/**
 * The next due date after `from`, or null when the rule has run out.
 *
 * `from` is the last due date for a schedule-anchored rule, and the completion
 * date for a completion-anchored one — the caller picks which, because only it
 * knows what happened.
 */
export function nextDueDate(rule: RecurRule, from: DateOnly): DateOnly | null {
  if (!parts(from)) return null
  const every = Math.max(1, Math.floor(rule.interval || 1))

  let next: DateOnly | null
  switch (rule.unit) {
    case 'daily':
      next = addDays(from, every)
      break
    case 'weekly':
      next = nextWeekly(rule, from, every)
      break
    case 'monthly':
      next = addMonths(from, every)
      break
    case 'yearly':
      next = addMonths(from, every * 12)
      break
    default:
      return null
  }

  if (!next) return null
  if (rule.until && next > rule.until) return null
  return next
}

/**
 * Weekly, honouring a set of weekdays.
 *
 * With weekdays given, this walks to the next selected day — so a
 * Monday/Wednesday/Friday task steps Mon→Wed→Fri→Mon rather than jumping a
 * whole week each time. The interval applies when wrapping to a new week.
 */
function nextWeekly(rule: RecurRule, from: DateOnly, every: number): DateOnly | null {
  const days = [...new Set(rule.weekdays ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (days.length === 0) return addDays(from, every * 7)

  const cur = weekdayOf(from)
  if (cur == null) return null

  const later = days.find((d) => d > cur)
  if (later != null) return addDays(from, later - cur)

  // Past the last selected day this week — wrap to the first one, `every`
  // weeks on. The −cur+days[0] lands on that weekday.
  return addDays(from, every * 7 - cur + days[0])
}

/**
 * Every due date a schedule-anchored rule should have produced by `through`,
 * starting after `lastDue`.
 *
 * Used by the nightly tick to materialize occurrences. Capped at `limit` so a
 * daily task that hasn't been touched in three years can't create a thousand
 * rows in one pass.
 */
export function occurrencesThrough(
  rule: RecurRule,
  lastDue: DateOnly,
  through: DateOnly,
  limit = 60,
): DateOnly[] {
  const out: DateOnly[] = []
  let cursor = lastDue
  for (let i = 0; i < limit; i++) {
    const next = nextDueDate(rule, cursor)
    if (!next || next > through) break
    out.push(next)
    cursor = next
  }
  return out
}

/** Human summary of a rule, for the task list. */
export function describeRecurrence(rule: RecurRule): string {
  const n = Math.max(1, Math.floor(rule.interval || 1))
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  let base: string
  if (rule.unit === 'weekly' && rule.weekdays?.length) {
    const names = [...rule.weekdays].sort((a, b) => a - b).map((d) => DAY[d])
    base = n === 1 ? `Every ${names.join(', ')}` : `Every ${n} weeks on ${names.join(', ')}`
  } else {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.unit]
    base = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`
  }
  if (rule.anchor === 'completion') base += ', after completion'
  if (rule.until) base += ` until ${rule.until}`
  return base
}

// ═══════════════════════════════════════════════════════════════════════════
// Status
// ═══════════════════════════════════════════════════════════════════════════

export type DueStatus = 'done' | 'overdue' | 'due-today' | 'due-soon' | 'upcoming' | 'no-date'

export interface DueInput {
  dueDate: DateOnly | null
  completedAt: string | null
  /** How many days ahead counts as "due soon". */
  remindDaysBefore?: number
}

/**
 * Where a task sits relative to today.
 *
 * Completion wins over everything: a task finished late is `done`, not
 * `overdue`. A list that keeps shouting about work already finished trains
 * people to ignore it.
 */
export function dueStatus(t: DueInput, today: DateOnly = todayInTz()): DueStatus {
  if (t.completedAt) return 'done'
  if (!t.dueDate) return 'no-date'
  const delta = daysBetween(today, t.dueDate)
  if (delta == null) return 'no-date'
  if (delta < 0) return 'overdue'
  if (delta === 0) return 'due-today'
  if (delta <= (t.remindDaysBefore ?? 1)) return 'due-soon'
  return 'upcoming'
}

/** Sort key: the most urgent first, undated last, completed at the bottom. */
export const DUE_ORDER: Record<DueStatus, number> = {
  overdue: 0,
  'due-today': 1,
  'due-soon': 2,
  upcoming: 3,
  'no-date': 4,
  done: 5,
}

/** How overdue, in days. 0 when not overdue. */
export function daysOverdue(t: DueInput, today: DateOnly = todayInTz()): number {
  if (t.completedAt || !t.dueDate) return 0
  const delta = daysBetween(today, t.dueDate)
  return delta != null && delta < 0 ? -delta : 0
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress
// ═══════════════════════════════════════════════════════════════════════════

export interface StepLike {
  completedAt: string | null
}

export interface Progress {
  total: number
  done: number
  /** 0–1, or null when there are no steps (so the UI shows nothing, not 0%). */
  fraction: number | null
  complete: boolean
}

/**
 * Progress across a checklist's steps.
 *
 * An empty checklist reports `fraction: null` and `complete: false` rather than
 * 100% — "0 of 0 done" is not an accomplishment, and showing a full bar for a
 * template nobody has filled in is actively misleading.
 */
export function stepProgress(steps: readonly StepLike[]): Progress {
  const total = steps.length
  const done = steps.filter((s) => s.completedAt).length
  return {
    total,
    done,
    fraction: total === 0 ? null : done / total,
    complete: total > 0 && done === total,
  }
}
