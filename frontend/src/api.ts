/**
 * Facade the UI and collections talk to. It wraps the direct Up client
 * (`up.ts`) and the local token lifecycle (`auth.ts`), keeping the same shape
 * the components used when a server proxied these calls.
 */
import { getToken, markVerified, setToken, uidForToken } from './auth'
import { csvFilename, transactionsToCsv } from './csv'
import { forgetUserData } from './persistence'
import { tokenInputError } from './security'
import type {
  Account,
  NextTransactionsResponse,
  Transaction,
  TransactionFilters,
  TransactionsResponse,
} from './types'
import {
  ApiError,
  RateLimitError,
  SessionExpiredError,
  UP_API_BASE_URL,
  accountTransactions,
  fetchAllPages,
  getAccount,
  listAccounts,
  listCategories,
  ping,
  transactionsPage,
} from './up'

export { ApiError, RateLimitError, SessionExpiredError }

export interface CsvDownload {
  blob: Blob
  filename: string
}

export const api = {
  /**
   * Validate the token against Up, then persist it. A bad token throws an
   * `ApiError` (status 401) so the login form can show the message.
   */
  async login(accessToken: string): Promise<{ ok: boolean; uid: string }> {
    const token = accessToken.trim()
    const invalid = tokenInputError(token)
    if (invalid) throw new ApiError(400, invalid)

    await ping(token)

    // Capture the previous token before overwriting it so its cache can be
    // removed rather than left orphaned on a shared device.
    const previousToken = getToken()
    setToken(token)
    // Login just pinged Up, so the token starts out verified.
    markVerified()

    const uid = await uidForToken(token)
    if (previousToken && previousToken !== token) {
      const previousUid = await uidForToken(previousToken)
      if (previousUid !== uid) await forgetUserData(previousUid)
    }
    return { ok: true, uid }
  },

  /**
   * Boot probe. `invalid` means Up rejected the stored token (sign out);
   * `unreachable` means a network failure, so the app still runs from cache.
   */
  async checkToken(): Promise<'valid' | 'invalid' | 'unreachable'> {
    const token = getToken()
    if (!token) return 'invalid'
    try {
      await ping(token)
      return 'valid'
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return 'invalid'
      return 'unreachable'
    }
  },

  async accounts(): Promise<{ accounts: Account[] }> {
    return { accounts: await listAccounts() }
  },

  transactions(
    accountId: string,
    filters: TransactionFilters,
  ): Promise<TransactionsResponse> {
    return accountTransactions(accountId, filters)
  },

  /**
   * Every transaction for one account, following Up's cursor to completion.
   * Used only by the explicit Load/Refresh from Up action in Mark Paid.
   */
  async allTransactions(
    accountId: string,
    filters: { since?: string; until?: string },
  ): Promise<Transaction[]> {
    const params: Record<string, string> = { 'page[size]': '100' }
    if (filters.since) params['filter[since]'] = filters.since
    if (filters.until) params['filter[until]'] = filters.until
    return fetchAllPages<Transaction>(
      `${UP_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/transactions`,
      params,
    )
  },

  /**
   * Fetch the page immediately older than `until`. Used only when a cursor was
   * restored from cache and may point into a list that has shifted since.
   */
  transactionsUntil(
    accountId: string,
    filters: TransactionFilters,
    until: string,
  ): Promise<TransactionsResponse> {
    return accountTransactions(accountId, { ...filters, until })
  },

  /** Fetch a page from a `links.next` URL returned by Up. */
  nextTransactions(url: string): Promise<NextTransactionsResponse> {
    return transactionsPage(url)
  },

  /**
   * Build a CSV of an account's transactions in the browser. Only the date
   * range is sent, so the file spans the whole account unless `since`/`until`
   * are set. Every page is fetched from Up so the export is complete.
   */
  async exportTransactionsCsv(
    accountId: string,
    filters: TransactionFilters,
  ): Promise<CsvDownload> {
    const params: Record<string, string> = { 'page[size]': '100' }
    if (filters.since) params['filter[since]'] = filters.since
    if (filters.until) params['filter[until]'] = filters.until

    const [transactions, categories, account] = await Promise.all([
      fetchAllPages<Transaction>(
        `${UP_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/transactions`,
        params,
      ),
      listCategories(),
      getAccount(accountId),
    ])

    const categoryMap: Record<string, string> = {}
    for (const category of categories) categoryMap[category.id] = category.attributes.name

    return {
      blob: new Blob([transactionsToCsv(transactions, categoryMap)], {
        type: 'text/csv;charset=utf-8',
      }),
      filename: csvFilename(account.attributes.displayName),
    }
  },
}
