// Render smoke test: loads the production bundle in happy-dom with a fake Up
// API and asserts the dashboard reaches a rendered state. Run after build:
//   npm run build && npm run test:render
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const bundleName = html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1]
if (!bundleName) throw new Error('could not find bundle in dist/index.html')
const bundlePath = new URL(`../dist/assets/${bundleName}`, import.meta.url)

const page = new Window({ url: 'http://localhost:8000/' })
page.document.body.innerHTML = '<div id="root"></div>'

for (const key of [
  'window', 'document', 'navigator', 'location', 'history', 'HTMLElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame',
  'getComputedStyle', 'localStorage', 'sessionStorage', 'SVGElement',
]) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' ? page : page[key],
    configurable: true,
    writable: true,
  })
}
globalThis.self = page

const accounts = [
  {
    id: 'acc-1',
    attributes: {
      displayName: 'Spending',
      accountType: 'TRANSACTIONAL',
      ownershipType: 'INDIVIDUAL',
      balance: { value: '1234.56', currencyCode: 'AUD' },
    },
  },
  {
    id: 'acc-2',
    attributes: {
      displayName: 'Joint',
      accountType: 'SAVER',
      ownershipType: 'JOINT',
      balance: { value: '900.00', currencyCode: 'AUD' },
    },
  },
]

const transactions = {
  transactions: [
    {
      id: 'tx-1',
      attributes: {
        description: 'Coffee',
        createdAt: '2026-11-05T08:00:00Z',
        status: 'SETTLED',
        amount: { value: '-5.50', valueInBaseUnits: -550, currencyCode: 'AUD' },
      },
      relationships: { category: { data: { id: 'cat-1' } } },
    },
  ],
  nextPage: 'cursor-2',
  categoryMap: { 'cat-1': 'Eating out' },
}

const nextPage = {
  transactions: [
    {
      id: 'tx-2',
      attributes: {
        description: 'Older coffee',
        createdAt: '2026-11-01T08:00:00Z',
        status: 'SETTLED',
        amount: { value: '-4.00', valueInBaseUnits: -400, currencyCode: 'AUD' },
      },
    },
  ],
  nextPage: null,
}

// Simulated server session. The app boots by probing `/api/session`, so the
// dashboard must come from a valid session rather than automatically.
let authed = true
const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60

const requested = []
globalThis.fetch = async (input) => {
  const url = String(input)
  requested.push(url)
  const path = new URL(url, 'http://x').pathname

  let status = 200
  let body
  if (path === '/api/session') {
    if (authed) {
      body = { authenticated: true, uid: 'test-user', expiresAt, verified: true }
    } else {
      status = 401
      body = { error: 'session_expired' }
    }
  } else if (path === '/api/login') {
    authed = true
    body = { ok: true, uid: 'test-user', expiresAt }
  } else if (path === '/api/logout') {
    authed = false
    body = { ok: true }
  } else if (url.includes('/api/transactions/next')) body = nextPage
  else if (url.includes('/api/accounts/') && url.includes('/transactions')) body = transactions
  else if (url.includes('/api/accounts')) body = { accounts }
  else if (url.includes('/api/events')) body = { events: [] }
  else body = { ok: true }

  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}
page.fetch = globalThis.fetch

const errors = []
const originalError = console.error
console.error = (...args) => {
  errors.push(args.map(String).join(' '))
  originalError(...args)
}

await import(bundlePath)

const deadline = Date.now() + 4000
const text = () => page.document.body.textContent ?? ''
while (Date.now() < deadline) {
  if (text().includes('Spending')) break
  await new Promise((resolve) => setTimeout(resolve, 50))
}

const body = text()
console.log('rendered accounts   :', body.includes('Spending') && body.includes('Joint'))
console.log('balance formatted   :', body.includes('1,234.56'))
console.log('login screen gone   :', !body.includes('Personal Access Token'))

// Select an account and wait for its transactions.
page.document.querySelector('[data-account-id="acc-1"]')?.click()
const txDeadline = Date.now() + 3000
while (Date.now() < txDeadline && !text().includes('Coffee')) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const afterClick = text()
console.log('transactions shown  :', afterClick.includes('Coffee'))
console.log('category from map   :', afterClick.includes('Eating out'))
console.log('load more visible   :', Boolean(page.document.querySelector('#load-more-btn')))

page.document.querySelector('#load-more-btn')?.click()
const moreDeadline = Date.now() + 3000
while (Date.now() < moreDeadline && !text().includes('Older coffee')) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
console.log('page 2 appended     :', text().includes('Older coffee'))

const paths = [...new Set(requested.map((u) => new URL(u, 'http://x').pathname))]
console.log('api calls           :', paths.join(', '))

const page2Rendered = text().includes('Older coffee')

// Offline-first UI: a last-synced label, a manual refresh, and an offline state.
const findButton = (label) =>
  Array.from(page.document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  )
const accountsCount = () =>
  requested.filter((url) => new URL(url, 'http://x').pathname === '/api/accounts').length

console.log('synced label shown  :', /Synced/.test(text()))

const beforeRefresh = accountsCount()
findButton('Refresh')?.click()
const refreshDeadline = Date.now() + 3000
while (Date.now() < refreshDeadline && accountsCount() === beforeRefresh) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
console.log('manual refresh call :', accountsCount() > beforeRefresh)

page.dispatchEvent(new Event('offline'))
await new Promise((resolve) => setTimeout(resolve, 80))
console.log('offline status      :', text().includes('Offline'))
console.log('offline disables    :', Boolean(findButton('Refresh')?.disabled))
console.log('offline note shown  :', text().includes('Offline — showing saved transactions.'))

page.dispatchEvent(new Event('online'))
await new Promise((resolve) => setTimeout(resolve, 80))

// Sign out must land on the login screen and call the server-side logout.
const signOut = Array.from(page.document.querySelectorAll('button')).find(
  (button) => button.textContent?.trim() === 'Sign out',
)
signOut?.click()
const isLoginScreen = () => Boolean(page.document.querySelector('input[name="accessToken"]'))
const logoutDeadline = Date.now() + 3000
while (Date.now() < logoutDeadline && !isLoginScreen()) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const loginReached = isLoginScreen()
console.log('sign out -> login   :', loginReached)
console.log('logout call made    :', requested.some((u) => u.includes('/api/logout')))

// Re-login must build a new store and refetch from scratch.
const tokenInput = page.document.querySelector('input[name="accessToken"]')
if (tokenInput) {
  // Bypass React's patched value setter so its change tracker sees the edit.
  const setValue = Object.getOwnPropertyDescriptor(page.HTMLInputElement.prototype, 'value')?.set
  setValue?.call(tokenInput, 'pat-test')
  tokenInput.dispatchEvent(new Event('input', { bubbles: true }))
  tokenInput.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
const reloginDeadline = Date.now() + 3000
while (Date.now() < reloginDeadline && !text().includes('Spending')) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const accountsCalls = requested.filter((u) => new URL(u, 'http://x').pathname === '/api/accounts').length
console.log('re-login renders    :', text().includes('Spending'))
console.log('accounts refetched  :', accountsCalls >= 2, `(${accountsCalls} calls)`)

if (!page2Rendered || !loginReached || !text().includes('Spending')) {
  console.log('\n--- body ---\n', text().slice(0, 800))
  console.log('\n--- react console.errors ---\n', errors.slice(0, 5).join('\n\n'))
  process.exit(1)
}
process.exit(0)
