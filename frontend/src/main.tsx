import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { installStorageGuards } from './persistence'

// Warn (rather than crash) when the browser's storage quota is exceeded.
installStorageGuards()

// The service worker (generated at build time) precaches the app shell so the
// installed PWA opens offline. Never register it in dev, where it would fight
// Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] service worker registration failed', error)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
