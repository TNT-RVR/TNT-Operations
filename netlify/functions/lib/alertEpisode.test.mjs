import { describe, it, expect } from 'vitest'
import { shouldNotify } from './alertEpisode.mjs'

const NOW = Date.parse('2026-09-16T15:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()
const GAP = 60

describe('shouldNotify', () => {
  it('announces a problem nobody has been told about', () => {
    expect(shouldNotify({ lastNotifiedAt: null, lastClearAt: null, lastProblemAt: null, now: NOW, gapMin: GAP })).toBe(true)
  })

  it('stays quiet while the same problem continues', () => {
    // The whole point: told at the start, still broken on the last check, no
    // recovery in between — the eighth ping for a dead sensor adds nothing.
    expect(
      shouldNotify({ lastNotifiedAt: ago(600), lastClearAt: null, lastProblemAt: ago(15), now: NOW, gapMin: GAP }),
    ).toBe(false)
  })

  it('stays quiet across days of the same continuing problem', () => {
    // Under the old cooldown this re-sent every six hours.
    expect(
      shouldNotify({ lastNotifiedAt: ago(2 * 24 * 60), lastClearAt: ago(3 * 24 * 60), lastProblemAt: ago(20), now: NOW, gapMin: GAP }),
    ).toBe(false)
  })

  it('announces again after the problem cleared', () => {
    expect(
      shouldNotify({ lastNotifiedAt: ago(600), lastClearAt: ago(300), lastProblemAt: ago(15), now: NOW, gapMin: GAP }),
    ).toBe(true)
  })

  it('announces again when the problem stopped but no all-clear was ever recorded', () => {
    // The trap: the temperature all-clear skips problems older than a day, so
    // a long episode can end without one. Relying on clears alone would leave
    // it "open" and silence every future problem on that incubator.
    expect(
      shouldNotify({ lastNotifiedAt: ago(5 * 24 * 60), lastClearAt: null, lastProblemAt: ago(3 * 24 * 60), now: NOW, gapMin: GAP }),
    ).toBe(true)
  })

  it('treats a gap just past the limit as a new episode', () => {
    expect(
      shouldNotify({ lastNotifiedAt: ago(600), lastClearAt: null, lastProblemAt: ago(GAP + 1), now: NOW, gapMin: GAP }),
    ).toBe(true)
  })

  it('treats a gap just inside the limit as the same episode', () => {
    expect(
      shouldNotify({ lastNotifiedAt: ago(600), lastClearAt: null, lastProblemAt: ago(GAP - 1), now: NOW, gapMin: GAP }),
    ).toBe(false)
  })

  it('announces when told before but nothing logged since — no evidence it continued', () => {
    expect(
      shouldNotify({ lastNotifiedAt: ago(600), lastClearAt: null, lastProblemAt: null, now: NOW, gapMin: GAP }),
    ).toBe(true)
  })
})
