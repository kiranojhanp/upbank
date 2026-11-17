const CACHE = 'up-shell-mwk1fc46';
const BASE = "/upbank/";
const PRECACHE = ["/upbank/","/upbank/apple-touch-icon.png","/upbank/assets/index-B1IOQ1pB.js","/upbank/assets/index-Dr8RNE_W.css","/upbank/assets/opfs-worker-DsdXkjH0.js","/upbank/assets/wa-sqlite-Ba70bhIr.wasm","/upbank/favicon.svg","/upbank/fonts/cormorant-400-italic.woff2","/upbank/fonts/cormorant-400-normal.woff2","/upbank/fonts/cormorant-500-italic.woff2","/upbank/fonts/cormorant-500-normal.woff2","/upbank/fonts/cormorant-600-italic.woff2","/upbank/fonts/cormorant-600-normal.woff2","/upbank/fonts/jetbrains-mono-400-normal.woff2","/upbank/fonts/jetbrains-mono-500-normal.woff2","/upbank/fonts/syne-400-normal.woff2","/upbank/fonts/syne-500-normal.woff2","/upbank/fonts/syne-600-normal.woff2","/upbank/fonts/syne-700-normal.woff2","/upbank/icon-192.png","/upbank/icon-512.png","/upbank/index.html","/upbank/manifest.webmanifest"];

// Precache the whole app shell so the installed PWA opens with no network.
// Per-URL failures are tolerated so one missing asset cannot abort install.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(
      PRECACHE.map(async (url) => {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      }),
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never intercept the Up API or any other origin.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Network-first so a new deploy is picked up, cache as the offline fallback.
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(request, { ignoreVary: true })) ||
          (await cache.match(BASE + 'index.html', { ignoreVary: true })) ||
          (await cache.match(BASE, { ignoreVary: true })) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // Hashed assets are immutable, so cache-first with runtime fill-in.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  })());
});
