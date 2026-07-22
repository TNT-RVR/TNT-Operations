/**
 * Incubation timing math. Pure functions — no React, no DB.
 *
 * NOTE: this is the target home for the port of `incubation_calc.py` from the
 * old bee-incubation app. The calendar model below is a sane default; when we
 * port for real, reconcile the exact stage boundaries against that file and
 * lock them in with test cases here.
 */

/** Default incubation length for leafcutter bees at ~30°C, in days. */
export const DEFAULT_INCUBATION_DAYS = 21

export type Stage = 'idle' | 'early' | 'mid' | 'emergence' | 'complete'

export interface IncubationProgress {
  daysElapsed: number
  daysRemaining: number
  pct: number
  stage: Stage
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Progress of an incubation batch.
 * @param startedAt ISO UTC start, or null when idle.
 * @param now       ISO UTC "current" time (passed in so callers stay testable).
 * @param days      Expected incubation length (defaults to 21).
 */
export function incubationProgress(
  startedAt: string | null,
  now: string,
  days: number = DEFAULT_INCUBATION_DAYS,
): IncubationProgress {
  if (!startedAt) return { daysElapsed: 0, daysRemaining: days, pct: 0, stage: 'idle' }

  const elapsedMs = Date.parse(now) - Date.parse(startedAt)
  const daysElapsed = Math.max(0, elapsedMs / DAY_MS)
  const daysRemaining = Math.max(0, days - daysElapsed)
  const pct = Math.max(0, Math.min(100, (daysElapsed / days) * 100))

  let stage: Stage
  if (pct >= 100) stage = 'complete'
  else if (pct >= 85) stage = 'emergence'
  else if (pct >= 40) stage = 'mid'
  else stage = 'early'

  return {
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysRemaining: Math.round(daysRemaining * 10) / 10,
    pct: Math.round(pct),
    stage,
  }
}
