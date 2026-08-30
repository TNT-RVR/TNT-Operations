/**
 * Notice a chamber that has gone quiet.
 *
 * Every other hypoxia alert is raised by `hypoxia-ingest.mjs`, on the device's
 * own post. That works for everything the chamber TELLS us and cannot possibly
 * work for silence: a chamber that has stopped reporting is, by definition, not
 * going to report that. Noticing absence needs something on a clock.
 *
 * Its own schedule on purpose, and not folded into the ingest path, for the
 * same reason the incubator watchdog is separate from the poller it watches: a
 * check that lives inside the thing it is checking dies with it.
 *
 * ── Why this one matters more than the incubator equivalent ─────────────────
 *
 * A sealed chamber holding an atmosphere the bees cannot survive outside of is
 * the worst thing to stop hearing from. An incubator going quiet is a data gap;
 * this is a box nobody can see inside, and the only way to find out is to be
 * told.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE.
 */
import { pushOptIns, subscriptionsFor, sendToAll, writeInAppNotification } from './lib/push.mjs'

export const config = {
  // Five minutes. The device posts every ~15 s, so this is about how long a
  // chamber can be quiet before somebody is told, not about precision.
  schedule: '*/5 * * * *',
}

/** Mirrors SILENT_AFTER_MIN in src/domain/hypoxia.ts. */
const SILENT_AFTER_MIN = 10

export default async () => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !KEY) {
    return new Response('hypoxia-watch: not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 501 })
  }
  const sb = { apikey: KEY, Authorization: `Bearer ${KEY}` }

  /*
   * Only chambers that have a key. One without has never been flashed and was
   * never expected to report — telling somebody it is silent would be telling
   * them about a job they have not done yet, every five minutes.
   */
  const chambers = await fetch(
    `${SB_URL}/rest/v1/hypoxia_chambers?select=id,name,last_seen_at&active=is.true&device_key_hash=not.is.null`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))
  if (!Array.isArray(chambers) || chambers.length === 0) {
    return new Response('hypoxia-watch: no chambers to watch', { status: 200 })
  }

  const cutoff = Date.now() - SILENT_AFTER_MIN * 60_000
  const summary = { watched: chambers.length, silent: 0, recovered: 0 }

  for (const c of chambers) {
    const last = c.last_seen_at ? Date.parse(c.last_seen_at) : NaN
    const heard = Number.isFinite(last) && last > cutoff
    const dedupKey = `hypoxia_silent:${c.id}`

    /** The open, unread silence alert for this chamber, if there is one. */
    const open = await fetch(
      `${SB_URL}/rest/v1/app_notifications?select=id&dedup_key=eq.${encodeURIComponent(dedupKey)}` +
        `&read_at=is.null&deleted_at=is.null&limit=1`,
      { headers: sb },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => rows?.[0])

    if (heard) {
      /*
       * Back. Clear the open alert rather than leaving it sitting there: an
       * unread warning about a chamber that is fine again is how people learn
       * to skim past the bell. The all-clear only goes out if somebody was
       * actually told about the silence.
       */
      if (open) {
        await fetch(`${SB_URL}/rest/v1/app_notifications?id=eq.${open.id}`, {
          method: 'PATCH',
          headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ read_at: new Date().toISOString() }),
        })
        await raise(SB_URL, sb, {
          type: 'hypoxia_silent',
          severity: 'info',
          title: `${c.name} is reporting again`,
          body: `Telemetry resumed at ${c.last_seen_at}.`,
          dedupKey: `${dedupKey}:clear`,
        })
        summary.recovered++
      }
      continue
    }

    // Already told, and nobody has read it yet. Saying it again every five
    // minutes is how an alert becomes noise.
    if (open) continue

    await raise(SB_URL, sb, {
      type: 'hypoxia_silent',
      severity: 'critical',
      title: `${c.name} has gone quiet`,
      body: c.last_seen_at
        ? `No telemetry since ${c.last_seen_at}. A sealed chamber that is not reporting cannot be checked from here — the oxygen inside is unknown until somebody looks.`
        : 'This chamber has never reported. Check the board was flashed with its key and is on Wi-Fi.',
      dedupKey,
    })
    summary.silent++
  }

  console.log('[hypoxia-watch]', JSON.stringify(summary))
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function raise(SB_URL, sb, { type, severity, title, body, dedupKey }) {
  try {
    await writeInAppNotification(SB_URL, sb, {
      category: 'incubation',
      type,
      severity,
      title,
      body,
      source: 'hypoxia_watch',
      dedupKey,
    })
    const optIns = await pushOptIns(SB_URL, sb, type)
    if (!optIns.size) return
    const subs = await subscriptionsFor(SB_URL, sb, optIns)
    await sendToAll(SB_URL, sb, subs, { title, body, url: '/incubation/hypoxia', tag: dedupKey })
  } catch {
    /* An alert that cannot be raised must not stop the rest being checked. */
  }
}
