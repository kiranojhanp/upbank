import type { Page, Route } from '@playwright/test'

export const VALID_TOKEN = 'pat-e2e'
const API_ORIGIN = 'https://api.up.com.au'

const ACCOUNTS = [
  {
    id: 'acc-spending',
    type: 'accounts',
    attributes: {
      displayName: 'Spending',
      accountType: 'TRANSACTIONAL',
      ownershipType: 'INDIVIDUAL',
      balance: { value: '1234.56', currencyCode: 'AUD' },
      createdAt: '2025-01-01T00:00:00Z',
    },
  },
  {
    id: 'acc-joint',
    type: 'accounts',
    attributes: {
      displayName: 'Joint',
      accountType: 'SAVER',
      ownershipType: 'JOINT',
      balance: { value: '500.00', currencyCode: 'AUD' },
      createdAt: '2025-01-01T00:00:00Z',
    },
  },
]

const CATEGORIES = [
  { id: 'cat-eating', type: 'categories', attributes: { name: 'Eating out' } },
  { id: 'cat-groceries', type: 'categories', attributes: { name: 'Groceries' } },
  { id: 'cat-income', type: 'categories', attributes: { name: 'Income' } },
]

const COFFEE = {
  id: 'tx-coffee',
  type: 'transactions',
  attributes: {
    description: 'Coffee',
    message: 'Morning coffee',
    createdAt: '2026-11-05T08:00:00Z',
    settledAt: '2026-11-05T08:00:01Z',
    status: 'SETTLED',
    amount: { value: '-5.50', currencyCode: 'AUD', valueInBaseUnits: -550 },
    foreignAmount: { value: '-3.50', currencyCode: 'USD' },
    roundUp: { amount: { value: '-0.50', currencyCode: 'AUD' } },
    cashback: { amount: { value: '0.10', currencyCode: 'AUD' } },
    cardPurchaseMethod: { method: 'CARD_PIN' },
    rawText: 'SQ *COFFEE',
  },
  relationships: {
    category: { data: { id: 'cat-eating' } },
    tags: { data: [{ id: 'Holiday' }] },
  },
}

const GROCERIES = {
  id: 'tx-groceries',
  type: 'transactions',
  attributes: {
    description: 'Weekly shop',
    createdAt: '2026-11-04T09:00:00Z',
    settledAt: '2026-11-04T09:00:01Z',
    status: 'SETTLED',
    amount: { value: '-42.10', currencyCode: 'AUD', valueInBaseUnits: -4210 },
  },
  relationships: { category: { data: { id: 'cat-groceries' } } },
}

const SALARY = {
  id: 'tx-salary',
  type: 'transactions',
  attributes: {
    description: 'Salary',
    createdAt: '2026-11-03T09:00:00Z',
    settledAt: '2026-11-03T09:00:01Z',
    status: 'SETTLED',
    amount: { value: '2000.00', currencyCode: 'AUD', valueInBaseUnits: 200000 },
  },
  relationships: { category: { data: { id: 'cat-income' } } },
}

const PENDING = {
  id: 'tx-pending',
  type: 'transactions',
  attributes: {
    description: 'Pending coffee',
    createdAt: '2026-11-06T09:00:00Z',
    status: 'HELD',
    amount: { value: '-6.00', currencyCode: 'AUD', valueInBaseUnits: -600 },
  },
  relationships: { category: { data: { id: 'cat-eating' } } },
}

// Exercises the CSV formula-injection guard.
const FORMULA = {
  id: 'tx-formula',
  type: 'transactions',
  attributes: {
    description: '=SUM(A1)',
    createdAt: '2026-11-02T09:00:00Z',
    settledAt: '2026-11-02T09:00:01Z',
    status: 'SETTLED',
    amount: { value: '-1.00', currencyCode: 'AUD', valueInBaseUnits: -100 },
  },
}

const OLDER_COFFEE = {
  id: 'tx-older-coffee',
  type: 'transactions',
  attributes: {
    description: 'Older coffee',
    createdAt: '2026-11-01T09:00:00Z',
    settledAt: '2026-11-01T09:00:01Z',
    status: 'SETTLED',
    amount: { value: '-4.00', currencyCode: 'AUD', valueInBaseUnits: -400 },
  },
  relationships: { category: { data: { id: 'cat-eating' } } },
}

const INTERNET_PAYMENT = {
  id: 'tx-internet',
  type: 'transactions',
  attributes: {
    description: 'Internet payment',
    createdAt: '2026-11-27T09:00:00Z',
    settledAt: '2026-11-27T09:00:01Z',
    status: 'SETTLED',
    amount: { value: '-75.00', currencyCode: 'AUD', valueInBaseUnits: -7500 },
  },
}

