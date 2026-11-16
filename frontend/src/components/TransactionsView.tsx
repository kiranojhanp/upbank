import type { Collection } from '@tanstack/db'
import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { SessionExpiredError } from '../api'
import {
  readLastSynced,
  writeEnvelope,
  writeLastSynced,
} from '../envelopeStore'
import { groupByDate } from '../format'
import type { Transaction, TransactionFilters } from '../types'
import {
  categoryMapFromPages,
  dedupeTransactions,
  oldestCreatedAt,
  type TransactionsSeed,
} from '../pagination'
import { useTransactionsInfinite } from '../useTransactionsInfinite'
import { DetailPanel } from './DetailPanel'
import { TransactionItem } from './TransactionItem'

export interface TransactionsHandle {
  /** Refetch all currently loaded pages, preserving the page count. */
  refresh: () => Promise<void>
}

interface TransactionsViewProps {
  uid: string
  cacheKey: string
  accountId: string
  filters: TransactionFilters
  collection: Collection<Transaction, string>
  seed: TransactionsSeed | null
  online: boolean
  isJoint: boolean
  onSessionExpired: () => void
  onNotify: (label: string, detail?: string) => void
}

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export const TransactionsView = forwardRef<TransactionsHandle, TransactionsViewProps>(
  function TransactionsView(
    {
      uid,
      cacheKey,
      accountId,
      filters,
      collection,
      seed,
      online,
      isJoint,
      onSessionExpired,
      onNotify,
    },
    ref,
  ) {
    const { query, rows, categoryMap } = useTransactionsInfinite({
      accountId,
      filters,
      queryKey: ['transactions', accountId, filters.status ?? '', filters.since ?? '', filters.until ?? ''],
      seed,
      online,
    })
    const [panelTransaction, setPanelTransaction] = useState<Transaction | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        refresh: async () => {
          await query.refetch({ throwOnError: true })
        },
      }),
      [query],
    )

    useEffect(() => {
      if (query.error instanceof SessionExpiredError) onSessionExpired()
    }, [query.error, onSessionExpired])

    // Mirror what Query has loaded into the persisted collection. A refetch
    // replaces the page sequence, so rows no longer in it are deleted. Writes
    // are serialized so a fast "load more" cannot interleave with a refetch.
    const syncTail = useRef<Promise<void>>(Promise.resolve())
    useEffect(() => {
      if (!query.data) return

      const pages = query.data.pages
      const merged = dedupeTransactions(pages)
      const lastPage = pages[pages.length - 1]
      const syncedAt = query.dataUpdatedAt || readLastSynced(uid) || Date.now()
      let cancelled = false

      const run = async () => {
        if (cancelled) return
        const current = new Map(
          collection.toArray.map((transaction) => [transaction.id, transaction]),
        )
        const next = new Map(merged.map((transaction) => [transaction.id, transaction]))
        const deleteIds: string[] = []
        const insertRows: Transaction[] = []
        // Collection rows carry virtual fields; compare only Up's payload.
        const comparable = (transaction: Transaction) =>
          JSON.stringify({
            attributes: transaction.attributes,
            relationships: transaction.relationships,
          })

        for (const [id, transaction] of current) {
          const replacement = next.get(id)
          if (!replacement || comparable(replacement) !== comparable(transaction)) {
            deleteIds.push(id)
          }
        }
        for (const [id, transaction] of next) {
          const existing = current.get(id)
          if (!existing || comparable(existing) !== comparable(transaction)) {
            insertRows.push(transaction)
          }
        }

        try {
          // Local-only collections have no writeUpsert; delete changed rows and
          // reinsert them so an updated status/amount is mirrored too.
          if (deleteIds.length > 0) await collection.delete(deleteIds).when('settled')
          if (cancelled) return
          if (insertRows.length > 0) await collection.insert(insertRows).when('settled')
          if (cancelled) return
          writeEnvelope(uid, cacheKey, {
            rows: merged.length,
            nextPage: lastPage?.nextPage ?? null,
            categoryMap: categoryMapFromPages(pages),
            syncedAt,
            oldestCreatedAt: oldestCreatedAt(merged),
          })
          if (merged.length > 0) writeLastSynced(uid, syncedAt)
        } catch (error) {
          onNotify('Could not update the offline cache', errorDetail(error))
        }
      }

      syncTail.current = syncTail.current.catch(() => {}).then(run)
      return () => {
        cancelled = true
      }
    }, [query.data, query.dataUpdatedAt, collection, uid, cacheKey, onNotify])

    const grouped = useMemo(() => groupByDate(rows), [rows])
    const loading = query.isPending && rows.length === 0
    const initialError = query.isError && rows.length === 0
    const showingCached = !online && rows.length > 0
    const syncFailed = query.isError && rows.length > 0
    const offlineNoCache = !online && rows.length === 0 && !query.isFetching

    async function handleLoadMore() {
      if (!query.hasNextPage || query.isFetchingNextPage || !online) return
      try {
        await query.fetchNextPage({ cancelRefetch: false, throwOnError: true })
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          onSessionExpired()
          return
        }
        onNotify('Could not load more transactions', errorDetail(error))
      }
    }

    if (initialError || offlineNoCache) {
      return (
        <div className="transactions-error">
          <p className="login-error">
            {offlineNoCache
              ? 'You are offline and no cached transactions are available for this account and filter.'
              : 'Could not load transactions.'}
          </p>
          {!offlineNoCache && errorDetail(query.error) && (
            <p className="transactions-error-detail">{errorDetail(query.error)}</p>
          )}
          <button
            type="button"
            className="load-more-btn"
            disabled={!online}
            onClick={() => void query.refetch().catch(() => {})}
          >
            Try again
          </button>
        </div>
      )
    }

    if (loading) {
      return <p className="loading-text">Loading…</p>
    }

    return (
      <>
        {(showingCached || syncFailed) && (
          <p className="offline-note">
            {showingCached
              ? 'Offline — showing saved transactions.'
              : 'Could not sync — showing saved transactions.'}
          </p>
        )}

        <div id="transaction-list" className="transaction-list">
          {grouped.length === 0 ? (
            <p className="loading-text">No transactions found.</p>
          ) : (
            grouped.map(({ date, items }) => (
              <Fragment key={date}>
                <div className="transaction-date-header">{date}</div>
                {items.map((transaction: Transaction) => (
                  <TransactionItem
                    key={transaction.id}
                    transaction={transaction}
                    categoryMap={categoryMap}
                    isJoint={isJoint}
                    onOpen={setPanelTransaction}
                  />
                ))}
              </Fragment>
            ))
          )}
        </div>

        {query.hasNextPage && (
          <div className="load-more-container">
            <button
              id="load-more-btn"
              className="load-more-btn"
              onClick={() => void handleLoadMore()}
              disabled={query.isFetchingNextPage || !online}
              title={online ? undefined : 'Unavailable offline'}
            >
              {query.isFetchingNextPage
                ? 'Loading…'
                : online
                  ? 'Load more'
                  : 'Load more (offline)'}
            </button>
            {query.isFetchNextPageError && (
              <p className="load-more-error">Could not load the next page.</p>
            )}
          </div>
        )}

        <DetailPanel
          transaction={panelTransaction}
          categoryMap={categoryMap}
          isJoint={isJoint}
          onClose={() => setPanelTransaction(null)}
        />
      </>
    )
  },
)
