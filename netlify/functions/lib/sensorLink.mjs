/**
 * Is the sensor off the network, and for how long?
 *
 * The H5100 reports no battery level — checked against every sensor on
 * 2026-08-14, the only two properties are temperature and humidity. What it
 * does report is whether it is reachable, and since these sensors drop off
 * rather than fade, that flag is the closest thing to a low-battery warning
 * this hardware can give.
 *
 * Kept out of watchdog.mjs so the rule can be tested. A Netlify scheduled
 * function is one of the harder things to exercise, and "when does this wake
 * somebody at 3am" is exactly the kind of question worth pinning down.
 */

/**
 * Minutes since the sensor was last seen on the network.
 *
 * - `0` when it is online, or when nothing is known: both mean "no outage to
 *   report". A missing flag is not evidence of a problem, and treating it as
 *   one would alert on every incubator the moment this shipped.
 * - `Infinity` when it is offline and has never once been seen — a sensor that
 *   has never worked, which is a real state after a bad pairing.
 */
export function offlineMinutes(inc, now = Date.now()) {
  if (inc?.sensor_online !== false) return 0
  if (!inc.sensor_seen_at) return Infinity
  const seen = new Date(inc.sensor_seen_at).getTime()
  if (!Number.isFinite(seen)) return Infinity
  return Math.max(0, (now - seen) / 60_000)
}

/**
 * Long enough to be worth telling someone about?
 *
 * Govee's online flag flickers — a sensor briefly out of range of its gateway
 * is back on the next cycle — so a single offline poll means nothing. An idle
 * incubator gets a longer rope than a running one: a sensor in an empty room
 * over winter drops off for ordinary reasons, and an alert nobody acts on is
 * how people learn to swipe this one away.
 */
export function isOffline(inc, { running, runningMin, idleMin }, now = Date.now()) {
  return offlineMinutes(inc, now) > (running ? runningMin : idleMin)
}
