/**
 * Web-push delivery, shared by the alert producers (poll-govee, notify-milestones).
 *
 * Requires three Netlify env vars:
 *   VAPID_PUBLIC_KEY   — same key the browser subscribes with (VITE_VAPID_PUBLIC_KEY)
 *   VAPID_PRIVATE_KEY  — secret; signs the pushes
 *   VAPID_SUBJECT      — a mailto: or https: URL identifying the sender
 *
 * Every function here is defensive about push being unconfigured: alerting must
 * keep working (and keep logging to the DB) even when nobody has set up VAPID.
 */
import webpush from 'web-push'

let configured = null

/** True once VAPID is usable. Logged loudly once, then cached. */
export function pushConfigured() {
  if (configured !== null) return configured
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) {
    console.warn('[push] VAPID not configured — alerts will be logged but not pushed')
    configured = false
    return false
  }
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

/**
 * Users who want `type` on push, as a Set of user_id.
 *
 * Missing preference row = the app-wide default, which is push OFF. Push is
 * interruptive, so it is strictly opt-in — never assume consent from silence.
 */
export async function pushOptIns(SB_URL, sb, type) {
  const rows = await fetch(
    `${SB_URL}/rest/v1/app_notification_prefs?select=user_id,push&type=eq.${encodeURIComponent(type)}&push=is.true`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  return new Set((Array.isArray(rows) ? rows : []).map((r) => r.user_id))
}

/** Live subscriptions for a set of users. Expired endpoints are excluded. */
export async function subscriptionsFor(SB_URL, sb, userIds) {
  if (!userIds.size) return []
  const list = [...userIds].map((id) => `"${id}"`).join(',')
  const rows = await fetch(
    `${SB_URL}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth&expired_at=is.null&user_id=in.(${list})`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  return Array.isArray(rows) ? rows : []
}

/**
 * Send one payload to many subscriptions.
 *
 * A 404/410 means the browser threw the subscription away, so the row is marked
 * expired and stops being tried. Any other failure is left alone — a push
 * service having a bad minute must not unsubscribe someone permanently.
 *
 * Returns { sent, failed, expired }.
 */
export async function sendToAll(SB_URL, sb, subs, payload) {
  if (!subs.length || !pushConfigured()) return { sent: 0, failed: 0, expired: 0 }
  const body = JSON.stringify(payload)
  let sent = 0
  let failed = 0
  const expired = []

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 3600 }, // an hour-old incubator alert is still worth seeing
        )
        sent++
      } catch (err) {
        const code = err?.statusCode
        if (code === 404 || code === 410) expired.push(s.id)
        else {
          failed++
          console.warn(`[push] send failed (${code ?? 'no status'}):`, err?.body ?? err?.message ?? err)
        }
      }
    }),
  )

  if (expired.length) {
    const list = expired.map((id) => `"${id}"`).join(',')
    await fetch(`${SB_URL}/rest/v1/push_subscriptions?id=in.(${list})`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ expired_at: new Date().toISOString() }),
    })
  }

  if (sent) {
    const ids = subs.map((s) => `"${s.id}"`).join(',')
    await fetch(`${SB_URL}/rest/v1/push_subscriptions?id=in.(${ids})`, {
      method: 'PATCH',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
    })
  }

  return { sent, failed, expired: expired.length }
}

/**
 * Whether this condition was already pushed recently.
 *
 * The poller runs every 15 minutes and an out-of-band incubator stays out of
 * band, so without this the same alert would fire four times an hour until
 * someone fixed it — which trains people to ignore alerts.
 */
export async function recentlyNotified(SB_URL, sb, dedupKey, cooldownMin) {
  const since = new Date(Date.now() - cooldownMin * 60_000).toISOString()
  const rows = await fetch(
    `${SB_URL}/rest/v1/alerts?select=id&notified=is.true` +
      `&dedup_key=eq.${encodeURIComponent(dedupKey)}&triggered_at=gte.${since}&limit=1`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  return Array.isArray(rows) && rows.length > 0
}

/**
 * When this dedup key last fired, as an ISO string, or null.
 *
 * `notifiedOnly` restricts it to occurrences that actually reached someone —
 * which is what an all-clear needs, since clearing an alert nobody was told
 * about is just noise.
 */
export async function lastAlertAt(SB_URL, sb, dedupKey, { notifiedOnly = false } = {}) {
  const rows = await fetch(
    `${SB_URL}/rest/v1/alerts?select=triggered_at&dedup_key=eq.${encodeURIComponent(dedupKey)}` +
      `${notifiedOnly ? '&notified=is.true' : ''}&order=triggered_at.desc&limit=1`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  return Array.isArray(rows) && rows[0]?.triggered_at ? rows[0].triggered_at : null
}

/**
 * Also drop it in the in-app bell inbox, for everyone, regardless of push.
 * Push is a nudge; the inbox is the record, so it's written either way.
 */
export async function writeInAppNotification(
  SB_URL,
  sb,
  { category, type, severity, title, body, source, dedupKey },
) {
  await fetch(`${SB_URL}/rest/v1/app_notifications`, {
    method: 'POST',
    headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      category: category ?? 'incubation',
      type,
      severity: severity ?? 'warning',
      title,
      body,
      source: source ?? 'alert_rules',
      ...(dedupKey ? { dedup_key: dedupKey } : {}),
    }),
  })
}
