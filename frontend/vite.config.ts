import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// In development the React app runs on :5173 and proxies API calls to
// the FastAPI server on :8000. In production FastAPI serves the built
// `dist` directory directly, so no proxy is needed.
//
// `changeOrigin` must stay false. Vite sets it to true for the string
// shorthand form (`'/api': 'http://...'`), which rewrites the Host header to
// `127.0.0.1:8000`. The server's CSRF check compares Origin against Host, so a
// rewritten Host makes a same-origin login look cross-origin and returns 403.
// `xfwd` adds X-Forwarded-Host for proxies that do rewrite Host anyway.
const apiProxy = {
  target: 'http://127.0.0.1:8000',
  changeOrigin: false,
  xfwd: true,
} as const

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  server: {
    proxy: {
      '/api': apiProxy,
      '/logout': apiProxy,
    },
  },
  build: {
    outDir: 'dist',
  },
})
