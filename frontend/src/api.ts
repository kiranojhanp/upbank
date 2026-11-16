/**
 * Facade the UI and collections talk to. It wraps the direct Up client
 * (`up.ts`) and the local token lifecycle (`auth.ts`), keeping the same shape
 * the components used when a server proxied these calls.
 */
import { clearToken, getToken, markVerified, setToken, uidForToken } from './auth'
import { csvFilename, transactionsToCsv } from './csv'
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
    await ping(accessToken)
    setToken(accessToken)
    // Login just pinged Up, so the token starts out verified.
    markVerified()
    return { ok: true, uid: await uidForToken(accessToken) }
  },

  logout(): void {
    clearToken()
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
