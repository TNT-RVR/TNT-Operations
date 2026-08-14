/**
 * How to show the state of an incubator's sensor link.
 *
 * The H5100 reports no battery level — the only two properties are temperature
 * and humidity — so "is it still on the network" is the whole health signal
 * available. These sensors stop answering rather than fading, which makes that
 * flag the earliest warning of a flat battery there is.
 *
 * The watchdog decides when to wake somebody (netlify/functions/lib/
 * sensorLink.mjs); this decides what the screen says, which is a different
 * question — a chip costs nobody their sleep, so it shows the truth as soon as
 * it changes rather than waiting out the flicker.
 */

export interface SensorLinkFields {
  goveeLinked?: boolean
  sensorOnline?: boolean | null
  sensorSeenAt?: string | null
  sensorCheckedAt?: string | null
}

export type LinkState = 'none' | 'unknown' | 'online' | 'offline'

export interface LinkChip {
  state: LinkState
  label: string
  /** Longer text for a tooltip — when it was last seen, or last looked at. */
  detail: string | null
  tone: 'green' | 'red' | 'neutral'
}

const ago = (from: string, now: number): string => {
  const min = (now - new Date(from).getTime()) / 60_000
  if (!Number.isFinite(min) || min < 0) return 'just now'
  if (min < 90) return `${Math.round(min)} min ago`
  const h = min / 60
  if (h < 48) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

/**
 * What to put on the incubator card.
 *
 * Four states, and the difference between the last two is the point:
 *
 * - `none`    — no sensor is linked. Not a fault; nothing to say.
 * - `unknown` — linked, but never polled since this shipped. Says so plainly
 *               rather than guessing, because claiming "online" for a sensor
 *               nobody has asked about is exactly the false comfort the
 *               watchdog exists to prevent.
 * - `online`  — reachable at the last poll.
 * - `offline` — Govee says it is not reachable. Check the battery.
 */
export function sensorLinkChip(
  inc: SensorLinkFields,
  now = Date.now(),
  /**
   * When the incubator last produced a reading.
   *
   * `sensorSeenAt` only started being written when this feature shipped, so a
   * sensor that dropped off before then has no record of ever being seen — and
   * "never seen on the network" is a lie about a sensor that worked for
   * months. A reading is proof it was there.
   */
  lastReadingAt?: string | null,
): LinkChip {
  if (!inc.goveeLinked) {
    return { state: 'none', label: 'No sensor', detail: null, tone: 'neutral' }
  }

  if (inc.sensorOnline == null) {
    return {
      state: 'unknown',
      label: 'Sensor: not checked',
      detail: inc.sensorCheckedAt ? `Last checked ${ago(inc.sensorCheckedAt, now)}` : null,
      tone: 'neutral',
    }
  }

  if (inc.sensorOnline) {
    return {
      state: 'online',
      label: 'Sensor online',
      detail: inc.sensorCheckedAt ? `Checked ${ago(inc.sensorCheckedAt, now)}` : null,
      tone: 'green',
    }
  }

  // The later of the two: whichever evidence is more recent is the one that
  // dates the outage.
  const seen =
    inc.sensorSeenAt && lastReadingAt
      ? inc.sensorSeenAt > lastReadingAt
        ? inc.sensorSeenAt
        : lastReadingAt
      : (inc.sensorSeenAt ?? lastReadingAt ?? null)

  return {
    state: 'offline',
    label: 'Sensor offline',
    // Where an outage started is the useful number: five minutes is a blip,
    // three days is a battery.
    detail: seen ? `Last seen ${ago(seen, now)}` : 'Never seen on the network',
    tone: 'red',
  }
}
