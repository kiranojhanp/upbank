import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// This is a static SPA: the browser talks to api.up.com.au directly, so there
// is no dev proxy. Up answers with `Access-Control-Allow-Origin: *`.
//
// GitHub Pages project sites live under `/<repo>/`, so the base path is
// configurable at build time. The deploy workflow sets it automatically.
function normalizeBasePath(value: string | undefined): string {
  const raw = (value ?? '/').trim()
  if (!raw || raw === '/') return '/'
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const BASE_PATH = normalizeBasePath(process.env.VITE_BASE_PATH)

// With no server to send security headers, a production build injects a
// Content-Security-Policy meta tag and emits `_headers` / `_redirects` for
// static hosts that support them. `connect-src` must allow the Up API, and
// `'wasm-unsafe-eval'` compiles the wa-sqlite engine. Directives that meta tags
// cannot express (`frame-ancestors`) live in the generated header file; a host
// that ignores `_headers` needs them configured manually (see README).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src-attr 'none'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.up.com.au",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "child-src 'self'",
  "media-src 'none'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join('; ')

// `frame-ancestors` is ignored in a <meta> CSP, so the header version carries
// the anti-framing directive. The generated `_headers` file keeps it in sync
// for static hosts that support one (Netlify, Cloudflare Pages).
const CONTENT_SECURITY_POLICY_HEADER = `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`

const SECURITY_HEADERS = [
  `Content-Security-Policy: ${CONTENT_SECURITY_POLICY_HEADER}`,
  'X-Frame-Options: DENY',
  'X-Content-Type-Options: nosniff',
  'X-DNS-Prefetch-Control: off',
  'X-Robots-Tag: noindex, nofollow',
  'Referrer-Policy: no-referrer',
  "Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Resource-Policy: same-origin',
  'X-Permitted-Cross-Domain-Policies: none',
  'Strict-Transport-Security: max-age=31536000; includeSubDomains',
]

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

/**
 * Static hosts that understand `_headers` / `_redirects` get the full header
 * set (including the anti-framing directive a meta tag cannot express) and an
 * SPA fallback without any extra configuration. Hosts that ignore these files
 * still get the in-document CSP and the README's nginx/Caddy guidance.
 */
function generateSecurityFiles(): Plugin {
  return {
    name: 'generate-security-files',
    apply: 'build',
    generateBundle() {
      const headers = [
        '/*',
        ...SECURITY_HEADERS.map((header) => `  ${header}`),
        '',
        '/index.html',
        '  Cache-Control: no-cache',
        '',
        '/sw.js',
        '  Cache-Control: no-cache',
        '',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
      ].join('\n')

      this.emitFile({ type: 'asset', fileName: '_headers', source: headers })
      this.emitFile({
        type: 'asset',
        fileName: '_redirects',
        source: '/*    /index.html   200\n',
      })
    },
  }
}

/** Service worker source with the precache list baked in at build time. */
function serviceWorkerSource(buildId: string, precache: string[], base: string): string {
  return `const CACHE = 'up-shell-${buildId}';
const BASE = ${JSON.stringify(base)};
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
`
}

/**
 * GitHub Pages serves `404.html` for unknown paths. A copy of the built index
 * gives deep links the SPA shell, and `.nojekyll` stops Jekyll from filtering
 * hashed assets.
 */
function emitPagesFallback(): Plugin {
  return {
    name: 'emit-pages-fallback',
    apply: 'build',
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url))
      const index = join(dist, 'index.html')
      if (!existsSync(index)) return
      copyFileSync(index, join(dist, '404.html'))
      writeFileSync(join(dist, '.nojekyll'), '')
    },
  }
}

function generateServiceWorker(): Plugin {
  const publicDir = fileURLToPath(new URL('./public', import.meta.url))
  return {
    name: 'generate-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const precache = new Set<string>([BASE_PATH, `${BASE_PATH}index.html`])

      for (const fileName of Object.keys(bundle)) {
        if (fileName === 'sw.js' || fileName.endsWith('.map') || fileName.startsWith('_')) continue
        precache.add(`${BASE_PATH}${fileName}`)
      }

      // Files copied verbatim from public/ are not part of the bundle.
      const walk = (dir: string, prefix = '') => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`)
          else precache.add(`${BASE_PATH}${prefix}${entry}`)
        }
      }
      if (existsSync(publicDir)) walk(publicDir)

      precache.delete(`${BASE_PATH}sw.js`)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(Date.now().toString(36), [...precache].sort(), BASE_PATH),
      })
    },
  }
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    tailwindcss(),
    injectCsp(),
    generateSecurityFiles(),
    generateServiceWorker(),
    emitPagesFallback(),
  ],
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
