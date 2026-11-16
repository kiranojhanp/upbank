import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  type BrowserWASQLiteDatabase,
  type PersistedCollectionPersistence,
} from '@tanstack/browser-db-sqlite-persistence'
import { clearStoredData } from './envelopeStore'

/**
 * Durable local cache for TanStack DB collections, backed by SQLite in OPFS.
 *
 * Rows are written through `persistedCollectionOptions`; see `db.ts`. The
 * database is named after the token-derived user fingerprint, so two Up
 * accounts on the same browser never read each other's rows. Signing out
 * removes the database.
 *
 * If OPFS or workers are unavailable (happy-dom in tests, Safari private mode,
 * very old browsers) `openLocalCache` returns null and the app falls back to
 * the in-memory store it had before.
 */
export interface LocalCache {
  readonly uid: string
  readonly persistence: PersistedCollectionPersistence
  /** Stop SQLite and release the OPFS access handles. Keeps the stored rows. */
  dispose(): Promise<void>
  /** Dispose, then delete this user's rows from OPFS. */
  wipe(): Promise<void>
}

export const SCHEMA_VERSION = 1

const DB_PREFIX = 'up-cache-'
// Remove every sidecar SQLite may create. A shared-memory file left behind can
// keep rows recoverable even after the main database is gone.
const DB_SUFFIXES = ['', '-journal', '-wal', '-shm'] as const

function databaseFileName(uid: string): string {
  return `${DB_PREFIX}${uid}.sqlite`
}

function opfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/**
 * Ask the browser to keep this origin's storage from being evicted under disk
 * pressure. Best-effort: some browsers grant it silently, others ignore it.
 */
async function requestPersistentStorage(): Promise<void> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.persist) return
  try {
    if (storage.persisted && (await storage.persisted())) return
    await storage.persist()
  } catch (error) {
    console.warn('[local cache] could not request persistent storage', error)
  }
}

/** Refuse to attach the cache when the origin is nearly out of room. */
async function hasRoomForCache(): Promise<boolean> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage?.estimate) return true
  try {
    const { usage, quota } = await storage.estimate()
    if (!quota || usage === undefined) return true
    return usage / quota < 0.95
  } catch {
    return true
  }
}

/**
 * True when an error means the browser's storage quota was exceeded. Unwraps
 * the persistence layer's `PersistedCollectionDurabilityError`, which carries
 * the original failure on `cause`.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: string; message?: string; cause?: unknown }
  if (candidate.name === 'QuotaExceededError') return true
  if (typeof candidate.message === 'string' && /quota/i.test(candidate.message)) return true
  if (candidate.cause && candidate.cause !== error) return isQuotaExceededError(candidate.cause)
  return false
}

/**
 * Surface quota failures from the persistence layer's background writes, which
 * would otherwise appear only as unhandled rejections. The cache keeps whatever
 * was already stored; nothing crashes.
 */
export function installStorageGuards(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', (event) => {
    if (isQuotaExceededError(event.reason)) {
      console.warn('[local cache] storage quota exceeded; the local cache may be incomplete')
    }
  })
}

async function removeDatabaseFiles(uid: string): Promise<void> {
  if (!opfsSupported()) return
  const name = databaseFileName(uid)
  try {
    const root = await navigator.storage.getDirectory()
    for (const suffix of DB_SUFFIXES) {
      try {
        await root.removeEntry(name + suffix)
      } catch {
        // Already gone, or held open by another tab. Nothing to do.
      }
    }
  } catch (error) {
    console.warn('[local cache] could not delete stored rows', error)
  }
}

const openCaches = new Map<string, Promise<LocalCache | null>>()

async function open(uid: string): Promise<LocalCache | null> {
  if (!opfsSupported()) return null

  // Don't attach a cache we have no room to write to; a failed write would
  // surface as a durability error later. Fall back to memory instead.
  if (!(await hasRoomForCache())) {
    console.warn('[local cache] origin storage nearly full, using memory only')
    return null
  }
  await requestPersistentStorage()

  const name = databaseFileName(uid)
  let database: BrowserWASQLiteDatabase
  try {
    database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: name,
      timeoutMs: 10_000,
    })
  } catch (error) {
    console.warn('[local cache] OPFS unavailable, using memory only', error)
    return null
  }

  // Web Locks + BroadcastChannel keep the same database safe across tabs.
  const coordinator = new BrowserCollectionCoordinator({ dbName: `${DB_PREFIX}${uid}` })
  const persistence = createBrowserWASQLitePersistence({ database, coordinator })

  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    try {
      await database.close?.()
    } catch (error) {
      console.warn('[local cache] error closing SQLite', error)
    }
    coordinator.dispose()
    openCaches.delete(uid)
  }

  return {
    uid,
    persistence,
    dispose,
    async wipe() {
      await dispose()
      await removeDatabaseFiles(uid)
    },
  }
}

/**
 * Open (or reuse) the cache for a user. Concurrent calls for the same uid share
 * one database, which matters because React StrictMode mounts effects twice.
 */
export function openLocalCache(uid: string): Promise<LocalCache | null> {
  const existing = openCaches.get(uid)
  if (existing) return existing

  const pending = open(uid).catch((error) => {
    openCaches.delete(uid)
    console.warn('[local cache] failed to open, using memory only', error)
    return null
  })
  openCaches.set(uid, pending)
  return pending
}

/**
 * Delete all locally stored data for one token fingerprint without requiring a
 * live session. Used when a token is rejected, replaced, or signed out, so the
 * rows of an unusable session cannot linger on the device.
 */
export async function forgetUserData(uid: string): Promise<void> {
  const pending = openCaches.get(uid)
  if (pending) {
    const cache = await pending.catch(() => null)
    if (cache) await cache.dispose()
  }
  clearStoredData(uid)
  await removeDatabaseFiles(uid)
}
