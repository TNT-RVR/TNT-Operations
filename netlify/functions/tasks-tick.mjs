/**
 * Nightly task tick.
 *
 * Two jobs, both of which have to happen server-side because nobody may open
 * the app on the day they matter:
 *
 *   1. Materialize schedule-anchored recurring tasks whose next occurrence is
 *      now due. (Completion-anchored ones are created by the app when the work
 *      is ticked off — there is nothing for a clock to do until then.)
 *   2. Raise `task_due_soon` and `task_overdue` notifications.
 *
 * ── Every notification fires ONCE ────────────────────────────────────────────
 *
 * `notified_due_soon_at` / `notified_overdue_at` are stamped when each alert is
 * raised, and the query skips anything already stamped. Without that, a task
 * left overdue for a fortnight raises fourteen identical notifications and the
 * bell becomes something people swipe away without reading — at which point it
 * stops working for the incubator alerts that actually matter.
 *
 * Env (Netlify): SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE.
 */

/** Runs at 13:00 UTC — 06:00 in Edmonton, before anyone starts. */
export const config = {
  schedule: '0 13 * * *',
}

const TZ = 'America/Edmonton'

/** Today's calendar date in Alberta. Due dates are dates, not instants. */
function todayInTz(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

const pad = (n) => String(n).padStart(2, '0')
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

function parts(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '')
  return m ? { y: +m[1], m: +m[2], day: +m[3] } : null
}

