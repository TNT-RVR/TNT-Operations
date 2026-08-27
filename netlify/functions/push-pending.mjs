/**
 * Deliver any notification that nobody pushed.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Push delivery lived entirely in the alert PRODUCERS: poll-govee, watchdog,
 * notify-milestones and tasks-tick each write their inbox row and then send to
 * whoever opted in. That covers every alert raised by a Netlify function, and
 * it is instant.
 *
 * Two alerts are not raised by a function at all. `qbo_sync_failed` and
 * `qbo_auth_expired` come from TRIGGERS inside the database (migration 0017),
 * where there is no sender to call. The rows landed in the bell and nothing
 * ever reached a phone, whatever the preference said — seven of them in three
 * weeks, silently. Turning the preference on would have changed nothing, which
 * is the worst kind of broken: a switch that appears to work.
 *
 * The obvious fix is to teach the trigger to make the HTTP call, which is what
 * pg_net is for. It needs a shared secret stored INSIDE the database for the
 * function to trust the call, and a migration in this repo cannot safely carry
 * one. So instead this sweeps: anything still unpushed gets pushed here.
 *
 * ── What that buys, beyond QuickBooks ────────────────────────────────────────
 *
 * Delivery stops being something a producer has to remember. Any row, from any
 * path — a trigger, a function, a person inserting one by hand — is picked up.
 * A new alert type needs a row and a preference, and nothing else. The cost is
 * latency of a few minutes, which for "your QuickBooks token expired" is no
 * cost at all; anything that genuinely needs to be instant still pushes from
 * its producer and is already stamped by the time this runs.
 *
 * `pushed_at` means "delivery has been dealt with", NOT "a push was sent". A
 * row with nobody opted in is stamped too — it has been considered, and there
 * is nothing more to do with it.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, plus the VAPID trio for delivery.
 */
import { pushOptIns, subscriptionsFor, sendToAll } from './lib/push.mjs'

export const config = {
  // Five minutes. The producers cover anything urgent, so this is the floor on
  // how late a database-raised alert can be — not on how late any alert can be.
  schedule: '*/5 * * * *',
}

/**
 * How far back to look.
 *
 * A cap, not a cursor: if this function has been down for a day, the crew does
 * not want the whole day arriving at once the moment it comes back. Anything
 * older is stamped without sending — it is in the bell, where an alert from
 * yesterday belongs.
 */
const WINDOW_HOURS = 6

/** Where tapping the banner should land, by the notification's own category. */
const URL_BY_CATEGORY = {
  quickbooks: '/users/integrations/quickbooks',
  tasks: '/tasks',
  incubation: '/incubation',
  maps: '/maps',
  grants: '/grants',
}

export default async () => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) {
    return new Response('Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 501 })
  }
  const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString()
  const rows = await fetch(
    `${SB_URL}/rest/v1/app_notifications` +
      `?select=id,category,type,severity,title,body,created_at` +
      `&pushed_at=is.null&deleted_at=is.null&order=created_at.asc&limit=100`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))

  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response('push-pending: nothing waiting', { status: 200 })
  }

  const stamp = async (ids) => {
    if (!ids.length) return
    const list = ids.map((id) => `"${id}"`).join(',')
    await fetch(`${SB_URL}/rest/v1/app_notifications?id=in.(${list})`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ pushed_at: new Date().toISOString() }),
    })
  }

  const stale = rows.filter((r) => r.created_at < since).map((r) => r.id)
  const fresh = rows.filter((r) => r.created_at >= since)
  await stamp(stale)

  /*
   * One opt-in lookup per TYPE rather than per row. A failed sync can raise
   * several rows in a cycle, and asking the same question five times is five
   * round trips for one answer.
   */
  const byType = new Map()
  for (const r of fresh) {
    if (!byType.has(r.type)) byType.set(r.type, [])
    byType.get(r.type).push(r)
  }

  let sent = 0
  const handled = []

  for (const [type, group] of byType) {
    let subs = []
    try {
      const optIns = await pushOptIns(SB_URL, sb, type)
      subs = optIns.size ? await subscriptionsFor(SB_URL, sb, optIns) : []
    } catch (e) {
      // Leave the group unstamped so the next run tries again — a lookup that
      // failed is not the same as an alert nobody wanted.
      console.warn(`[push-pending] opt-in lookup failed for ${type}:`, e?.message ?? e)
      continue
    }

    for (const r of group) {
      if (subs.length) {
        const res = await sendToAll(SB_URL, sb, subs, {
          title: r.title,
          body: r.body || '',
          url: URL_BY_CATEGORY[r.category] ?? '/notifications',
          // One tag per type: a second sync failure replaces the first on the
          // lock screen rather than stacking under it.
          tag: `tnt-${r.type}`,
          requireInteraction: r.severity === 'critical',
        }).catch(() => ({ sent: 0 }))
        sent += res.sent
      }
      // Stamped either way. Nobody opted in is an answer, not a retry.
      handled.push(r.id)
    }
  }

  await stamp(handled)

  const summary = `push-pending: ${handled.length} handled, ${sent} push(es), ${stale.length} too old to send`
  console.log(`[push-pending] ${summary}`)
  return new Response(summary, { status: 200 })
}
