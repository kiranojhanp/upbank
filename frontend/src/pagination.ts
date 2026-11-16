/**
 * Pure pagination helpers shared by the infinite-query hook and its tests.
 *
 * A page restored from local cache is marked `restored`. Its saved cursor is a
 * position in a live, newest-first list, so after an offline period the cursor
 * may point into a shifted window. In that case the next page is anchored to
 * the oldest cached transaction's timestamp instead.
 */
import type { Transaction } from './types'

export interface TransactionsPage {
  transactions: Transaction[]
  nextPage: string | null
  categoryMap?: Record<string, string>
  restored?: boolean
  oldestCreatedAt?: string | null
}

export type TransactionsPageParam = { cursor: string } | { until: string }

export interface TransactionsSeed {
  rows: Transaction[]
  nextPage: string | null
  categoryMap: Record<string, string>
  syncedAt: number
  oldestCreatedAt: string | null
}

/** Newest-first pages flattened, with the anchored page boundary deduplicated. */
export function dedupeTransactions(
  pages: ReadonlyArray<TransactionsPage> | undefined,
): Transaction[] {
  if (!pages) return []
  const seen = new Set<string>()
  const rows: Transaction[] = []
  for (const page of pages) {
    for (const transaction of page.transactions) {
      if (seen.has(transaction.id)) continue
      seen.add(transaction.id)
      rows.push(transaction)
    }
  }
  return rows
}

export function oldestCreatedAt(rows: ReadonlyArray<Transaction>): string | null {
  let oldest: string | null = null
  let oldestTime = Number.POSITIVE_INFINITY
  for (const transaction of rows) {
    const createdAt = transaction.attributes.createdAt
    const time = Date.parse(createdAt)
    if (!Number.isFinite(time) || time >= oldestTime) continue
    oldest = createdAt
    oldestTime = time
  }
  return oldest
}

export function categoryMapFromPages(
  pages: ReadonlyArray<TransactionsPage> | undefined,
): Record<string, string> {
  if (!pages) return {}
  for (const page of pages) {
    if (page.categoryMap && Object.keys(page.categoryMap).length > 0) return page.categoryMap
  }
  return {}
}

/** The page param Query should use after `lastPage`. */
export function nextTransactionsPageParam(
  lastPage: TransactionsPage,
): TransactionsPageParam | undefined {
  if (!lastPage.nextPage) return undefined
  if (lastPage.restored && lastPage.oldestCreatedAt) {
    return { until: lastPage.oldestCreatedAt }
  }
  return { cursor: lastPage.nextPage }
}
