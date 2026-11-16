import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { installStorageGuards } from './persistence'
import {
  FRAMED_MESSAGE,
  INSECURE_CONTEXT_MESSAGE,
  isFramed,
  isInsecureOrigin,
} from './security'

// Warn (rather than crash) when the browser's storage quota is exceeded.
installStorageGuards()

/** Replace the app with a plain-text blocker before any credential is read. */
function renderBlocker(message: string): void {
  const root = document.getElementById('root')
  if (!root) return
  const box = document.createElement('div')
  box.className = 'boot-screen'
  const text = document.createElement('p')
  text.className = 'login-error'
  text.textContent = message
  box.append(text)
  root.replaceChildren(box)
}

if (isFramed()) {
  renderBlocker(FRAMED_MESSAGE)
} else if (isInsecureOrigin()) {
  // The bearer token would cross the network in cleartext. Refuse to load the
  // login form or boot the cache until the app is served from a secure origin.
  renderBlocker(INSECURE_CONTEXT_MESSAGE)
} else {
  // The service worker (generated at build time) precaches the app shell so
  // the installed PWA opens offline. Never register it in dev, where it would
  // fight Vite's HMR.
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
}
