/**
 * Is anything still watching the incubators?
 *
 * The temperature rules only fire when a reading arrives. A dead sensor, a
 * flat battery, a revoked Govee key, a poller crashing on a bad response — all
 * of those look EXACTLY like "everything is fine": no readings, therefore no
 * out-of-range readings, therefore silence.
 *
 * That is not hypothetical here. Nothing in the cloud watched these
 * incubators between 2026-07-23 and 2026-08-05 and nobody knew, because
 * silence is what a healthy system also looks like.
 *
 * So this asks the opposite question: when did each incubator last say
 * ANYTHING? Stale means alert, whatever the last temperature was.
 *
 * REPLACES the `sensor_feed_stale` check that used to live inside
 * poll-govee.mjs, which watched only running incubators and only ever wrote to
 * the bell inbox — nothing reached a phone, and it could not report the one
 * failure that matters most, the poller itself not running.
 *
 * DELIBERATELY A SEPARATE FUNCTION from poll-govee. If the poller throws
 * partway through — on one bad device, say — anything living inside it dies
 * with it, and a health check that stops when the thing it checks stops is
 * decoration. Its own schedule, its own invocation, its own failure.
 *
 * What it still can't catch: Netlify not running scheduled functions at all.
 * Nothing inside the platform can. The external heartbeat that covers that
 * lives in .github/workflows/monitor-heartbeat.yml.
 */

import {
  pushOptIns,
  subscriptionsFor,
  sendToAll,
  recentlyNotified,
  lastAlertAt,
  writeInAppNotification,
} from './lib/push.mjs'
import { offlineMinutes, isOffline } from './lib/sensorLink.mjs'

export const config = {
  // Hourly. The poller runs every 15 minutes for a running incubator, so an
  // hour is four missed cycles — late enough not to cry over one dropped
  // request, early enough to matter for live bees.
  schedule: '17 * * * *',
}

/** Anything that isn't `off` is actively being held at a temperature. */
const RUNNING_MODES = new Set(['incubation', 'cool_storage', 'holding'])

/**
 * How old a reading may get before it means something is wrong.
 *
 * A running incubator polls every 15 minutes; an idle one every 6 hours (see
 * IDLE_HEARTBEAT_H in poll-govee.mjs). Both thresholds sit at roughly four
 * missed cycles so a single failed request never wakes anyone.
 */
const STALE_RUNNING_MIN = 60
const STALE_IDLE_MIN = 24 * 60

/** Don't repeat the same silence every hour. */
const COOLDOWN_MIN = 6 * 60

/**
 * How long a sensor may say it is off the network before that is news.
 *
 * Govee reports `online` per device, and it flickers: a sensor briefly out of
 * range of its gateway comes back on the next cycle. These are long enough to
 * ride that out, and still far quicker than waiting for silence to age into a
 * stale-feed alert — an hour running, a day idle.
 *
 * An idle incubator gets a longer rope on purpose. A sensor sitting in an empty
 * room over winter drops off for all sorts of ordinary reasons, and an alert
 * nobody acts on is how people learn to swipe this one away.
 */
const OFFLINE_RUNNING_MIN = 45
const OFFLINE_IDLE_MIN = 12 * 60

const ALERT_TYPE = 'sensor_offline'

const fmtAge = (min) => {
  if (min < 90) return `${Math.round(min)} minutes`
  const h = min / 60
  if (h < 48) return `${h.toFixed(1)} hours`
  return `${(h / 24).toFixed(1)} days`
}