function addDays(d, n) {
  const p = parts(d)
  if (!p) return null
  const t = new Date(Date.UTC(p.y, p.m - 1, p.day + n))
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Clamped: Jan 31 + 1 month is Feb 28, not Mar 3. Mirrors src/domain/tasks.ts. */
function addMonths(d, n) {
  const p = parts(d)
  if (!p) return null
  const total = p.y * 12 + (p.m - 1) + n
  const y = Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12 + 1
  return isoDate(y, m, Math.min(p.day, daysInMonth(y, m)))
}

function weekdayOf(d) {
  const p = parts(d)
  if (!p) return null
  return new Date(Date.UTC(p.y, p.m - 1, p.day)).getUTCDay()
}

/**
 * The next due date after `from`. A JS mirror of `nextDueDate` in
 * src/domain/tasks.ts — kept in step by the tests over there, since a Netlify
 * function can't import from src/.
 */
function nextDueDate(task, from) {
  const every = Math.max(1, Math.floor(task.recur_interval || 1))
  let next = null

  switch (task.recur_unit) {
    case 'daily':
      next = addDays(from, every)
      break
    case 'weekly': {
      const days = [...new Set(task.recur_weekdays ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
      if (days.length === 0) {
        next = addDays(from, every * 7)
      } else {
        const cur = weekdayOf(from)
        if (cur == null) return null
        const later = days.find((d) => d > cur)
        next = later != null ? addDays(from, later - cur) : addDays(from, every * 7 - cur + days[0])
      }
      break
    }
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
  if (task.recur_until && next > task.recur_until) return null
  return next
}

export default async () => {
  const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!URL_ || !KEY) {
    return new Response('Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 501 })
  }

  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
  const api = (path) => `${URL_}/rest/v1/${path}`
  const today = todayInTz()

  const get = async (path) => {
    const r = await fetch(api(path), { headers: H })
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`)
    return r.json()
  }
  const patch = (path, body) =>
    fetch(api(path), { method: 'PATCH', headers: H, body: JSON.stringify(body) })
  const post = (path, body) =>
    fetch(api(path), { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) })

  const summary = { created: 0, dueSoon: 0, overdue: 0, errors: [] }

  // ── 1. Materialize schedule-anchored recurrences ──
  try {
    // Only rows that are the newest in their series and already past due; a
    // series whose latest occurrence is still in the future needs nothing.
    const recurring = await get(
      'app_tasks?recur_unit=not.is.null&recur_anchor=eq.schedule&select=*&order=due_date.asc&limit=500',
    )

    // The newest occurrence per series. `recur_parent_id ?? id` is the series key.
    const newest = new Map()
    for (const t of recurring) {
      const key = t.recur_parent_id ?? t.id
      const cur = newest.get(key)
      if (!cur || (t.due_date ?? '') > (cur.due_date ?? '')) newest.set(key, t)
    }

    for (const [key, head] of newest) {
      if (!head.due_date || head.due_date > today) continue

      let cursor = head.due_date
      // Cap the catch-up: a daily task untouched for a year must not create
      // 365 rows in one pass and bury everything else in the list.
      for (let i = 0; i < 30; i++) {
        const due = nextDueDate(head, cursor)
        if (!due || due > today) break
        cursor = due

        // Dedupe on (series, due date) — the app may already have created this
        // one when somebody ticked the previous occurrence off.
        const existing = await get(
          `app_tasks?select=id&due_date=eq.${due}&or=(id.eq.${key},recur_parent_id.eq.${key})&limit=1`,
        )
        if (existing.length > 0) continue

        const created = await post('app_tasks', {
          title: head.title,
          notes: head.notes,
          checklist_id: head.checklist_id,
          assignee_id: head.assignee_id,
          created_by: head.created_by,
          due_date: due,
          priority: head.priority,
          recur_unit: head.recur_unit,
          recur_interval: head.recur_interval,
          recur_anchor: head.recur_anchor,
          recur_weekdays: head.recur_weekdays,
          recur_until: head.recur_until,
          recur_parent_id: key,
          remind_days_before: head.remind_days_before,
        })
        if (!created.ok) {
          summary.errors.push(`create ${head.title} @ ${due}: ${await created.text()}`)
          continue
        }
        const [row] = await created.json()
        summary.created++

        // Copy the step list so a recurring checklist arrives ready to work.
        const steps = await get(`app_task_steps?task_id=eq.${head.id}&select=*&order=sort.asc`)
        if (steps.length > 0) {
          await post(
            'app_task_steps',
            steps.map((s, i) => ({
              task_id: row.id,
              title: s.title,
              notes: s.notes,
              sort: i,
              required: s.required,
              assignee_id: s.assignee_id,
              source_step_id: s.source_step_id,
            })),
          )
        }
      }
    }
  } catch (e) {
    summary.errors.push(`recurrence: ${e.message}`)
  }

  // ── 2. Due-soon notifications ──
  try {
    const soon = await get(
      `app_tasks?status=in.(open,in_progress)&due_date=not.is.null&due_date=gte.${today}` +
        `&notified_due_soon_at=is.null&select=id,title,due_date,remind_days_before,assignee_id&limit=200`,
    )
    for (const t of soon) {
      const lead = Number(t.remind_days_before ?? 1)
      const threshold = addDays(today, lead)
      if (!threshold || t.due_date > threshold) continue

      await post('app_notifications', {
        category: 'tasks',
        type: 'task_due_soon',
        severity: 'info',
        title: `Due ${t.due_date === today ? 'today' : `on ${t.due_date}`}: ${t.title}`,
        body: '',
        source: 'tasks',
      })
      await patch(`app_tasks?id=eq.${t.id}`, { notified_due_soon_at: new Date().toISOString() })
      summary.dueSoon++
    }
  } catch (e) {
    summary.errors.push(`due-soon: ${e.message}`)
  }

  // ── 3. Overdue notifications ──
  try {
    const late = await get(
      `app_tasks?status=in.(open,in_progress)&due_date=lt.${today}` +
        `&notified_overdue_at=is.null&select=id,title,due_date&limit=200`,
    )
    for (const t of late) {
      await post('app_notifications', {
        category: 'tasks',
        type: 'task_overdue',
        severity: 'warning',
        title: `Overdue: ${t.title}`,
        body: `Was due ${t.due_date}`,
        source: 'tasks',
      })
      await patch(`app_tasks?id=eq.${t.id}`, { notified_overdue_at: new Date().toISOString() })
      summary.overdue++
    }
  } catch (e) {
    summary.errors.push(`overdue: ${e.message}`)
  }

  console.log('[tasks-tick]', JSON.stringify(summary))
  return new Response(JSON.stringify(summary), {
    status: summary.errors.length ? 207 : 200,
    headers: { 'content-type': 'application/json' },
  })
}
