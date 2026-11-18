/**
 * Infinite transaction query.
 *
 * TanStack Query owns the cursor sequence, page freshness and refetching. The
 * rest of the app mirrors these pages into the persisted TanStack DB
 * collection so a cold start can restore them offline.
 */
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/query-core'
import { ApiError, RateLimitError, api } from './api'
import type { TransactionFilters } from './types'
import {
  categoryMapFromPages,
  dedupeTransactions,
  nextTransactionsPageParam,
  oldestCreatedAt,
  type TransactionsPage,
  type TransactionsPageParam,
  type TransactionsSeed,
} from './pagination'

export interface UseTransactionsInfiniteOptions {
  accountId: string
  filters: TransactionFilters
  queryKey: QueryKey
  seed: TransactionsSeed | null
  online: boolean
}

function retry(failureCount: number, error: unknown): boolean {
  if (error instanceof RateLimitError) return failureCount < 3
  if (error instanceof ApiError && error.status === 0) return failureCount < 2
  return false
}

function retryDelay(failureCount: number, error: unknown): number {
  const base = error instanceof RateLimitError ? 4_000 : 1_000
  const backoff = Math.min(base * 2 ** failureCount, 20_000)
  // Jitter avoids several tabs retrying on the same beat.
  return backoff + Math.floor(Math.random() * 500)
}

export function useTransactionsInfinite({
  accountId,
  filters,
  queryKey,
  seed,
  online,
}: UseTransactionsInfiniteOptions) {
  const hasSeed = Boolean(seed && seed.rows.length > 0)

  const initialData: InfiniteData<TransactionsPage, TransactionsPageParam | null> | undefined =
    hasSeed && seed
      ? {
          pages: [
            {
              transactions: seed.rows,
              nextPage: seed.nextPage,
              categoryMap: seed.categoryMap,
              restored: true,
              oldestCreatedAt: seed.oldestCreatedAt ?? oldestCreatedAt(seed.rows),
            },
          ],
          pageParams: [null],
        }
      : undefined

  const query = useInfiniteQuery<
    TransactionsPage,
    Error,
    InfiniteData<TransactionsPage>,
    QueryKey,
    TransactionsPageParam | null
  >({
    queryKey,
    queryFn: ({ pageParam }) => {
      if (pageParam && 'until' in pageParam) {
        return api.transactionsUntil(accountId, filters, pageParam.until)
      }
      if (pageParam && 'cursor' in pageParam) {
        return api.nextTransactions(pageParam.cursor)
      }
      return api.transactions(accountId, filters)
    },
    initialPageParam: null,
    getNextPageParam: nextTransactionsPageParam,
    // The query itself renders a warm cache without a network request. The view
    // revalidates a restored page once online, and explicit/background syncs
    // call refetch() while keeping the loaded page count.
    enabled: online || hasSeed,
    staleTime: hasSeed ? Infinity : 0,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: 'always',
    retry,
    retryDelay,
    ...(initialData ? { initialData, initialDataUpdatedAt: seed?.syncedAt } : {}),
  })

  return {
    query,
    rows: dedupeTransactions(query.data?.pages),
    categoryMap: categoryMapFromPages(query.data?.pages) ?? seed?.categoryMap ?? {},
  }
}
