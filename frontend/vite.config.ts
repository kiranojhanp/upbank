import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// This is a static SPA: the browser talks to api.up.com.au directly, so there
// is no dev proxy. Up answers with `Access-Control-Allow-Origin: *`.
//
// With no server to send security headers, a production build injects a
// Content-Security-Policy meta tag. `connect-src` must allow the Up API, and
// `'wasm-unsafe-eval'` compiles the wa-sqlite engine. Directives that meta tags
// cannot express (`frame-ancestors`, `X-Frame-Options`, `Permissions-Policy`)
// are left to the static host's header config — see the README.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.up.com.au",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function injectCsp(): Plugin {
  return {
    name: 'inject-csp',
    // Only the production build: the dev server needs its HMR websocket and
    // inline client, which this policy would block.
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/** Service worker source with the precache list baked in at build time. */
function serviceWorkerSource(buildId: string, precache: string[]): string {
  return `const CACHE = 'up-shell-${buildId}';
const PRECACHE = ${JSON.stringify(precache)};

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
          (await cache.match(request)) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/')) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // Hashed assets are immutable, so cache-first with runtime fill-in.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  })());
});
`
}

function generateServiceWorker(): Plugin {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  return {
    name: 'generate-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const precache = new Set<string>(['/', '/index.html'])

      for (const fileName of Object.keys(bundle)) {
        if (fileName === 'sw.js' || fileName.endsWith('.map')) continue
        precache.add(`/${fileName}`)
      }

      // Files copied verbatim from public/ are not part of the bundle.
      const walk = (dir: string, prefix = '') => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`)
          else precache.add(`/${prefix}${entry}`)
        }
      }
      if (existsSync(publicDir)) walk(publicDir)

      precache.delete('/sw.js')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(Date.now().toString(36), [...precache].sort()),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), injectCsp(), generateServiceWorker()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The SQLite persistence package loads its OPFS worker and wa-sqlite.wasm as
  // separate assets. Pre-bundling it breaks that asset lookup in dev, so Vite
  // must serve the package beside its own files.
  optimizeDeps: {
    exclude: ['@tanstack/browser-db-sqlite-persistence'],
  },
  build: {
    outDir: 'dist',
  },
})
