import { describe, expect, it } from 'vitest'
import { BADGE_SCAN_LIMIT, unreadBadgeCount } from './appBadge'

const n = (readAt: string | null) => ({ readAt })

describe('unreadBadgeCount', () => {
  it('counts what has not been read', () => {
    expect(unreadBadgeCount([n(null), n('2026-08-26T00:00:00Z'), n(null)])).toBe(2)
  })

  it('is zero on an empty inbox, so the badge clears', () => {
    expect(unreadBadgeCount([])).toBe(0)
    expect(unreadBadgeCount([n('2026-08-26T00:00:00Z')])).toBe(0)
  })

  /*
   * The cap is what keeps the running app and the push sender agreeing. The app
   * only ever holds the newest BADGE_SCAN_LIMIT notifications, so a server-side
   * count of every unread row would be a number it could never reproduce — and
   * the badge would visibly drop the moment someone opened the app.
   */
  it('caps at the number the app can actually see', () => {
    const many = Array.from({ length: BADGE_SCAN_LIMIT + 50 }, () => n(null))
    expect(unreadBadgeCount(many)).toBe(BADGE_SCAN_LIMIT)
  })

  it('does not cap below the limit', () => {
    const some = Array.from({ length: BADGE_SCAN_LIMIT - 1 }, () => n(null))
    expect(unreadBadgeCount(some)).toBe(BADGE_SCAN_LIMIT - 1)
  })
})
