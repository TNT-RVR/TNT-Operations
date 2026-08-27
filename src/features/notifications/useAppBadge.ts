/**
 * Mirror the unread count onto the installed app's icon.
 *
 * Mounted once, app-wide, in the layout. It is the whole of the "red number on
 * the icon" feature while the app is running — no keys, no server, no
 * permission prompt. The service worker does the same call from the push
 * handler so the number also moves while the app is closed; see `public/sw.js`.
 *
 * ── Where it shows up ────────────────────────────────────────────────────────
 *
 * Installed PWAs on Android and desktop Chrome, and iOS 16.4+ home-screen apps.
 * In an ordinary browser tab the method does not exist and this does nothing,
 * which is why there is no capability flag or setting for it — there is nothing
 * a person could usefully decide.
 *
 * The call returns a promise that can reject (a locked profile, a platform that
 * has the method but refuses), and a rejected badge update is not worth a
 * console error on every alert, so it is swallowed deliberately.
 */
import { useEffect } from 'react'
import { useData } from '@/data/context'
import { unreadBadgeCount } from '@/domain/appBadge'

export function useAppBadge(): void {
  const { notifications } = useData()
  const unread = unreadBadgeCount(notifications)

  useEffect(() => {
    // The DOM types declare these as always present; on a plain browser tab
    // they are not there at all, so the runtime check is the real one.
    if (!('setAppBadge' in navigator)) return
    // Clearing at zero rather than setting 0: some platforms draw a bare dot
    // for `setAppBadge(0)` instead of removing the badge.
    const done = unread > 0 ? navigator.setAppBadge(unread) : navigator.clearAppBadge()
    void done?.catch(() => {})
  }, [unread])
}
