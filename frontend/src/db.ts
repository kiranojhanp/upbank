import {
  DbClient,
  collectionOptions,
  type CollectionConfig,
  type UtilsRecord,
} from '@tanstack/react-db'
import { persistedCollectionOptions } from '@tanstack/browser-db-sqlite-persistence'
import { QueryCache, QueryClient, type QueryKey } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { useCallback, useSyncExternalStore } from 'react'
import { api } from './api'
import { clearStoredData, readEnvelope } from './envelopeStore'
import { SCHEMA_VERSION, type LocalCache } from './persistence'
import type { Account, Transaction, TransactionFilters, TransactionsResponse } from './types'

/**
 * Local-first with a durable, per-user cache.
 *
 * TanStack DB stays the reactive client store. When a `LocalCache` is supplied
 * (OPFS SQLite, see `persistence.ts`) every collection also writes its rows to
 * disk and restores them on the next load. Without one — unsupported browser,
 * private mode, tests — the store is in-memory only.
 *
 * `initialRender` uses a 0 ms network-first deadline: restored rows render
 * immediately. That is safe because `App` only mounts collections after
 * `GET /api/session` has confirmed the session, so cached rows are never shown
 * for a signed-out or revoked account.
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
 * immediately, and a fetch happens only on a manual refresh, on reconnect, or
 * when a webhook event says something changed. `enabled` is computed while the
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
function buildTransactionsDescriptor(accountId: string, filters: TransactionFilters, id: string) {
  return collectionOptions(id, (client) =>
    withPersistence(
      client,
      queryCollectionOptions({
        id,
        queryKey: [
          'transactions',
          accountId,
          filters.status ?? '',
          filters.since ?? '',
          filters.until ?? '',
        ],
        queryClient: client.requireDependency<QueryClient>('queryClient'),
        enabled: shouldFetchOnMount(client, id),
        // The query cache keeps the envelope; the collection only holds rows.
        // Only rows are persisted, so after a restore the envelope (cursor and
        // category names) is empty until the network query answers.
        queryFn: () => api.transactions(accountId, filters),
        select: (data: TransactionsResponse) => data.transactions,
        getKey: (transaction: Transaction) => transaction.id,
      }),
    ),
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
    descriptor = buildTransactionsDescriptor(accountId, filters, id)
    transactionDescriptors.set(id, descriptor)
  }

  return { id, descriptor, queryKey }
}

/**
 * Reads the collection envelope ({ transactions, nextPage, categoryMap }) from
 * the query cache, since `select` only projects the rows into the collection.
 * The query key is the same array instance the descriptor was built with.
 */
export function useTransactionsEnvelope(
  client: DbClient,
  key: QueryKey | undefined,
): TransactionsResponse | undefined {
  const queryClient = client.requireDependency<QueryClient>('queryClient')

  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  )

  const getSnapshot = useCallback(() => {
    if (!key) return undefined
    return queryClient.getQueryData<TransactionsResponse>(key)
  }, [queryClient, key])

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined)
}
