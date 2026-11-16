/**
 * Small, user-scoped metadata store for the offline-first cache.
 *
 * SQLite holds collection rows. This holds the parts of a response that are
 * not rows: the pagination cursor, the category-name map, the row count (used
 * to decide whether a collection can render without touching the network), and
 * a last-synced timestamp.
 *
 * `localStorage` is used rather than SQLite because the values are tiny and
 * synchronous, and because `enabled` must be decided while a collection is
 * being configured. Like the SQLite cache, everything here is namespaced by the
 * token-derived user fingerprint and removed on sign out.
 */
export interface StoredEnvelope {
  /** Rows the last successful fetch produced. 0 means "do not assume a cache". */
  rows: number
  nextPage: string | null
  categoryMap: Record<string, string>
  syncedAt: number
}

const ENVELOPE_PREFIX = 'up:envelope:'
const SYNCED_PREFIX = 'up:synced:'

const listeners = new Set<() => void>()

/** Subscribe to writes so components can read this store reactively. */
export function subscribeStoredData(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Storage can throw when disabled by policy or in some private modes.
    return null
  }
}

function envelopeKey(uid: string, cacheKey: string): string {
  return `${ENVELOPE_PREFIX}${uid}:${cacheKey}`
}

export function readEnvelope(uid: string, cacheKey: string): StoredEnvelope | null {
  const raw = store()?.getItem(envelopeKey(uid, cacheKey))
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredEnvelope>
    if (typeof value?.rows !== 'number') return null
    return {
      rows: value.rows,
      nextPage: value.nextPage ?? null,
      categoryMap: value.categoryMap ?? {},
      syncedAt: value.syncedAt ?? 0,
    }
  } catch {
    return null
  }
}

export function writeEnvelope(uid: string, cacheKey: string, value: StoredEnvelope): void {
  try {
    store()?.setItem(envelopeKey(uid, cacheKey), JSON.stringify(value))
    emit()
  } catch {
    // A full or unavailable store just means no offline cache.
  }
}

export function readLastSynced(uid: string): number | null {
  const raw = store()?.getItem(`${SYNCED_PREFIX}${uid}`)
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? value : null
}

export function writeLastSynced(uid: string, at: number): void {
  try {
    store()?.setItem(`${SYNCED_PREFIX}${uid}`, String(at))
    emit()
  } catch {
    // Ignore.
  }
}

/** Remove everything for one user. Called on sign out alongside the SQLite wipe. */
export function clearStoredData(uid: string): void {
  const storage = store()
  if (!storage) return
  const envelope = `${ENVELOPE_PREFIX}${uid}:`
  const synced = `${SYNCED_PREFIX}${uid}`
  const doomed: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && (key.startsWith(envelope) || key === synced)) doomed.push(key)
  }
  for (const key of doomed) {
    try {
      storage.removeItem(key)
    } catch {
      // Ignore.
    }
  }
  if (doomed.length > 0) emit()
}
