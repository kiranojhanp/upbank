import type {
  AccountsResponse,
  EventsResponse,
  NextTransactionsResponse,
  TransactionFilters,
  TransactionsResponse,
} from './types'

export class SessionExpiredError extends Error {
  constructor() {
    super('session_expired')
    this.name = 'SessionExpiredError'
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(
  url: string,
  init?: RequestInit,
  sessionAware = true,
): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })

  if (res.status === 401 && sessionAware) throw new SessionExpiredError()
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      message = body.error || body.detail || message
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function transactionQuery(filters: TransactionFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.since) params.set('since', new Date(filters.since).toISOString())
  if (filters.until) params.set('until', new Date(`${filters.until}T23:59:59`).toISOString())
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export interface SessionInfo {
  authenticated: boolean
  /** Stable, non-reversible fingerprint used to scope the local cache. */
  uid: string
  expiresAt: number
  /** False when Up could not be reached; the session itself is still valid. */
  verified: boolean
}

export const api = {
  login(accessToken: string) {
    return request<{ ok: boolean; uid: string; expiresAt: number }>(
      '/api/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      },
      false,
    )
  },

  /** Boot probe. 401s when there is no valid session. */
  session() {
    return request<SessionInfo>('/api/session')
  },

  logout() {
    return request<{ ok: boolean }>('/api/logout', { method: 'POST' })
  },

  accounts() {
    return request<AccountsResponse>('/api/accounts')
  },

  transactions(accountId: string, filters: TransactionFilters) {
    return request<TransactionsResponse>(
      `/api/accounts/${encodeURIComponent(accountId)}/transactions${transactionQuery(filters)}`,
    )
  },

  nextTransactions(cursor: string) {
    return request<NextTransactionsResponse>(
      `/api/transactions/next?cursor=${encodeURIComponent(cursor)}`,
    )
  },

  events() {
    return request<EventsResponse>('/api/events')
  },
}
