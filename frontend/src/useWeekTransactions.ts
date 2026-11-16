import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { SessionExpiredError, api } from './api'
import { addDaysIso, localDateIso } from './budget'
import type { Account, Transaction } from './types'
import type { WeekTransaction } from './week'

interface UseWeekTransactionsOptions {
  accounts: Account[]
  weekStart: string
  weekEnd: string
  online: boolean
  onSessionExpired: () => void
}

function toWeekTransaction(
  transaction: Transaction,
  account: Account,
): WeekTransaction | null {
  const amount = transaction.attributes.amount?.valueInBaseUnits
  // Budgeting is about outflows. Credits such as salary or refunds are not
  // attachable expenses, so they never enter the week list.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount >= 0) return null
  return {
    id: transaction.id,
    description: transaction.attributes.description || 'Transaction',
    createdAt: transaction.attributes.createdAt,
    amountCents: -amount,
    accountName: account.attributes.displayName,
    status: transaction.attributes.status,
  }
}

/**
 * Every debit transaction in the week across all Up accounts.
 *
 * The query is week-scoped and cached for a few minutes; changing week or
 * coming back to the tab re-reads it. Offline, entries and attachment ids are
 * still available, but transaction details cannot be shown until Up is
 * reachable again.
 */
export function useWeekTransactions({
  accounts,
  weekStart,
  weekEnd,
  online,
  onSessionExpired,
}: UseWeekTransactionsOptions) {
  const accountKey = accounts
    .map((account) => account.id)
    .sort()
    .join(',')

  const query = useQuery<WeekTransaction[], Error>({
    queryKey: ['week-transactions', weekStart, weekEnd, accountKey],
    queryFn: async () => {
      // Ask for one day of padding on each side, then trim by local date below.
      // Up's date filters may be interpreted in UTC; padding keeps a Wednesday
      // 00:05 purchase in the new week (and the last Tuesday evening in the
      // old one) regardless of timezone.
      const apiSince = addDaysIso(weekStart, -1)
      const apiUntil = addDaysIso(weekEnd, 1)
      const perAccount = await Promise.all(
        accounts.map(async (account) => {
          const transactions = await api.allTransactions(account.id, {
            since: apiSince,
            until: apiUntil,
          })
          return transactions
            .map((transaction) => toWeekTransaction(transaction, account))
            .filter((transaction): transaction is WeekTransaction => transaction !== null)
        }),
      )

      const seen = new Set<string>()
      const merged: WeekTransaction[] = []
      for (const transaction of perAccount.flat()) {
        const day = localDateIso(new Date(transaction.createdAt))
        if (day < weekStart || day > weekEnd) continue
        if (seen.has(transaction.id)) continue
        seen.add(transaction.id)
        merged.push(transaction)
      }
      return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    enabled: online && accounts.length > 0,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    networkMode: 'always',
  })

  useEffect(() => {
    if (query.error instanceof SessionExpiredError) onSessionExpired()
  }, [query.error, onSessionExpired])

  return {
    transactions: query.data ?? null,
    loading: online && accounts.length > 0 && query.isPending,
    fetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  }
}
