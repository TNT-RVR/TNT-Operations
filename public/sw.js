/* TNT Operations service worker — offline-capable field app shell.
 * Strategy: network-first for navigations (fresh app when online, cached shell
 * offline); cache-first for same-origin static assets and satellite tiles
 * (runtime-filled, so previously viewed fields keep working in the field). */
const SHELL = 'tnt-shell-v1'
const TILES = 'tnt-tiles-v1'
const TILE_HOSTS = ['server.arcgisonline.com']
const TILE_LIMIT = 2000

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

async function trimCache(name, limit) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length > limit) await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return

  // Satellite tiles: cache-first, capped.
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(e.request)
        if (hit) return hit
        const res = await fetch(e.request)
        if (res.ok) {
          cache.put(e.request, res.clone())
          trimCache(TILES, TILE_LIMIT)
        }
        return res
      }),
    )
    return
  }

  if (url.origin !== location.origin) return

  // Navigations: network-first, fall back to the cached shell.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put('/', res.clone()))
          return res.clone()
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Static assets: cache-first with background fill.
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(e.request)
      if (hit) return hit
      const res = await fetch(e.request)
      if (res.ok) cache.put(e.request, res.clone())
      return res
    }),
  )
})

/* ── Web push ───────────────────────────────────────────────────────────────
 * Alerts from the Netlify sender (temp/humidity out of band, milestones due).
 * The payload is JSON: { title, body, url, tag, renotify }. */

self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    // A malformed payload must still surface something — a silent drop would
    // look exactly like "alerts aren't working".
    d = { title: 'TNT Operations', body: e.data ? e.data.text() : 'New alert' }
  }
  const title = d.title || 'TNT Operations'
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      // The generated 192px icon, not the 3000px source: a push notification
      // draws this at about 48px and the phone should not fetch 133 KB for it.
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Same tag replaces an earlier notice for the same incubator instead of
      // stacking six of them; renotify still buzzes so it isn't missed.
      tag: d.tag || 'tnt-alert',
      renotify: d.renotify !== false,
      requireInteraction: d.requireInteraction === true,
      data: { url: d.url || '/incubation' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = (e.notification.data && e.notification.data.url) || '/incubation'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse an open tab if there is one — a second copy of the app is never
      // what someone wants from tapping an alert.
      for (const c of list) {
        if (c.url.includes(location.origin)) return c.focus().then((f) => f.navigate(target))
      }
      return self.clients.openWindow(target)
    }),
  )
})

/* The push service can rotate a subscription on its own. Tell the app so it
 * can re-register, otherwise alerts stop silently. */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((list) => {
      for (const c of list) c.postMessage({ type: 'push-subscription-change' })
    }),
  )
})
