/**
 * Muting an incubator's alerts, for yourself.
 *
 * Incubator MODES are shared — one person switching Incubator 3 to incubation
 * changes it for everyone, because it describes the equipment. Alerts are the
 * opposite: whether you want to be told about an idle incubator whose sensor
 * keeps dropping off is a preference, and one person deciding they have heard
 * enough must not silence the alert for the office.
 *
 * A mute never stops the watching. The check still runs, the alert is still
 * recorded in history, and the incubator's sensor chip still says what the
 * sensor is doing. It stops the message reaching one person.
 */

export interface MutableAlert {
  /** The incubator an alert concerns, when it concerns one. */
  incubatorId?: string | null
}

/**
 * Should this person see this notification?
 *
 * Only alerts ABOUT an incubator can be muted by incubator. Anything else —
 * a task reminder, a QuickBooks failure, a milestone — has no incubator and is
 * never hidden by this, however many incubators are muted.
 */
export function isMutedForMe(alert: MutableAlert, mutedIncubatorIds: ReadonlySet<string>): boolean {
  if (!alert.incubatorId) return false
  return mutedIncubatorIds.has(alert.incubatorId)
}

/** Hide the alerts about incubators this person has muted. Order is kept. */
export function visibleAlerts<T extends MutableAlert>(
  alerts: T[],
  mutedIncubatorIds: ReadonlySet<string>,
): T[] {
  if (mutedIncubatorIds.size === 0) return alerts
  return alerts.filter((a) => !isMutedForMe(a, mutedIncubatorIds))
}

/**
 * How many were hidden — for saying so rather than silently showing less.
 *
 * An inbox that quietly drops entries is indistinguishable from one that is
 * broken, and the person who muted an incubator is exactly the person who
 * should be reminded they did.
 */
export function hiddenCount(alerts: MutableAlert[], mutedIncubatorIds: ReadonlySet<string>): number {
  if (mutedIncubatorIds.size === 0) return 0
  return alerts.filter((a) => isMutedForMe(a, mutedIncubatorIds)).length
}
