/**
 * One alert per problem, not one per hour.
 *
 * Alerts used to repeat on a COOLDOWN: while a problem continued, it was sent
 * again every six hours (sensor offline) or every two (temperature). A sensor
 * dead for two days therefore pinged about eight times — each one telling
 * somebody what they already knew, which is how people learn to swipe alerts
 * away unread.
 *
 * Now a problem is an EPISODE. It is announced when it starts, stays silent
 * while it continues, and ends with the all-clear. The next time it happens is
 * a new episode and is announced again.
 *
 * Every check still LOGS a row while the problem holds — that is the history,
 * and it is also what this reads to know the problem was still there last
 * time. Only the notification is once per episode.
 */

/**
 * Should this occurrence be sent, or is it one already announced?
 *
 * Quiet only when ALL three hold:
 *   1. somebody was already told about this problem, and
 *   2. no all-clear has been recorded since, and
 *   3. the problem was logged on the previous check too (within `gapMin`).
 *
 * The third is the safety catch. An episode can end without an all-clear
 * being written — the temperature all-clear deliberately skips problems older
 * than a day, and a function can fail between noticing recovery and recording
 * it. Relying on clears alone would leave that episode "open" forever and
 * silence every future problem on that incubator. A gap in the log means the
 * problem stopped, so whatever comes next is new and is announced.
 *
 * Timestamps are ISO strings or null. `now` is ms since epoch.
 */
export function shouldNotify({ lastNotifiedAt, lastClearAt, lastProblemAt, now, gapMin }) {
  // Never told anyone: this is the start of an episode.
  if (!lastNotifiedAt) return true

  const notified = Date.parse(lastNotifiedAt)
  // Recovered since the last announcement: this is a new episode.
  if (lastClearAt && Date.parse(lastClearAt) >= notified) return true

  // Not seen on the previous check: it stopped, so this is a new episode —
  // whether or not an all-clear happened to be recorded.
  if (!lastProblemAt) return true
  if (now - Date.parse(lastProblemAt) > gapMin * 60_000) return true

  // Told, not cleared, still ongoing: the same episode. Stay quiet.
  return false
}
