import { describe, it, expect } from 'vitest'
import { isMutedForMe, visibleAlerts, hiddenCount } from './alertMutes'

const muted = new Set(['inc5'])
const none = new Set<string>()

const alert = (incubatorId: string | null, id = 'a') => ({ id, incubatorId })

describe('isMutedForMe', () => {
  it('hides an alert about a muted incubator', () => {
    expect(isMutedForMe(alert('inc5'), muted)).toBe(true)
  })

  it('keeps an alert about a different incubator', () => {
    expect(isMutedForMe(alert('inc2'), muted)).toBe(false)
  })

  it('never hides an alert that is about no incubator', () => {
    // A task reminder or a QuickBooks failure has nothing to do with the
    // incubators somebody muted, however many of them there are.
    expect(isMutedForMe(alert(null), muted)).toBe(false)
    expect(isMutedForMe({}, muted)).toBe(false)
  })

  it('hides nothing when nothing is muted', () => {
    expect(isMutedForMe(alert('inc5'), none)).toBe(false)
  })
})

describe('visibleAlerts', () => {
  const rows = [alert('inc5', 'a'), alert('inc2', 'b'), alert(null, 'c'), alert('inc5', 'd')]

  it('drops only the muted ones, keeping order', () => {
    expect(visibleAlerts(rows, muted).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('returns the list untouched when nothing is muted', () => {
    expect(visibleAlerts(rows, none)).toBe(rows)
  })

  it('can hide everything without breaking', () => {
    expect(visibleAlerts([alert('inc5')], muted)).toEqual([])
  })
})

describe('hiddenCount', () => {
  it('counts what was held back', () => {
    // Said out loud rather than silently showing less: an inbox that drops
    // entries quietly is indistinguishable from a broken one.
    expect(hiddenCount([alert('inc5'), alert('inc2'), alert('inc5')], muted)).toBe(2)
  })

  it('is zero when nothing is muted', () => {
    expect(hiddenCount([alert('inc5')], none)).toBe(0)
  })
})
