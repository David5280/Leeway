// Leeway's service worker: makes the app installable, keeps the shell
// available offline, and shows push notifications. Budget data always comes
// fresh from your server.
const CACHE = 'leeway-shell-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return

  // Built assets have content hashes in their names, so a cached copy is always right.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
    return
  }

  // Pages: try the network first so updates show up, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/')),
    )
  }
})

// A push from your server: a short title and body, and the screen to open.
// The server sends no amounts or bank text; the inbox holds the detail.
self.addEventListener('push', (event) => {
  const message = readPush(event.data)
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url },
    }),
  )
})

/** The push's words, or a plain one when it can't be read. */
function readPush(data) {
  const fallback = {
    title: 'Leeway',
    body: 'Something needs a look.',
    url: '/inbox',
    tag: 'leeway',
  }
  try {
    const parsed = data ? data.json() : {}
    return {
      title: typeof parsed.title === 'string' ? parsed.title : fallback.title,
      body: typeof parsed.body === 'string' ? parsed.body : fallback.body,
      url: typeof parsed.url === 'string' ? parsed.url : fallback.url,
      tag: typeof parsed.tag === 'string' ? parsed.tag : fallback.tag,
    }
  } catch {
    return fallback
  }
}

/** A path in this app to open, never another site: anything else opens the inbox. */
function screenOf(url) {
  if (typeof url !== 'string') return '/inbox'
  try {
    const target = new URL(url, self.location.origin)
    if (target.origin !== self.location.origin) return '/inbox'
    return target.pathname + target.search + target.hash
  } catch {
    return '/inbox'
  }
}

// A tap on a notification opens its screen, in Leeway's window if one is open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = screenOf(event.notification.data && event.notification.data.url)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (!open) return self.clients.openWindow(path)
      return open.focus().then((client) => client.navigate(path))
    }),
  )
})
