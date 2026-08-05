/**
 * Daily "what's due today" for incubation milestones — Vapona in/out, earliest
 * cool, expected release, and the rest of the schedule shown on the Calendar.
 *
 * Runs once each morning rather than on the polling cadence: a milestone is a
 * date, not a condition, so re-checking it every 15 minutes buys nothing.
 *
 * Timezone matters here. Milestones are calendar dates and the crew is in
 * Mountain Time, so "today" is resolved in MST — a UTC-based day boundary would
 * announce tomorrow's milestones at 6 pm the previous evening.
 *
 * Mirrors INCUBATION_MILESTONES and incubationStartFor in
 * src/domain/incubation.ts. Keep the two in step.
 */
import {
  pushOptIns,
  subscriptionsFor,
  sendToAll,
  recentlyNotified,
  writeInAppNotification,
} from './lib/push.mjs'

export const config = {
  // 14:00 UTC = 08:00 MDT / 07:00 MST — before the day's work starts.
  schedule: '0 14 * * *',
}

const TZ = 'America/Edmonton'

/** Day-number → label. Must match INCUBATION_MILESTONES. */
const MILESTONES = [
  { day: 1, label: 'Incubation Start' },
  { day: 7, label: 'Vapona In' },
  { day: 13, label: 'Vapona Out' },
  { day: 14, label: 'Earliest We Can Cool' },
  { day: 18, label: '10% Male Emergence' },
  { day: 23, label: 'Expected Release' },
  { day: 37, label: 'Latest Release' },
]

/** Anything that isn't `off` is mid-run. */
const RUNNING_MODES = new Set(['incubation', 'cool_storage', 'holding'])

/** Local calendar date (YYYY-MM-DD) in the crew's timezone. */
const ymd = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })

/** Add whole days to a YYYY-MM-DD without tripping over DST. */
function addDays(startYmd, n) {
  const [y, m, d] = startYmd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

export default async () => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) {
    return new Response('notify-milestones: missing env (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 200 })
  }
  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  const incs = await fetch(`${SB_URL}/rest/v1/incubators?select=id,name,temp_mode,incubation_start`, {
    headers: sb,
  }).then((r) => (r.ok ? r.json() : []))

  // Only incubators actually mid-run. An `off` box with a leftover start date
  // would otherwise announce milestones for a run that isn't happening — the
  // same trap the Calendar had.
  const running = (Array.isArray(incs) ? incs : []).filter((i) => RUNNING_MODES.has(i.temp_mode))
  if (!running.length) return new Response('notify-milestones: no incubators running', { status: 200 })

  const today = ymd()
  const optIns = await pushOptIns(SB_URL, sb, 'milestone').catch(() => new Set())
  const subs = await subscriptionsFor(SB_URL, sb, optIns).catch(() => [])

  let due = 0
  let pushes = 0

  for (const inc of running) {
    let start = (inc.incubation_start ?? '').trim()
    if (start.toLowerCase() === 'none') start = ''
    if (!start) {
      // Fall back to the commonest in-date of this incubator's active trays,
      // matching incubationStartFor.
      const trays = await fetch(
        `${SB_URL}/rest/v1/trays?select=in_date&status=eq.active&incubator_id=eq.${inc.id}&in_date=not.is.null`,
        { headers: sb },
      ).then((r) => (r.ok ? r.json() : []))
      const counts = new Map()
      for (const t of Array.isArray(trays) ? trays : []) {
        const d = String(t.in_date).slice(0, 10)
        counts.set(d, (counts.get(d) ?? 0) + 1)
      }
      let best = null
      let bestN = 0
      for (const [d, n] of counts) {
        // Ties go to the earlier date, so the schedule doesn't wander.
        if (n > bestN || (n === bestN && best !== null && d < best)) {
          best = d
          bestN = n
        }
      }
      start = best ?? ''
    }
    if (!start) continue
    start = start.slice(0, 10)

    for (const m of MILESTONES) {
      // Day N falls on start + (N-1), so day 1 IS the start date.
      if (addDays(start, m.day - 1) !== today) continue
      due++

      const dedupKey = `milestone:${inc.id}:${m.day}:${today}`
      // A milestone is a one-off, so the cooldown only needs to survive a
      // retry or a manual re-run on the same day.
      if (await recentlyNotified(SB_URL, sb, dedupKey, 20 * 60).catch(() => true)) continue

      const title = `${inc.name}: ${m.label}`
      const body = `Day ${m.day} of the run — ${m.label.toLowerCase()} is due today.`

      await fetch(`${SB_URL}/rest/v1/alerts`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          alert_type: 'milestone',
          severity: 'info',
          incubator_id: inc.id,
          message: `${title} (day ${m.day})`,
          dedup_key: dedupKey,
          notified: true,
        }),
      })
      await writeInAppNotification(SB_URL, sb, {
        category: 'incubation',
        type: 'milestone',
        severity: 'info',
        title,
        body,
        source: 'milestone_rules',
        dedupKey,
      })
      const res = await sendToAll(SB_URL, sb, subs, {
        title,
        body,
        url: '/calendar',
        tag: `milestone-${inc.id}-${m.day}`,
      }).catch(() => ({ sent: 0 }))
      pushes += res.sent
    }
  }

  return new Response(
    `notify-milestones: ${running.length} running, ${due} milestone(s) due ${today}, ${pushes} push(es) sent`,
    { status: 200 },
  )
}
