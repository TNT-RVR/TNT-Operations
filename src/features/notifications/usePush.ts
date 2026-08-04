import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/data/supabaseClient'

/**
 * Web-push subscription for this device.
 *
 * A subscription is per DEVICE, not per account: enabling on a phone says
 * nothing about a tablet, so state is always read from the live service-worker
 * registration rather than remembered anywhere.
 */
export type PushState =
  | 'unsupported' // no service worker / Push API (includes iOS Safari in a tab)
  | 'ios-needs-install' // iOS: works, but only once added to the Home Screen
  | 'denied' // permission refused; only the user can undo this
  | 'off'
  | 'on'
  | 'busy'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 * Returns an ArrayBuffer so the type is unambiguous (a Uint8Array can be backed
 * by a SharedArrayBuffer, which applicationServerKey doesn't accept).
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buf
}

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as a Mac; the touch check separates it from a desktop.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function usePush() {
  const [state, setState] = useState<PushState>('busy')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      // On iOS this is what a normal browser tab looks like — push only exists
      // for an installed (Home Screen) app, so say that rather than "no".
      setState(isIos() && !window.matchMedia('(display-mode: standalone)').matches ? 'ios-needs-install' : 'unsupported')
      return
    }
    if (Notification.permission === 'denied') return setState('denied')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    } catch {
      setState('unsupported')
    }
  }, [])

  useEffect(() => {
    void refresh()
    // The push service can rotate a subscription; sw.js forwards that here.
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'push-subscription-change') void refresh()
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [refresh])

  const enable = useCallback(async () => {
    setError(null)
    if (!VAPID_PUBLIC) {
      setError('Push isn’t configured on the server yet (missing VAPID key).')
      return
    }
    setState('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required by every browser: pushes must be shown to the user.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC),
        }))

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      const { data: auth } = await supabase!.auth.getUser()
      if (!auth.user) throw new Error('Not signed in.')

      // Upsert on endpoint: re-enabling on the same device refreshes its keys
      // rather than leaving a stale row that pushes would fail against.
      const { error: dbErr } = await supabase!.from('push_subscriptions').upsert(
        {
          user_id: auth.user.id,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          user_agent: navigator.userAgent.slice(0, 300),
          expired_at: null,
        },
        { onConflict: 'endpoint' },
      )
      if (dbErr) throw new Error(dbErr.message)
      setState('on')
    } catch (e) {
      console.error('[push] enable failed:', e)
      setError(e instanceof Error ? e.message : 'Could not turn on notifications.')
      await refresh()
    }
  }, [refresh])

  const disable = useCallback(async () => {
    setError(null)
    setState('busy')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        // Remove the row FIRST: a subscription the browser has dropped but the
        // server still holds means pushes fail silently forever.
        await supabase!.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setState('off')
    } catch (e) {
      console.error('[push] disable failed:', e)
      setError(e instanceof Error ? e.message : 'Could not turn off notifications.')
      await refresh()
    }
  }, [refresh])

  return { state, error, enable, disable, refresh }
}
