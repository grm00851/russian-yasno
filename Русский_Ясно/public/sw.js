const CACHE_PREFIX = 'slovo-academy'
const CACHE_NAME = `${CACHE_PREFIX}-v12`
const APP_ENTRY = new URL('./', self.registration.scope).href

const inScope = url => url.origin === self.location.origin && url.href.startsWith(self.registration.scope)

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch(APP_ENTRY, { cache: 'reload' })
    if (!response.ok) throw new Error('Не удалось загрузить оболочку приложения')
    await cache.put(APP_ENTRY, response.clone())
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map(match => new URL(match[1], APP_ENTRY))
      .filter(url => inScope(url) && !url.href.includes('#'))
      .map(url => url.href)
    await Promise.allSettled(assets.map(url => cache.add(url)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const requestUrl = new URL(request.url)
  if (request.method !== 'GET' || !inScope(requestUrl)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      } catch {
        return (await cache.match(request)) || (await cache.match(APP_ENTRY)) || Response.error()
      }
    }

    const cached = await cache.match(request)
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
      return response
    } catch {
      return Response.error()
    }
  })())
})
