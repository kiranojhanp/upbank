// Render smoke test: loads the production bundle in happy-dom with a fake Up
// API and asserts the dashboard reaches a rendered state. Run after build:
//   npm run build && npm run test:render
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const bundleName = html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1]
if (!bundleName) throw new Error('could not find bundle in dist/index.html')
const bundlePath = new URL(`../dist/assets/${bundleName}`, import.meta.url)

// Static security artifacts the build must always produce.
const headers = readFileSync(new URL('../dist/_headers', import.meta.url), 'utf8')
const redirects = readFileSync(new URL('../dist/_redirects', import.meta.url), 'utf8')
const hasCspMeta = /http-equiv="Content-Security-Policy"/.test(html)
const cspAllowsUp = html.includes('https://api.up.com.au')
const hasFrameAncestors = /frame-ancestors 'none'/.test(headers)
const hasNoSniff = /X-Content-Type-Options: nosniff/.test(headers)
const hasHsts = /Strict-Transport-Security: max-age=/.test(headers)
const hasSpaFallback = redirects.trim() === '/*    /index.html   200'

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

// The app is a static SPA: a stored token boots it, and it calls Up directly.
// Seed one so the test starts authenticated rather than on the login screen.
page.localStorage.setItem('up:token', 'pat-test')

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

const categories = [{ id: 'cat-1', attributes: { name: 'Eating out' } }]

