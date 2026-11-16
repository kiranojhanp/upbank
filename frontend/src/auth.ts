/**
 * Local possession of the Up personal access token.
 *
 * This build is a static SPA with no server session, so the token lives in
 * `localStorage` and is attached to every Up request as a bearer header. That
 * is a deliberate trade-off: any script on the origin could read it, which is
 * why the app ships a strict CSP and loads no third-party code. Generate a
 * short-lived token in the Up app to bound the exposure.
 */

/** Storage key for the bearer token. Exported so other tabs can watch it. */
export const TOKEN_STORAGE_KEY = 'up:token'
const VERIFIED_KEY = 'up:verifiedAt'
// Re-check the token against Up at most this often. Between checks the boot
// probe trusts the stored token, which keeps page loads off Up while still
// catching a revoked token within the window.
const VERIFY_WINDOW_MS = 6 * 60 * 60 * 1000

let currentToken: string | null = null

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage can throw when disabled by policy or in some private modes.
    return null
  }
}

/** Read the persisted token into memory. Call once at boot, before any request. */
export function loadToken(): string | null {
  currentToken = store()?.getItem(TOKEN_STORAGE_KEY) ?? null
  return currentToken
}

export function getToken(): string | null {
  return currentToken
}

export function setToken(token: string): void {
  currentToken = token
  try {
    const storage = store()
    storage?.setItem(TOKEN_STORAGE_KEY, token)
    // A freshly entered token has not been verified yet.
    storage?.removeItem(VERIFIED_KEY)
  } catch {
    // In-memory only; the login still works for this tab.
  }
}

export function clearToken(): void {
  currentToken = null
  try {
    const storage = store()
    storage?.removeItem(TOKEN_STORAGE_KEY)
    storage?.removeItem(VERIFIED_KEY)
  } catch {
    // Ignore.
  }
}

/** True when the token was confirmed against Up within the verify window. */
export function isFreshlyVerified(): boolean {
  const raw = store()?.getItem(VERIFIED_KEY)
  const at = raw ? Number(raw) : Number.NaN
  return Number.isFinite(at) && Date.now() - at < VERIFY_WINDOW_MS
}

export function markVerified(): void {
  try {
    store()?.setItem(VERIFIED_KEY, String(Date.now()))
  } catch {
    // Ignore.
  }
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** FNV-1a, only used when Web Crypto is unavailable (an insecure context). */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * A stable, non-reversible fingerprint of the token, used to scope the local
 * cache so two Up accounts on one machine never share rows. Mirrors the value
 * the old server computed as `sha256(token).slice(0, 16)`.
 */
export async function uidForToken(token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(token))
    return toHex(new Uint8Array(digest)).slice(0, 16)
  }
  return fnv1a(token).slice(0, 16)
}
