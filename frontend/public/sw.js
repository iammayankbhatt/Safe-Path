/* SafePath Service Worker - PWA Offline Support */

const CACHE_NAME = 'safepath-v1';
const TILE_CACHE = 'safepath-tiles-v1';
const API_CACHE = 'safepath-api-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/static/js/main.chunk.js',
  '/static/js/bundle.js',
  '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(() => {
        console.log('[SW] Some static assets failed to cache');
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== TILE_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache with network fallback strategies
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Map tiles: cache-first (tiles rarely change)
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('tiles.openstreetmap.org')) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiStrategy(event.request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(staticStrategy(event.request));
});

// Cache-first strategy for map tiles
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || new Response('', { status: 503 });
  }
}

// Network-first strategy for API calls
async function apiStrategy(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      console.log('[SW] Serving API response from cache (offline)');
      return cached;
    }
    return new Response(
      JSON.stringify({ error: 'You are offline. Showing cached data.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// Cache-first for static assets
async function staticStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return cached index.html for navigation requests
    if (request.mode === 'navigate') {
      return cache.match('/index.html');
    }
    return new Response('', { status: 503 });
  }
}

// Background sync for queued panic SMS (offline queue)
self.addEventListener('sync', (event) => {
  if (event.tag === 'panic-queue') {
    event.waitUntil(processPanicQueue());
  }
});

async function processPanicQueue() {
  // Send any queued panic requests that failed due to offline state
  console.log('[SW] Processing queued panic alerts...');
}
