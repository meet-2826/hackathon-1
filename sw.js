/* sw.js — Oriento PWA Service Worker
   Strategy:
   - HTML: network-first (fallback to cache)
   - Static assets (CSS/JS/icons): cache-first (stale-while-revalidate)
   - Third-party APIs: network pass-through
*/

const CACHE_VERSION = 'oriento-min-v1'; // <— bump this when you ship changes
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Files to precache for instant offline shell
const CORE_ASSETS = [
  '/',                 // Netlify serves index.html at /
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon-192.png',     // add these icons if you have them
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {
        // Ignore install failures (e.g., offline on first load)
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Remove older versioned caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('static-') && k !== STATIC_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helper: is this a same-origin request?
function isSameOrigin(url) {
  try {
    const u = new URL(url, self.location.href);
    return u.origin === self.location.origin;
  } catch {
    return false;
  }
}

// Helper: treat navigation (HTML) requests specially
function isNavigationRequest(req) {
  return req.mode === 'navigate' || (req.destination === '' && req.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  // HTML: network-first (with cache fallback)
  if (isNavigationRequest(request)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        // Update cache copy
        const cache = await caches.open(STATIC_CACHE);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        // Offline or network error → try cache
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('/index.html') || await cache.match(request);
        return cached || new Response('<h1>Offline</h1><p>Content unavailable.</p>', { headers: { 'Content-Type': 'text/html' }});
      }
    })());
    return;
  }

  // Same-origin static assets: cache-first (stale-while-revalidate)
  if (isSameOrigin(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      const fetchAndUpdate = fetch(request).then(resp => {
        // Only cache basic/opaque-ok assets
        if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'opaqueredirect')) {
          cache.put(request, resp.clone()).catch(()=>{});
        }
        return resp;
      }).catch(() => null);

      // Return cached immediately if present
      if (cached) {
        // Trigger background refresh but do not await it
        fetchAndUpdate;
        return cached;
      }
      // No cache → go to network
      const fresh = await fetchAndUpdate;
      if (fresh) return fresh;

      // Last resort: any cache entry that matches path sans query
      const url = new URL(request.url);
      const fallback = await cache.match(url.pathname);
      return fallback || new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })());
    return;
  }

  // Third-party (e.g., Open-Meteo APIs): network pass-through
  // You could add runtime caching here, but many APIs use CORS/no-store.
  event.respondWith(fetch(request).catch(() => new Response('', { status: 502 })));
});

// Support manual skip waiting (optional)
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