const FIRST_PAGE = [COFFEE, GROCERIES, SALARY, PENDING, FORMULA, INTERNET_PAYMENT]
const SECOND_PAGE = [OLDER_COFFEE]

const NEXT_PAGE_URL =
  `${API_ORIGIN}/api/v1/accounts/acc-spending/transactions?page%5Bafter%5D=cursor-2&page%5Bsize%5D=50`

const JSON_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
  'content-type': 'application/json',
}

function list<T>(data: T[], next: string | null = null) {
  return { data, links: { next } }
}

/**
 * Stateful fake of the Up API. It installs a route for the real API origin, so
 * the production bundle runs unmodified and the service worker still ignores
 * cross-origin traffic.
 */
export class MockUpApi {
  validToken = VALID_TOKEN
  rejectAllPings = false
  unauthorized = false
  failAccounts = false
  failNextPage = false
  requests: URL[] = []
  transactionRequests: URL[] = []

  async install(page: Page): Promise<void> {
    await page.route(`${API_ORIGIN}/**`, (route) => this.handle(route))
  }

  get anchorRequests(): URL[] {
    return this.transactionRequests.filter((url) => url.searchParams.has('filter[until]'))
  }

  get accountsRequests(): number {
    return this.requests.filter((url) => url.pathname === '/api/v1/accounts').length
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    this.requests.push(url)

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: JSON_HEADERS })
      return
    }

    const token = request.headers()['authorization']?.replace(/^Bearer\s+/i, '')
    if (url.pathname === '/api/v1/util/ping') {
      if (this.rejectAllPings || this.unauthorized || token !== this.validToken) {
        await this.fulfillError(route, 401, 'Not authorized')
        return
      }
      await this.fulfill(route, 200, { meta: { id: 'ping', statusEmoji: '⚡️' } })
      return
    }

    if (this.unauthorized || token !== this.validToken) {
      await this.fulfillError(route, 401, 'Not authorized')
      return
    }

    if (url.pathname === '/api/v1/accounts') {
      if (this.failAccounts) {
        await this.fulfillError(route, 500, 'Accounts are temporarily unavailable')
        return
      }
      await this.fulfill(route, 200, list(ACCOUNTS))
      return
    }

    if (url.pathname === '/api/v1/categories') {
      await this.fulfill(route, 200, list(CATEGORIES))
      return
    }

    if (url.pathname === '/api/v1/accounts/acc-spending') {
      await this.fulfill(route, 200, { data: ACCOUNTS[0] })
      return
    }

    if (url.pathname === '/api/v1/accounts/acc-joint') {
      await this.fulfill(route, 200, { data: ACCOUNTS[1] })
      return
    }

    if (url.pathname === '/api/v1/accounts/acc-spending/transactions') {
      this.transactionRequests.push(url)
      await this.handleTransactions(route, url)
      return
    }

    if (url.pathname === '/api/v1/accounts/acc-joint/transactions') {
      this.transactionRequests.push(url)
      await this.fulfill(route, 200, list([]))
      return
    }

    await this.fulfill(route, 200, list([]))
  }

  private async handleTransactions(route: Route, url: URL): Promise<void> {
    const after = url.searchParams.get('page[after]')
    const since = url.searchParams.get('filter[since]')
    const until = url.searchParams.get('filter[until]')
    const status = url.searchParams.get('filter[status]')
    const allPages = url.searchParams.get('page[size]') === '100'

    if (this.failNextPage && (after || until)) {
      await this.fulfillError(route, 500, 'The next page is unavailable')
      return
    }

    // The week view asks for a date-windowed page of up to 100 per account.
    // Filter the fixture by local-ish date so it behaves like Up's window.
    if (allPages && (since || until)) {
      const windowed = [...FIRST_PAGE, ...SECOND_PAGE].filter((tx) => {
        const day = tx.attributes.createdAt.slice(0, 10)
        return (!since || day >= since) && (!until || day < until)
      })
      await this.fulfill(route, 200, list(windowed))
      return
    }

    if (after || until) {
      await this.fulfill(route, 200, list(SECOND_PAGE))
      return
    }

    if (status === 'HELD') {
      await this.fulfill(route, 200, list([PENDING]))
      return
    }

    const settled = FIRST_PAGE.filter((tx) => tx.attributes.status === 'SETTLED')
    await this.fulfill(
      route,
      200,
      list(status === 'SETTLED' ? settled : FIRST_PAGE, NEXT_PAGE_URL),
    )
  }

  private async fulfill(route: Route, status: number, body: unknown): Promise<void> {
    await route.fulfill({
      status,
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    })
  }

  private async fulfillError(route: Route, status: number, detail: string): Promise<void> {
    await route.fulfill({
      status,
      headers: JSON_HEADERS,
      body: JSON.stringify({ errors: [{ status: String(status), title: detail, detail }] }),
    })
  }
}