const txPage1 = {
  data: [
    {
      type: 'transactions',
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
  links: {
    next: 'https://api.up.com.au/api/v1/accounts/acc-1/transactions?page%5Bafter%5D=cursor-2&page%5Bsize%5D=50',
  },
}

const txPage2 = {
  data: [
    {
      type: 'transactions',
      id: 'tx-2',
      attributes: {
        description: 'Older coffee',
        createdAt: '2026-11-01T08:00:00Z',
        status: 'SETTLED',
        amount: { value: '-4.00', valueInBaseUnits: -400, currencyCode: 'AUD' },
      },
    },
  ],
  links: { next: null },
}

const requested = []
let unauthorized = false
globalThis.fetch = async (input) => {
  const url = String(input)
  requested.push(url)
  const parsed = new URL(url, 'https://api.up.com.au')
  const path = parsed.pathname
  const query = parsed.search

  let status = 200
  let body
  if (path === '/api/v1/util/ping') body = { meta: { id: 'ping', statusEmoji: '⚡️' } }
  else if (path === '/api/v1/accounts') body = { data: accounts, links: { next: null } }
  else if (path === '/api/v1/categories') body = { data: categories, links: { next: null } }
  else if (path === '/api/v1/accounts/acc-1') body = { data: accounts[0] }
  else if (path === '/api/v1/accounts/acc-1/transactions') {
    body = query.includes('after') ? txPage2 : txPage1
  } else body = { data: [], links: { next: null } }

  if (unauthorized) {
    status = 401
    body = { errors: [{ title: 'Unauthorized' }] }
  }

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
const tokenNotInDom = !page.document.body.innerHTML.includes('pat-test')
console.log('token not in DOM     :', tokenNotInDom)
console.log('csp meta present     :', hasCspMeta && cspAllowsUp)
console.log('security headers     :', hasFrameAncestors && hasNoSniff && hasHsts)
console.log('spa fallback         :', hasSpaFallback)

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

const paths = [...new Set(requested.map((u) => new URL(u, 'https://api.up.com.au').pathname))]
console.log('api calls           :', paths.join(', '))

const page2Rendered = text().includes('Older coffee')

// Offline-first UI: a manual refresh and an offline state.
const findButton = (label) =>
  Array.from(page.document.querySelectorAll('button')).find(
    (button) =>
      button.textContent?.trim() === label ||
      button.getAttribute('aria-label') === label,
  )
const accountsCount = () =>
  requested.filter((url) => new URL(url, 'http://x').pathname === '/api/v1/accounts').length

console.log('refresh icon shown  :', Boolean(findButton('Refresh')))
console.log('sync text absent    :', !page.document.querySelector('.sync-time, .sync-status'))

const beforeRefresh = accountsCount()
findButton('Refresh')?.click()
const refreshDeadline = Date.now() + 3000
while (Date.now() < refreshDeadline && accountsCount() === beforeRefresh) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const pagedRowsKept = text().includes('Older coffee')
const cacheNoticeShown = text().includes('Offline cache unavailable')
console.log('manual refresh call :', accountsCount() > beforeRefresh)
console.log('paged rows kept     :', pagedRowsKept)
console.log('cache notice shown  :', cacheNoticeShown)

page.dispatchEvent(new Event('offline'))
await new Promise((resolve) => setTimeout(resolve, 80))
console.log('offline disables    :', Boolean(findButton('Refresh')?.disabled))
console.log('offline note shown  :', text().includes('Offline — showing saved transactions.'))

page.dispatchEvent(new Event('online'))
await new Promise((resolve) => setTimeout(resolve, 80))

// Sign out is local now (no server session to clear) and must land on login.
const signOut = Array.from(page.document.querySelectorAll('button')).find(
  (button) =>
    button.getAttribute('aria-label') === 'Sign out' ||
    button.textContent?.trim() === 'Sign out',
)
signOut?.click()
const isLoginScreen = () => Boolean(page.document.querySelector('input[name="accessToken"]'))
const logoutDeadline = Date.now() + 3000
while (Date.now() < logoutDeadline && !isLoginScreen()) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const loginReached = isLoginScreen()
const tokenClearedAfterSignOut = page.localStorage.getItem('up:token') === null
const hasStoredEnvelope = () => {
  for (let index = 0; index < page.localStorage.length; index += 1) {
    const key = page.localStorage.key(index)
    if (key?.startsWith('up:envelope:') || key?.startsWith('up:synced:')) return true
  }
  return false
}
const metadataClearedAfterSignOut = !hasStoredEnvelope()
console.log('sign out -> login   :', loginReached)
console.log('token cleared on out :', tokenClearedAfterSignOut)
console.log('cache metadata gone :', metadataClearedAfterSignOut)

// Re-login must validate the token, store it, build a new store and refetch.
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
const accountsCalls = requested.filter(
  (u) => new URL(u, 'http://x').pathname === '/api/v1/accounts',
).length
const reloginRendered = text().includes('Spending')
console.log('re-login renders    :', reloginRendered)
console.log('accounts refetched  :', accountsCalls >= 2, `(${accountsCalls} calls)`)

// A 401 must clear the token and cache, and land on login. Otherwise a reload
// would silently restore cached banking data for a dead session.
unauthorized = true
findButton('Refresh')?.click()
const expiredDeadline = Date.now() + 3000
while (Date.now() < expiredDeadline && !isLoginScreen()) {
  await new Promise((resolve) => setTimeout(resolve, 50))
}
const expiredToLogin = isLoginScreen()
const tokenClearedAfter401 = page.localStorage.getItem('up:token') === null
const metadataClearedAfter401 = !hasStoredEnvelope()
console.log('401 -> login         :', expiredToLogin)
console.log('token cleared on 401 :', tokenClearedAfter401)
console.log('cache metadata 401   :', metadataClearedAfter401)

if (
  !page2Rendered ||
  !loginReached ||
  !tokenClearedAfterSignOut ||
  !metadataClearedAfterSignOut ||
  !expiredToLogin ||
  !tokenClearedAfter401 ||
  !metadataClearedAfter401 ||
  !reloginRendered ||
  !tokenNotInDom ||
  !pagedRowsKept ||
  !cacheNoticeShown ||
  !hasCspMeta ||
  !cspAllowsUp ||
  !hasFrameAncestors ||
  !hasNoSniff ||
  !hasHsts
) {
  console.log('\n--- body ---\n', text().slice(0, 800))
  console.log('\n--- react console.errors ---\n', errors.slice(0, 5).join('\n\n'))
  process.exit(1)
}
process.exit(0)