export default async () => {
  const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!SB_URL || !SB_KEY) {
    return new Response('watchdog: missing env (SUPABASE_URL / SUPABASE_SERVICE_ROLE)', { status: 200 })
  }
  const sb = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

  const incs = await fetch(
    `${SB_URL}/rest/v1/incubators?select=id,name,govee_device_id,govee_sku,temp_mode,temp_alerts_enabled,` +
      `sensor_online,sensor_seen_at,sensor_checked_at`,
    { headers: sb },
  ).then((r) => (r.ok ? r.json() : []))

  // Only incubators with a sensor linked. One without is not "silent", it is
  // simply not instrumented, and alerting on it would train people to ignore
  // this alert — which is the one failure this whole function exists to avoid.
  const watched = (Array.isArray(incs) ? incs : []).filter((i) => i.govee_device_id && i.govee_sku)

  let stale = 0
  let offline = 0
  let recovered = 0
  let pushesSent = 0

  for (const inc of watched) {
    if (inc.temp_alerts_enabled === false) continue

    const running = RUNNING_MODES.has(inc.temp_mode)
    const limitMin = running ? STALE_RUNNING_MIN : STALE_IDLE_MIN

    // ── Off the network ────────────────────────────────────────────────────
    // Govee says the device is not reachable. This is the same failure as a
    // stale feed but named properly and caught sooner: the H5100 has no
    // battery level to read (checked 2026-08-14), and dropping off the network
    // is how a flat one presents.
    const last = await fetch(
      `${SB_URL}/rest/v1/sensor_readings?incubator_id=eq.${inc.id}&select=at&order=at.desc&limit=1`,
      { headers: sb },
    ).then((r) => (r.ok ? r.json() : []))
    const lastReadingAt = Array.isArray(last) && last[0]?.at ? last[0].at : null

    const offlineFor = offlineMinutes(inc, Date.now(), lastReadingAt)
    if (
      isOffline(inc, { running, runningMin: OFFLINE_RUNNING_MIN, idleMin: OFFLINE_IDLE_MIN }, Date.now(), lastReadingAt)
    ) {
      const offKey = `${ALERT_TYPE}_link:${inc.id}`
      const offMsg =
        offlineFor === Infinity
          ? `${inc.name}: the sensor has never been seen on the network. Check it is paired and its battery is good.`
          : `${inc.name}: the sensor has been off the network for ${fmtAge(offlineFor)}. ` +
            `Check its battery and that it is in range of the gateway.`

      const quietOff = await recentlyNotified(SB_URL, sb, offKey, COOLDOWN_MIN)
      await fetch(`${SB_URL}/rest/v1/alerts`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          alert_type: ALERT_TYPE,
          severity: running ? 'critical' : 'warning',
          incubator_id: inc.id,
          message: offMsg,
          dedup_key: offKey,
          notified: !quietOff,
        }),
      })
      offline++

      if (!quietOff) {
        await writeInAppNotification(SB_URL, sb, {
          category: 'incubation',
          type: ALERT_TYPE,
          severity: running ? 'critical' : 'warning',
          title: `${inc.name}: sensor offline`,
          body: offMsg,
          source: 'watchdog',
          dedupKey: offKey,
        })
        const offOptIns = await pushOptIns(SB_URL, sb, ALERT_TYPE)
        const offSubs = await subscriptionsFor(SB_URL, sb, offOptIns)
        const offRes = await sendToAll(SB_URL, sb, offSubs, {
          title: `${inc.name}: sensor offline`,
          body: offMsg,
          url: '/incubation',
          // Same tag as the silence alert: they are one story about one
          // incubator, and two lock-screen entries would be two problems.
          tag: `offline-${inc.id}`,
        }).catch(() => ({ sent: 0 }))
        pushesSent += offRes.sent
      }

      // No stale check on top. The feed IS stale, and saying so twice in
      // different words teaches people the alerts are noise.
      continue
    }

    // Back on the network after having been reported gone.
    if (inc.sensor_online === true) {
      const offKey = `${ALERT_TYPE}_link:${inc.id}`
      const backKey = `${ALERT_TYPE}_link_clear:${inc.id}`
      const wentOff = await lastAlertAt(SB_URL, sb, offKey, { notifiedOnly: true })
      if (wentOff) {
        const cleared = await lastAlertAt(SB_URL, sb, backKey)
        if (!cleared || cleared < wentOff) {
          const backMsg = `${inc.name}: the sensor is back on the network.`
          await fetch(`${SB_URL}/rest/v1/alerts`, {
            method: 'POST',
            headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              alert_type: ALERT_TYPE,
              severity: 'info',
              incubator_id: inc.id,
              message: backMsg,
              dedup_key: backKey,
              notified: true,
            }),
          })
          await writeInAppNotification(SB_URL, sb, {
            category: 'incubation',
            type: ALERT_TYPE,
            severity: 'info',
            title: `${inc.name}: sensor back online`,
            body: backMsg,
            source: 'watchdog',
            dedupKey: backKey,
          })
          const backOptIns = await pushOptIns(SB_URL, sb, ALERT_TYPE)
          const backSubs = await subscriptionsFor(SB_URL, sb, backOptIns)
          const backRes = await sendToAll(SB_URL, sb, backSubs, {
            title: `${inc.name}: sensor back online`,
            body: backMsg,
            url: '/incubation',
            tag: `offline-${inc.id}`,
          }).catch(() => ({ sent: 0 }))
          pushesSent += backRes.sent
          recovered++
        }
      }
    }

    const lastAt = lastReadingAt ? new Date(lastReadingAt).getTime() : null

    const ageMin = lastAt == null ? Infinity : (Date.now() - lastAt) / 60_000
    const isStale = ageMin > limitMin
    const dedupKey = `${ALERT_TYPE}:${inc.id}`
    const clearKey = `${ALERT_TYPE}_clear:${inc.id}`

    if (!isStale) {
      // All-clear, but only if someone was actually told it went quiet.
      const problemAt = await lastAlertAt(SB_URL, sb, dedupKey, { notifiedOnly: true })
      if (!problemAt) continue
      const clearedAt = await lastAlertAt(SB_URL, sb, clearKey)
      if (clearedAt && clearedAt >= problemAt) continue

      const okMsg = `${inc.name}: readings are arriving again.`
      await fetch(`${SB_URL}/rest/v1/alerts`, {
        method: 'POST',
        headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          alert_type: ALERT_TYPE,
          severity: 'info',
          incubator_id: inc.id,
          message: okMsg,
          dedup_key: clearKey,
          notified: true,
        }),
      })
      await writeInAppNotification(SB_URL, sb, {
        category: 'incubation',
        type: ALERT_TYPE,
        severity: 'info',
        title: `${inc.name} is reporting again`,
        body: okMsg,
        source: 'watchdog',
        dedupKey: clearKey,
      })
      const optIns = await pushOptIns(SB_URL, sb, ALERT_TYPE)
      const subs = await subscriptionsFor(SB_URL, sb, optIns)
      const res = await sendToAll(SB_URL, sb, subs, {
        title: `${inc.name} reporting again`,
        body: okMsg,
        url: '/incubation',
        tag: `offline-${inc.id}`,
      }).catch(() => ({ sent: 0 }))
      pushesSent += res.sent
      recovered++
      continue
    }

    stale++
    const message =
      lastAt == null
        ? `${inc.name}: no sensor readings have ever arrived. Check the Govee device id and the API key.`
        : `${inc.name}: no sensor reading for ${fmtAge(ageMin)}. ` +
          `The temperature is NOT being watched — check the sensor, its battery, and the poller.`

    const quiet = await recentlyNotified(SB_URL, sb, dedupKey, COOLDOWN_MIN)
    await fetch(`${SB_URL}/rest/v1/alerts`, {
      method: 'POST',
      headers: { ...sb, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        alert_type: ALERT_TYPE,
        // Critical while a run is on: nobody is watching live bees.
        severity: running ? 'critical' : 'warning',
        incubator_id: inc.id,
        message,
        dedup_key: dedupKey,
        notified: !quiet,
      }),
    })
    if (quiet) continue

    await writeInAppNotification(SB_URL, sb, {
      category: 'incubation',
      type: ALERT_TYPE,
      severity: running ? 'critical' : 'warning',
      title: `${inc.name} has gone quiet`,
      body: message,
      source: 'watchdog',
      dedupKey,
    })
    const optIns = await pushOptIns(SB_URL, sb, ALERT_TYPE)
    const subs = await subscriptionsFor(SB_URL, sb, optIns)
    const res = await sendToAll(SB_URL, sb, subs, {
      title: `${inc.name} has gone quiet`,
      body: message,
      url: '/incubation',
      tag: `offline-${inc.id}`,
    }).catch(() => ({ sent: 0 }))
    pushesSent += res.sent
  }

  const summary =
    `[watchdog] ${watched.length} watched, ${offline} offline, ${stale} stale, ` +
    `${recovered} recovered, ${pushesSent} pushes`
  console.info(summary)
  return new Response(summary, { status: 200 })
}
