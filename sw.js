// sw.js — Oriento PWA Service Worker
// Strategies:
// - HTML navigations: network-first (fallback to cached shell)
// - CSS/JS: stale-while-revalidate (fast, then refresh in background)
// - Icons/images: cache-first
// - Weather APIs (Open-Meteo + Geocoding): stale-while-revalidate with last-known offline

const VERSION = 'oriento-v10';               // <- bump this when you deploy
const STATIC_CACHE  = `static-${VERSION}`;
const RUNTIME_ASSET = `runtime-asset-${VERSION}`;
const RUNTIME_WEATHER = `runtime-weather-${VERSION}`;

const CORE = [
  './',                    // scope-aware root
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  // Optional: add your real icons if present
  // './icons/icon-192.png',
  // './icons/icon-512.png',
];

// ---- Install: pre-cache app shell and take control immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE))
  );
  self.skipWaiting();
});

// ---- Activate: clean old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k =>
          k.startsWith('static-') ||
          k.startsWith('runtime-asset-') ||
          k.startsWith('runtime-weather-')
        )
        .filter(k => ![STATIC_CACHE, RUNTIME_ASSET, RUNTIME_WEATHER].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Helpers
const isNav = (req) =>
  req.mode === 'navigate' ||
  (req.destination === '' && req.headers.get('accept')?.includes('text/html'));

const sameOrigin = (url) => {
  try { return new URL(url, self.location.href).origin === self.location.origin; }
  catch { return false; }
};

const isStyleOrScript = (req) =>
  req.destination === 'style' || req.destination === 'script';

const isImageOrIcon = (req) =>
  req.destination === 'image' || req.destination === 'icon';

const isWeatherAPI = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.endsWith('open-meteo.com');
  } catch { return false; }
};

// Strategies
async function networkFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    // Cache index shell for offline navigations
    if (isNav(req)) {
      const cloned = fresh.clone();
      // put using the request URL (so same-path navs match)
      cache.put(req, cloned);
      // Also ensure index.html is kept fresh as a generic fallback
      cache.put('./index.html', cloned.clone());
    }
    return fresh;
  } catch {
    // Fallback to cached shell / cached request
    return (await cache.match(req)) ||
           (await cache.match('./index.html')) ||
           new Response('<h1>Offline</h1><p>Content unavailable.</p>', {
              headers: { 'Content-Type': 'text/html' }
           });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || fetchPromise || fetch(req);
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

// ---- Fetch: route by type
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cached
  if (request.method !== 'GET') return;

  // Navigations (HTML): network-first
  if (isNav(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Weather APIs: SWR with last-known offline
  if (isWeatherAPI(request.url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_WEATHER));
    return;
  }

  // Same-origin CSS/JS: SWR (fast yet refreshes in background)
  if (sameOrigin(request.url) && isStyleOrScript(request)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_ASSET));
    return;
  }

  // Same-origin images/icons: cache-first
  if (sameOrigin(request.url) && isImageOrIcon(request)) {
    event.respondWith(cacheFirst(request, RUNTIME_ASSET));
    return;
  }

  // Everything else: try cache-first, then network (safe default)
  event.respondWith(cacheFirst(request, RUNTIME_ASSET));
});

// Optional: page can tell SW to take over immediately
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
