/**
 * Small, dependency-free security checks used at startup and on the login form.
 *
 * The app is a static SPA that sends a bearer token directly to Up. That makes
 * two things non-negotiable:
 *
 * - the origin must be a secure context, because otherwise the token travels
 *   over plain HTTP and can be read on the wire;
 * - the only secret the user types is a single-line opaque token, so whitespace
 *   and control characters are rejected before the value reaches a header.
 */

export const MAX_TOKEN_LENGTH = 512

export const INSECURE_CONTEXT_MESSAGE =
  'This app must be served over HTTPS (or from localhost). ' +
  'Refusing to send a banking token over an insecure connection.'

export const FRAMED_MESSAGE =
  'This app cannot be embedded in another page. Open it directly in its own tab.'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * True only when the current page clearly is not a secure context.
 *
 * `isSecureContext` is preferred because the browser knows which origins count
 * as trustworthy (localhost, file://, and so on). The protocol check is a
 * fallback for engines that do not expose it. An unknown value fails open so
 * test DOMs and future browsers do not lock the app out.
 */
export function isInsecureOrigin(): boolean {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return false

  const { protocol, hostname } = window.location
  if (protocol === 'https:' || protocol === 'file:') return false
  if (isLocalHost(hostname)) return false
  if (window.isSecureContext === true) return false
  return true
}

/** Best-effort frame bust for hosts that ignore the generated security headers. */
export function isFramed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Some DOM implementations (including test DOMs) leave `top` undefined.
    if (!window.top) return false
    return window.top !== window.self
  } catch {
    // A sandboxed or cross-origin parent makes the comparison throw.
    return true
  }
}

/**
 * Validate a pasted personal access token. Returns a user-facing error, or
 * null when the value is safe to store and put in an Authorization header.
 */
export function tokenInputError(raw: string): string | null {
  const value = raw.trim()
  if (!value) return 'Access token is required'
  if (value.length > MAX_TOKEN_LENGTH) return 'Access token is too long'
  if (/\s/.test(value)) return 'Access token must not contain spaces or line breaks'
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return 'Access token contains invalid characters'
  }
  return null
}
