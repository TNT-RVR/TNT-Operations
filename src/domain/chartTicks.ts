/**
 * Axis ticks that land on numbers a person would choose.
 *
 * A chart labelled 14.87 / 17.43 / 19.99 is arithmetically correct and useless
 * at a glance: the reader has to decode three arbitrary numbers before they can
 * judge anything. Rounded steps — 15 / 17.5 / 20 — are read without thinking.
 */

/** The step sizes worth using, per power of ten. */
const STEPS = [1, 2, 2.5, 5, 10]

/**
 * A rounded step of roughly `span / count`.
 *
 * Chosen from 1, 2, 2.5 and 5 times a power of ten, which is the set that
 * produces labels people read as round: 0.5, 2, 25, 500.
 */
export function niceStep(span: number, count: number): number {
  if (!Number.isFinite(span) || span <= 0 || count < 1) return 1
  const rough = span / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  for (const s of STEPS) {
    if (rough <= s * mag) return s * mag
  }
  return 10 * mag
}

/**
 * Tick values inside [lo, hi], on rounded steps.
 *
 * Only ticks that actually fall within the range are returned — a label drawn
 * outside the plot is a label sitting on top of something else.
 */
export function niceTicks(lo: number, hi: number, count = 3): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  if (hi <= lo) return [lo]
  const step = niceStep(hi - lo, count)
  const first = Math.ceil(lo / step) * step
  const out: number[] = []
  // Guarded rather than while(true): a pathological step must not spin.
  for (let v = first, i = 0; v <= hi + step * 1e-9 && i < 50; v += step, i++) {
    // Snap away the floating-point dust that turns 17.5 into 17.499999999999996.
    out.push(Math.round(v / step) * step)
  }
  return out
}

/**
 * How many decimals a set of ticks needs.
 *
 * Steps of 2.5 need one; steps of 5 need none. Showing "15.0" beside "17.5" is
 * fine, but "15.0 / 20.0 / 25.0" is three wasted characters on a phone.
 */
export function tickDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  return Number.isInteger(step) ? 0 : String(step).split('.')[1]?.length ?? 0
}

// ── Time axis ───────────────────────────────────────────────────────────────

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * Steps a time axis may use, smallest first. Each is a unit people count in —
 * nobody reads "every 5 hours" or "every 3 days" as easily as 6h or 1 week.
 */
const TIME_STEPS = [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY]

export interface TimeTick {
  /** Epoch ms of the tick. */
  t: number
  /** Whether the tick lands on a local midnight — labelled with the date. */
  isDay: boolean
}

/**
 * Ticks for a time axis, on local clock boundaries.
 *
 * A chart labelled only at its two ends leaves a week of data with nothing to
 * read a day off. These fall on whole local hours and midnights — "14:00",
 * "Sep 11" — never on the arbitrary instant the first reading happened to land.
 *
 * `offsetMs(t)` is the local offset from UTC at instant t (negative west of
 * Greenwich). Passed in rather than read from the machine, so the axis follows
 * the operation's timezone whatever device draws it, and so it can be tested.
 */
export function timeTicks(
  start: number,
  end: number,
  maxTicks: number,
  offsetMs: (t: number) => number,
): TimeTick[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || maxTicks < 1) return []
  const span = end - start
  const step = TIME_STEPS.find((s) => span / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1]

  // Align in LOCAL time: shift to wall-clock, floor to the step, shift back.
  // Steps of a week still align to midnight, just not to a particular weekday.
  const align = Math.min(step, DAY)
  const off = offsetMs(start)
  const firstLocal = Math.ceil((start + off) / align) * align
  const out: TimeTick[] = []
  for (let local = firstLocal, i = 0; i < 400; local += align, i++) {
    const t = local - offsetMs(local - off)
    if (t > end) break
    if (t < start) continue
    // Keep only ticks on the chosen step (the loop walks the finer alignment
    // so weekly steps still land on midnights).
    if (step > DAY && Math.round((local - firstLocal) / DAY) % Math.round(step / DAY) !== 0) continue
    const localMs = t + offsetMs(t)
    out.push({ t, isDay: ((localMs % DAY) + DAY) % DAY === 0 })
  }
  return out
}
