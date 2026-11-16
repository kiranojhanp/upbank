import {
  DbClient,
  collectionOptions,
  localOnlyCollectionOptions,
  type CollectionConfig,
  type UtilsRecord,
} from '@tanstack/react-db'
import { persistedCollectionOptions } from '@tanstack/browser-db-sqlite-persistence'
import { QueryCache, QueryClient, type QueryKey } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { api } from './api'
import { clearStoredData, readEnvelope } from './envelopeStore'
import { SCHEMA_VERSION, type LocalCache } from './persistence'
import type { Account, Transaction, TransactionFilters } from './types'

/**
 * Local-first with a durable, per-user cache.
 *
 * TanStack DB stays the reactive client store. When a `LocalCache` is supplied
 * (OPFS SQLite, see `persistence.ts`) every collection also writes its rows to
 * disk and restores them on the next load. Without one — unsupported browser,
 * private mode, tests — the store is in-memory only.
 *
 * `initialRender` uses a 0 ms network-first deadline: restored rows render
 * immediately. That is safe because `App` only mounts collections once the
 * stored token has passed its boot probe, so cached rows are never shown for a
 * signed-out or revoked account.
 */

/** Degrades to the plain in-memory config when no cache is attached. */
function withPersistence<T extends object, TKey extends string | number, U extends UtilsRecord>(
  client: DbClient,
  options: CollectionConfig<T, TKey, never, U>,
): CollectionConfig<T, TKey, never, U> {
  const persistence = client.getDependency<LocalCache['persistence'] | null>('persistence')
  if (!persistence) return options

  const persisted = persistedCollectionOptions<T, TKey, never, U>({
    ...options,
    persistence,
    schemaVersion: SCHEMA_VERSION,
    initialRender: { strategy: 'network-first', networkTimeoutMs: 0 },
  })
  return persisted as unknown as CollectionConfig<T, TKey, never, U>
}

/**
 * Offline-first fetching.
 *
 * A collection only fetches on mount when there is no cached copy to render.
 * With a stored copy (`rows > 0`) the sync is disabled, restored rows render
 * immediately, and a fetch happens only on a manual refresh, on reconnect, on
 * tab focus, or from the visible-tab poll. `enabled` is computed while the
 * collection is configured, which is why it reads the metadata synchronously.
 */
export function shouldFetchOnMount(client: DbClient, cacheKey: string): boolean {
  const persistence = client.getDependency<LocalCache['persistence'] | null>('persistence')
  if (!persistence) return true

  const uid = client.getDependency<string>('uid')
  if (!uid) return true

  const stored = readEnvelope(uid, cacheKey)
  return !(stored && stored.rows > 0)
}

export interface SessionClient {
  db: DbClient
  queryClient: QueryClient
  uid: string
  cache: LocalCache | null
  onError: (listener: (error: unknown) => void) => () => void
  /** Tear down the store. `wipe` also deletes this user's cached rows. */
  dispose: (options?: { wipe?: boolean }) => Promise<void>
}

export function createSessionClient(uid: string, cache: LocalCache | null = null): SessionClient {
  const listeners = new Set<(error: unknown) => void>()

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        for (const listener of listeners) listener(error)
      },
    }),
    defaultOptions: {
      queries: {
        // A banking client should re-read from the server rather than trust a
        // stale local copy. gcTime 0 also means rows leave the query cache as
        // soon as nothing is observing them.
        retry: false,
        staleTime: 0,
        gcTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
    },
  })

  return {
    db: new DbClient({ queryClient, persistence: cache?.persistence ?? null, uid }),
    queryClient,
    uid,
    cache,
    onError(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async dispose({ wipe = false } = {}) {
      queryClient.clear()
      if (wipe) clearStoredData(uid)
      if (!cache) return
      if (wipe) await cache.wipe()
      else await cache.dispose()
    },
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export type AccountRow = Account & { sortIndex: number }

export const accountsDescriptor = collectionOptions('accounts', (client) =>
  withPersistence(
    client,
    queryCollectionOptions<AccountRow>({
      id: 'accounts',
      queryKey: ['accounts'],
      queryClient: client.requireDependency<QueryClient>('queryClient'),
      enabled: shouldFetchOnMount(client, 'accounts'),
      queryFn: async () => {
        const { accounts } = await api.accounts()
        // Keep the server's ordering so card colours stay stable.
        return accounts.map((account, sortIndex) => ({ ...account, sortIndex }))
      },
      getKey: (account) => account.id,
    }),
  ),
)

// ---------------------------------------------------------------------------
// Transactions (one descriptor per account + filter combination)
// ---------------------------------------------------------------------------
/**
 * Rows are loaded by `useTransactionsInfinite` (TanStack Query's infinite
 * query) and mirrored here for offline rendering. The collection has no sync
 * of its own: it is a persisted row store, not a paging source.
 */
function buildTransactionsDescriptor(id: string) {
  return collectionOptions(
    id,
    (client): CollectionConfig<Transaction, string, never, UtilsRecord> => {
      const base = {
        id,
        getKey: (transaction: Transaction) => transaction.id,
      }
      const persistence = client.getDependency<LocalCache['persistence'] | null>(
        'persistence',
      )

      // No persistence (unsupported browser, tests): a local-only collection
      // is still ready immediately and accepts direct writes.
      if (!persistence) {
        return localOnlyCollectionOptions<Transaction, string>(
          base,
        ) as unknown as CollectionConfig<Transaction, string, never, UtilsRecord>
      }

      // With persistence, the local-only overload adds a loopback sync and
      // persists direct writes. `initialRender` hydrates restored rows first.
      const persisted = persistedCollectionOptions<Transaction, string, never, UtilsRecord>({
        ...base,
        persistence,
        schemaVersion: SCHEMA_VERSION,
        initialRender: { strategy: 'network-first', networkTimeoutMs: 0 },
      } as Parameters<
        typeof persistedCollectionOptions<Transaction, string, never, UtilsRecord>
      >[0])
      return persisted as unknown as CollectionConfig<Transaction, string, never, UtilsRecord>
    },
  )
}

const transactionDescriptors = new Map<
  string,
  ReturnType<typeof buildTransactionsDescriptor>
>()

export interface TransactionsDescriptor {
  id: string
  descriptor: ReturnType<typeof buildTransactionsDescriptor>
  queryKey: QueryKey
}

export function getTransactionsDescriptor(
  accountId: string,
  filters: TransactionFilters,
): TransactionsDescriptor {
  const id = `transactions:${accountId}:${filters.status ?? ''}:${filters.since ?? ''}:${filters.until ?? ''}`
  const queryKey: QueryKey = [
    'transactions',
    accountId,
    filters.status ?? '',
    filters.since ?? '',
    filters.until ?? '',
  ]

  let descriptor = transactionDescriptors.get(id)
  if (!descriptor) {
    descriptor = buildTransactionsDescriptor(id)
    transactionDescriptors.set(id, descriptor)
  }

  return { id, descriptor, queryKey }
}
