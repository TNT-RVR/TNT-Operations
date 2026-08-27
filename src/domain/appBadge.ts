/**
 * The number on the app icon.
 *
 * Web Push already works here — a closed phone gets the banner. What it did not
 * do is put a count on the icon, which is the thing people actually mean by
 * "the app has a notification": the red dot you see without opening anything.
 *
 * That is the Badging API, and it is a separate feature from push with none of
 * push's cost — no keys, no server, no permission prompt. It is a silent no-op
 * in a browser tab, so it needs no feature detection beyond "does the method
 * exist".
 *
 * ── Why the count is defined here and not at either call site ────────────────
 *
 * TWO places compute it: this app while it is running, and the push sender
 * while it is not. If they disagree, the badge visibly jumps the moment someone
 * opens the app — which reads as a bug in the alerting rather than in the
 * counting. So the rule lives here once, and the cap below is what makes the
 * two agree: the app only ever holds the newest `BADGE_SCAN_LIMIT`
 * notifications, so a count of every unread row on the server would be a number
 * the client can never reproduce.
 */
import type { AppNotification } from '@/data/types'

/**
 * How many notifications the app keeps in hand, and therefore the most it can
 * count. Also the provider's fetch limit — the two must be the same number, so
 * there is only one of them.
 */
export const BADGE_SCAN_LIMIT = 200

/**
 * Unread, undeleted, capped.
 *
 * `readAt` is on the notification itself rather than per person: this is a
 * shared inbox by design, so the badge is the crew's count and not each
 * individual's. Someone else reading an alert clears it for everyone, which is
 * the intended behaviour for an operation where one person acts on a thing.
 */
export function unreadBadgeCount(notifications: Pick<AppNotification, 'readAt'>[]): number {
  let n = 0
  for (const notification of notifications) {
    if (!notification.readAt) n++
    if (n >= BADGE_SCAN_LIMIT) return BADGE_SCAN_LIMIT
  }
  return n
}
