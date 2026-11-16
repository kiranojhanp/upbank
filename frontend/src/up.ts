/**
 * Direct client for the Up Banking API.
 *
 * With no backend to proxy through, the browser talks to `api.up.com.au`
 * itself. Up's API answers with `Access-Control-Allow-Origin: *` and permits
 * the `authorization` header on preflight, so cross-origin requests work
 * without cookies. The bearer token comes from `auth.ts`.
 */
import { getToken } from './auth'
import type { Account, NextTransactionsResponse, Transaction, TransactionsResponse } from './types'

export const UP_API_BASE_URL = 'https://api.up.com.au/api/v1'

/** Thrown when Up rejects the token (401/403); signs the user out. */
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

export class RateLimitError extends ApiError {
  constructor(message = 'Up is rate limiting requests. Please wait a moment and try again.') {
    super(429, message)
    this.name = 'RateLimitError'
  }
}

interface UpError {
  errors?: { title?: string; detail?: string }[]
}

interface UpList<T> {
  data: T[]
  links?: { next: string | null } | null
}

const UP_API_ORIGIN = new URL(UP_API_BASE_URL).origin

/**
 * Never attach the bearer token to a URL outside Up's API origin.
 *
 * Request URLs mostly come from constants, but `links.next` is supplied by the
 * response body. Validating it before use means a malformed or tampered
 * response cannot redirect the user's token somewhere else, even if the CSP
 * `connect-src` allow-list is ever loosened.
 */
export function assertUpUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url, UP_API_BASE_URL)
  } catch {
    throw new ApiError(0, 'Invalid Up API URL')
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== UP_API_ORIGIN) {
    throw new ApiError(0, 'Refusing to send credentials to an unexpected origin')
  }
  return parsed.toString()
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) throw new SessionExpiredError()

  const target = assertUpUrl(url)
  let res: Response
  try {
    res = await fetch(target, {
      ...init,
      // No cookies: the bearer header is the whole credential, and Up replies
      // with `Access-Control-Allow-Origin: *`, which forbids credentialed CORS.
      credentials: 'omit',
      // Banking responses must not be written to the browser's HTTP cache.
      // The app keeps its own OPFS cache instead; see the README for its
      // at-rest limits.
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Could not reach Up. Check your connection and try again.')
  }

  if (res.status === 401 || res.status === 403) throw new SessionExpiredError()
  if (res.status === 429) throw new RateLimitError()
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as UpError
      message = body.errors?.[0]?.detail || body.errors?.[0]?.title || message
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Validate a token before storing it. Distinguishes a bad token from no network. */
export async function ping(token: string): Promise<void> {
  const target = assertUpUrl(`${UP_API_BASE_URL}/util/ping`)
  let res: Response
  try {
    res = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    throw new ApiError(0, 'Could not reach Up. Check your connection and try again.')
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(401, 'Invalid access token. Please check and try again.')
  }
  if (res.status === 429) throw new RateLimitError()
  if (!res.ok) throw new ApiError(res.status, 'Up API error')
}

/**
 * Follow Up's cursor pagination to completion. `links.next` is a full URL that
 * already carries the cursor and filters, so `params` apply to the first page
 * only.
 */
export async function fetchAllPages<T>(url: string, params?: Record<string, string>): Promise<T[]> {
  const results: T[] = []
  let next: string | null = url
  let first = true
  while (next) {
    const query = first && params ? `?${new URLSearchParams(params).toString()}` : ''
    const body: UpList<T> = await request<UpList<T>>(`${next}${query}`)
    results.push(...(body.data ?? []))
    next = body.links?.next ?? null
    first = false
  }
  return results
}

export function listAccounts(): Promise<Account[]> {
  return fetchAllPages<Account>(`${UP_API_BASE_URL}/accounts`)
}

export function getAccount(accountId: string): Promise<Account> {
  return request<{ data: Account }>(
    `${UP_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}`,
  ).then((body) => body.data)
}

interface Category {
  id: string
  attributes: { name: string }
}

export function listCategories(): Promise<Category[]> {
  return fetchAllPages<Category>(`${UP_API_BASE_URL}/categories`)
}

export async function accountTransactions(
  accountId: string,
  filters: { status?: string; since?: string; until?: string; category?: string; tag?: string },
): Promise<TransactionsResponse> {
  const params: Record<string, string> = { 'page[size]': '50' }
  if (filters.status) params['filter[status]'] = filters.status
  if (filters.since) params['filter[since]'] = filters.since
  if (filters.until) params['filter[until]'] = filters.until
  if (filters.category) params['filter[category]'] = filters.category
  if (filters.tag) params['filter[tag]'] = filters.tag

  const url = `${UP_API_BASE_URL}/accounts/${encodeURIComponent(accountId)}/transactions?${new URLSearchParams(
    params,
  ).toString()}`

  const [body, categories] = await Promise.all([
    request<UpList<Transaction>>(url),
    listCategories(),
  ])

  const categoryMap: Record<string, string> = {}
  for (const category of categories) categoryMap[category.id] = category.attributes.name

  return {
    transactions: body.data ?? [],
    nextPage: body.links?.next ?? null,
    categoryMap,
  }
}

/** Fetch the next page from a `links.next` URL returned by Up. */
export async function transactionsPage(url: string): Promise<NextTransactionsResponse> {
  const body = await request<UpList<Transaction>>(url)
  return {
    transactions: body.data ?? [],
    nextPage: body.links?.next ?? null,
  }
}
