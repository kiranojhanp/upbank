import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  type BrowserWASQLiteDatabase,
  type PersistedCollectionPersistence,
} from '@tanstack/browser-db-sqlite-persistence'

/**
 * Durable local cache for TanStack DB collections, backed by SQLite in OPFS.
 *
 * Rows are written through `persistedCollectionOptions`; see `db.ts`. The
 * database is named after the server-supplied user fingerprint, so two Up
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
const DB_SUFFIXES = ['', '-journal', '-wal'] as const

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
