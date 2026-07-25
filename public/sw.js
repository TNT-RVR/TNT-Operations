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
