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
