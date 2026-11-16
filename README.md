# Unofficial Up — React SPA

An unofficial web app for viewing Up Banking accounts, balances and transactions. It is a
**static, frontend-only** React single-page app: the browser talks to the Up API directly
and caches what it fetches on the device. There is no server to run.

> Not affiliated with Up. Your personal access token can read and categorise your banking
> data — use at your own risk, ideally with a short-lived token.

## Stack

- **React 19 + TypeScript + Vite** — the app shell
- **TanStack Query + TanStack DB** — infinite-query pagination with local-first row collections
- **OPFS SQLite** (`wa-sqlite`) — a durable, per-user cache of those collections
- **Tailwind CSS v4 + shadcn/ui** — styling and primitives
- **Playwright** — real-browser end-to-end tests against the production build
- **No backend** — deploy the built `dist/` to any static host

## Features

- Sign in with your Up Banking Personal Access Token
- View all account balances (including 2Up joint accounts)
- Click an account to view transactions grouped by date
- Filter transactions by status (settled/pending) and date range
- Export an account's transactions to CSV, limited to the selected date range (or the
  whole account when no dates are chosen)
- Paginated transaction loading (50 at a time) through TanStack Query's `useInfiniteQuery`,
  with an offline-safe anchor when a cached cursor may have shifted
- Transaction detail panel: category, card method, foreign amounts, round-ups, cashback, sender
- Offline-first: accounts, transactions, categories and the pagination cursor are
  restored from a per-user local cache with no network round trip
- Installable PWA: a service worker precaches the whole app shell, so the installed app
  opens with no network at all
- Background balance sync on reconnect, on returning to the tab, from a Refresh button, and
  from a slow account poll; Refresh also refetches every loaded transaction page

## How it works

### Direct to the Up API

The app calls `https://api.up.com.au/api/v1` from the browser with the token in an
`Authorization: Bearer` header. Up's API is CORS-permissive — it answers with
`Access-Control-Allow-Origin: *` and allows the `authorization` header on preflight — so
no proxy is required. There are no cookies; the bearer header is the whole credential,
which is why requests use `credentials: 'omit'`.

### The token lives in the browser

With no server session, the personal access token is stored in `localStorage`
(`auth.ts`) and attached to every request. This is a deliberate trade-off: any script on
the origin could read it, so the app ships a strict CSP, loads no third-party code, and
refuses to boot on an insecure origin. Generate a short-lived token in the Up app to
bound the exposure; see [Security](#security) for the full model.

### No real-time webhooks

Up webhooks need a publicly reachable HTTPS endpoint, which a static site cannot provide.
Instead the app refreshes on `online`, when the tab regains focus, from the Refresh
button, and via a slow timer while the tab is visible. The timer refreshes balances only,
so it never collapses a transaction list you have paged through.

## Data model: local-first with a durable cache

Accounts are a TanStack DB collection. Transaction pages are owned by a TanStack Query
infinite query and mirrored into a local-only TanStack DB collection:

| Data | Key | Source |
| --- | --- | --- |
| `accounts` | account id | Up `GET /accounts` |
| transaction pages | `['transactions', account, status, since, until]` | Up `GET /accounts/{id}/transactions` |
| `transactions:<account>:<filters>` | transaction id | local-only row mirror of the pages above |

- `useInfiniteQuery` owns the cursor sequence, `hasNextPage`, page freshness, retry and
  refetching. `getNextPageParam` follows Up's cursor for a fresh sequence.
- The first page is built from the persisted rows on a cold start (a synthetic
  `restored: true` page). Its saved cursor is **not** trusted directly: the next page is
  fetched with `filter[until]` anchored to the oldest cached transaction, then deduplicated
  by id. A shifted list therefore cannot skip or repeat the page boundary.
- The local-only collection is the durable mirror. The infinite query writes pages into it
  with direct inserts/deletes, and `useLiveQuery` still reads it for the offline seed and
  for non-network renders; the visible list is the deduplicated page sequence.
- `Refresh` calls `refetch()` on the infinite query, which refetches all loaded pages and
  keeps the page count. Priority order: current data first, then balance poll, then manual
  full refresh. Tab focus and reconnect refresh balances only, so a paged list is never
  collapsed by switching tabs.
- A new `DbClient` + `QueryClient` is created per signed-in session. Ending the session
  (sign out, a rejected token, or a 401/403) drops the whole store and wipes its rows,
  rather than scrubbing rows from a client that still has query observers attached.

### The local cache (OPFS SQLite)

When the browser supports it, every collection is wrapped in `persistedCollectionOptions`
and its rows are stored in SQLite (`wa-sqlite`, via
`@tanstack/browser-db-sqlite-persistence`) inside the Origin Private File System.
Restored rows render before the network is consulted.

- **Per user.** The database is named after a non-reversible fingerprint of the token
  (`sha256(token)[:16]`) computed in the browser (`auth.ts`). Two Up accounts on one
  browser never read each other's rows.
- **Behind the boot probe.** Collections are only materialised once the stored token has
  passed a probe against Up. The probe re-checks the token at most once per 6 hours, so
  page loads do not always cost an Up request, and a revoked token signs out before cached
  rows can render.
- **Wiped on sign out.** "Sign out" clears the token, closes SQLite and deletes the
  database files (including `-journal`, `-wal` and `-shm` sidecars) plus the cached
  cursor/category metadata. A 401/403, or a token Up rejects at boot, triggers the same
  wipe: a dead token can never authenticate again, so keeping its rows would only leave
  banking data at rest.
- **Stops restoring when abandoned.** Cached metadata older than `CACHE_TTL_MS`
  (90 days) is ignored, so an old device cannot keep restoring stale banking data.
  The sidebar has an explicit **Clear cache** action that deletes the OPFS rows and
  metadata immediately.
- **Visible degradation.** If OPFS is unavailable or storage is nearly full, the sidebar
  says "Offline cache unavailable — this session only" instead of pretending offline works.
- **Degrades cleanly.** Without OPFS (happy-dom in tests, Safari private mode, old
  browsers) `openLocalCache` returns null and the store is in-memory only.

### Offline-first fetching

A filter/account combination only hits the network when there is no usable cache. With a
warm cache (`rows > 0`) the restored rows seed the infinite query, which is considered
fresh and makes no request. Sync happens on:

- **reconnect** — the browser's `online` event refreshes balances,
- **tab focus** — returning to a hidden tab refreshes balances,
- **the Refresh button** — refetches accounts and every loaded transaction page,
- **the visible-tab poll** — balances only, every 60 seconds,
- **a first visit** for that account/filter, when no cache exists,
- **a filter or account change** — a new infinite query key.

All of these pause while the tab is hidden or offline. If a cache's rows are gone but its
metadata survived, a short fallback timer forces a fetch instead of hanging on "Loading".
Refresh and "Load more" failures now surface a toast or an inline retry instead of leaving
stale data silently; rate-limited and network failures retry with jittered exponential
backoff.

Non-row response parts are stored in `localStorage` by `envelopeStore.ts`: the cursor, the
category-name map, the row count, the oldest cached `createdAt`, and the last-synced time.
It shares the same per-user namespace and is removed with the SQLite files on sign out.

## Offline app shell (PWA)

Durable data (the OPFS cache above) is only half of offline. The other half is the app
shell, handled by a service worker generated at build time by `vite.config.ts`:

- **Precache.** On install the worker fetches and stores the whole shell — `index.html`,
  the hashed JS/CSS, the `wa-sqlite.wasm` engine, the OPFS worker, fonts, icons and the
  manifest — so the installed app boots with no network. Per-URL failures are tolerated so
  one missing asset cannot abort install.
- **Fetch strategy.** Navigations are network-first with a cached-shell fallback (so a new
  deploy is picked up, and offline still works). Same-origin assets are cache-first with
  runtime fill-in. Cross-origin requests — the Up API — are never intercepted.
- **Manifest.** `public/manifest.webmanifest` plus PNG icons make the app installable to
  the home screen.

The token is stored in `localStorage`, and the token/cache are removed on sign out; the
service worker only ever caches the app shell (never Up responses).

When the cache opens, the app also calls `navigator.storage.persist()` so the browser will
not evict the OPFS data under disk pressure, and it skips attaching the cache if
`navigator.storage.estimate()` shows the origin is nearly out of room. A `unhandledrejection`
guard logs (rather than crashes on) a `QuotaExceededError` from the persistence layer's
background writes.

## Security

Local-first is a latency and resilience architecture, not a security control. This app has
no server to breach, but the browser profile becomes the only place the token and cached
banking data live, so the controls below concentrate on protecting that profile, the
credential, and the origin.

In scope: XSS on the app origin (which can read the token and cache), token/cache
exfiltration over the network or to a third-party origin, a revoked or replaced token
continuing to unlock cached data, a second tab outliving sign-out, CSV formula injection,
clickjacking, MIME sniffing, cross-origin embedding, and stale service-worker assets.

Residual risks that cannot be fixed from inside a static SPA:

- **Device compromise.** Malware, a hostile browser extension, another OS user, or a stolen
  unlocked device with the profile can read the token and the cache. OPFS and localStorage
  are **not encrypted by the app**. Rely on full-disk encryption, an OS login, and a
  dedicated browser profile; use "Clear site data" or Sign out before handing a device on.
- **Compromised Up API or TLS termination.** The app trusts `api.up.com.au` and the
  browser's certificate store.
- **Offline revocation.** While Up is unreachable, a token revoked elsewhere can keep
  booting from cache for up to the 6-hour verify window. Open the app online to revalidate.
- **Supply chain.** A dependency that ends up in the bundle runs with the app's privileges.
  The lockfile, `npm audit` and `npm ci` reduce but do not eliminate that risk.
- **Origin sharing.** Anything else served from the same origin can read localStorage, the
  cache and the root service worker. Never host untrusted content, previews, or another
  app on this origin; use a dedicated domain or subdomain rather than a shared host such
  as `*.github.io`, where every project shares one origin.
- **No inactivity lock.** The app is not a kiosk: a device left unlocked with the tab open
  shows the dashboard, and the offline boot path can render cached rows for up to the
  verify window. Lock the OS, sign out, or clear site data before walking away.

### Session and token handling

- The token is stored in `localStorage` (`up:token`) because there is no server session and
  offline-first has to survive a reload. It is never put in a URL, cookie, log, or the DOM.
- The app refuses to boot on a non-secure origin (plain HTTP on anything except localhost),
  so the bearer token cannot cross the wire in cleartext (`security.ts`, `main.tsx`).
- Input is trimmed, length-capped, and rejected if it contains whitespace or control
  characters. Password-manager autofill is disabled so an Up account password cannot be
  submitted as a token (`Login.tsx`).
- `api.login` stores a token only after Up accepts it. Replacing a token wipes the cache of
  the previous token fingerprint instead of leaving an orphaned copy.
- Sign-out clears the token, wipes the OPFS database (including sidecars) and removes the
  cached cursor/category metadata.
- A 401/403, or a token rejected at boot, does the same wipe. A dead token can never
  authenticate again, so retaining its rows would only leave data at rest.
- A `storage` event for the token key reloads other tabs. Signing out (or switching
  accounts) in one tab therefore ends every tab instead of leaving an in-memory session
  running in the background.
- The boot probe trusts a stored token for at most 6 hours, then revalidates with Up. An
  unreachable Up still boots from cache, per the offline trade-off above.
- `frame-ancestors`/`X-Frame-Options` and a startup frame check prevent clickjacking on
  hosts that honour headers or JavaScript.

### Network and API hardening

- Requests go only to `https://api.up.com.au`; `connect-src` enforces it and `up.ts`
  asserts the URL origin before attaching the bearer header. That includes `links.next`,
  which is supplied by the response body rather than the code.
- No cookies or ambient credentials (`credentials: 'omit'`), so there is no CSRF surface.
- Up responses use `cache: 'no-store'` and `referrerPolicy: 'no-referrer'`, keeping banking
  data out of the browser HTTP cache and off the Referer header.
- The token is sent only as an `Authorization` header over HTTPS, never in a query string.

### Content and data handling

- React escapes all Up text; the app has no `dangerouslySetInnerHTML`, `innerHTML` or
  `eval`, and no external script, font or image origin.
- Up API URLs are re-checked before use, so a tampered `links.next` cannot redirect the
  bearer token to another origin.
- Persisted envelope metadata (cursor, category names, row count) is revalidated as
  untrusted input and rebuilt into a null-prototype map before use.
- CSV exports neutralise spreadsheet formula triggers (`=`, `+`, `-`, `@`, tab, CR/LF, even
  after leading whitespace or a BOM), escape quotes/commas/newlines, and only treat a
  strict decimal amount as numeric. Filenames are reduced to letters, digits, spaces, `_`
  and `-`.

### Browser and hosting controls

- **Strict CSP** — injected into `index.html` plus emitted as a header:
  `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `script-src-attr 'none'`,
  `worker-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`,
  `font-src 'self'`, `connect-src 'self' https://api.up.com.au`,
  `frame-src/media-src 'none'`, `child-src 'self'` (same-origin workers only),
  `manifest-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `upgrade-insecure-requests`, and `frame-ancestors 'none'` in the header.
- **Security headers** — `_headers` generated at build time with `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, a restrictive
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
  `X-Permitted-Cross-Domain-Policies` and HSTS.
- **SPA fallback** — `_redirects` is generated for hosts that support it; otherwise
  configure the fallback yourself.
- **No third-party code** — the app ships its own bundle, fonts and assets. Fonts are
  self-hosted specifically so no third-party origin is in the trust boundary.
- **Service worker** — caches only same-origin shell assets, never Up responses.

`style-src 'unsafe-inline'` is required because React writes `style` attributes. It cannot
exfiltrate data because `connect-src` is limited to `'self'` and the Up API.

`'wasm-unsafe-eval'` is required to compile the SQLite wasm engine. It permits WebAssembly
compilation only, not JavaScript `eval`.

### Headers to set at the host

A meta tag cannot express framing or policy headers, so configure these on the static host.
`vite build` emits `dist/_headers` and `dist/_redirects` for Netlify, Cloudflare Pages and
compatible hosts; they contain:

```
X-Frame-Options: DENY
Content-Security-Policy: ...same directives as the meta tag...; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains

# index.html and sw.js must revalidate so deploys land; hashed assets never change.
Cache-Control: no-cache                                  # /index.html, /sw.js
Cache-Control: public, max-age=31536000, immutable       # /assets/*
```

Hosts that do not process `_headers` (GitHub Pages, plain S3) still enforce the meta CSP
and the startup frame check, but cannot send HSTS or a real framing header; put a CDN or
reverse proxy in front of them if those matter. An nginx example is below.

```nginx
# Copy the exact Content-Security-Policy value from dist/_headers.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.up.com.au; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'none'; child-src 'self'; media-src 'none'; manifest-src 'self'; upgrade-insecure-requests; frame-ancestors 'none'" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-DNS-Prefetch-Control "off" always;
add_header X-Robots-Tag "noindex, nofollow" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
try_files $uri /index.html;
```

## Project layout

```
README.md
.gitignore
.github/workflows/ci.yml  Lint, typecheck, build, unit tests and Playwright in CI
frontend/
  index.html             Vite entry point (CSP meta and manifest link)
  vite.config.ts         Tailwind, SQLite assets, CSP/security headers, service worker
  playwright.config.ts   Chromium project, production preview web server, traces
  tsconfig.e2e.json      Typecheck config for the e2e sources
  components.json        shadcn/ui CLI configuration
  e2e/
    fixtures.ts          Per-test Up API mock + app page object
    pages/AppPage.ts     Role-based app page object
    support/up-api.ts    Stateful fake of the Up API
    specs/               auth, transactions, offline/PWA, security, responsive
  public/
    fonts/               Self-hosted woff2 fonts (no third-party origin)
    manifest.webmanifest Web app manifest
    favicon.svg          Source icon; icon-192/512.png + apple-touch-icon.png generated from it
    # dist/sw.js is generated at build time with the precache list baked in
  scripts/
    db-smoke.mjs         Data-layer test against the real TanStack DB packages
    csv-check.ts         CSV columns, escaping and formula-injection guard
    persistence-smoke.ts Cache fallback when OPFS is unavailable
    security-check.ts    Token input validation
    pagination-check.ts  Cursor anchoring, dedupe and exhausted-cache behaviour
    render-smoke.mjs     Renders the production bundle in happy-dom against a fake Up API
                          and asserts CSP/header/token-clearing/401 behaviour
  src/
    App.tsx              Boot probe, per-session store, view switching
    auth.ts              Token storage, cache fingerprint, verify window
    api.ts               Facade the UI and collections call
    up.ts                Direct Up API client (fetch, errors, pagination)
    csv.ts               Transaction → CSV serialisation for the export
    db.ts                TanStack DB client, descriptors, persistence, fetch gating
    persistence.ts       OPFS SQLite cache: open, dispose, wipe, forget a user
    envelopeStore.ts     Cursor, category map, oldest timestamp and cache TTL
    pagination.ts        Pure page-param/dedupe helpers for the infinite query
    useTransactionsInfinite.ts  TanStack Query infinite transaction source
    security.ts          Secure-context, frame and token-input checks
    useOnlineStatus.ts   Online/visibility hooks used to pause polling
    types.ts             Up API types shared with the UI
    fonts.css            @font-face declarations for the self-hosted fonts
    index.css            Tailwind layer + app styles
    lib/utils.ts         cn() helper (registry alias target)
    components/
      ui/                shadcn/ui components, generated by the CLI
      Login.tsx
      Dashboard.tsx
      AccountCard.tsx
      TransactionItem.tsx
      DetailPanel.tsx
      Filters.tsx
      TransactionsView.tsx Infinite query, row mirror, load-more and detail panel
      ErrorBoundary.tsx   Render-error recovery and local-data reset
      Toasts.tsx
      UpLogo.tsx
```

## UI components (shadcn/ui)

shadcn/ui is wired up for the Vite app, so new primitives come from the CLI instead of
being hand-written:

```bash
cd frontend
npx shadcn@latest add card dialog select table
```

Components land in `src/components/ui/` and import through the `@/*` alias
(`@/components/ui/card`). `components.json` points the CLI at `src/index.css` and
`src/lib/utils.ts`. A starter set (`button`, `card`, `input`, `badge`, `skeleton`,
`separator`, `dialog`) is already installed.

The app's stylesheet was not rewritten. `src/index.css` imports Tailwind's theme and
utilities but **not Preflight**, because the hand-tuned Up theme already has its own reset
and Preflight's global `line-height` would shift it. A small `base` layer recreates the
parts shadcn depends on. Existing rules live in `@layer app`, ordered before `utilities`,
so Tailwind spacing utilities win over the global `* { margin: 0; padding: 0 }` reset while
the app keeps overriding the base layer.

Generated components read shadcn's semantic tokens (`--background`, `--primary`,
`--border`, ...). They are mapped to the Up palette in the `:root` block at the top of
`src/index.css`, so components match the app out of the box; change them there to re-theme
everything at once.

## Development

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. There is no proxy: the dev server serves the app and the
browser calls `api.up.com.au` directly. The local cache needs a secure context;
`localhost` qualifies, and any other host must be served over HTTPS.

## Checks

```bash
cd frontend
npm run lint
npm run build

npm run test:db          # collections, select, orderBy, pagination, teardown
npm run test:csv         # CSV columns, escaping, formula-injection guard
npm run test:security    # token input validation and control-character rejection
npm run test:pagination  # cursor anchoring, dedupe, exhausted restored cache
npm run test:persistence # cache fallback, envelope TTL/validation, forget a user
npm run test:render      # production bundle in happy-dom: boot → accounts →
                         # transactions → load more → offline → sign out →
                         # re-login → 401, plus CSP/header/token assertions

npm run typecheck:e2e    # typecheck the Playwright sources
npm run test:e2e         # real Chromium against the production build
```

`test:render` runs against `dist`, so build first. The first e2e run also needs a
browser: `npx playwright install chromium` (CI installs it with system dependencies).

## End-to-end tests

The Playwright suite drives the real production bundle in Chromium. It does not use a
token or a live Up account: `e2e/support/up-api.ts` installs a stateful fake for
`https://api.up.com.au`, including CORS preflights, cursor pages, CSV pagination,
401s, 500s and a failing next page.

| Spec | Coverage |
| --- | --- |
| `auth.spec.ts` | validation, invalid token, successful login, reload, sign out and cache wipe |
| `transactions.spec.ts` | balances, filters, cursor pagination, refresh preserving pages, detail panel, CSV download/formula guard, error toasts |
| `offline.spec.ts` | service worker + OPFS restore on a cold offline reload, then `filter[until]` load-more anchoring |
| `security.spec.ts` | CSP, no token in the DOM, only app/Up origins, 401 token+cache wipe |
| `resilience.spec.ts` | empty account state and the mobile account drawer |

The config starts `vite preview` on port 4173 after a fresh build, runs tests in parallel
with isolated browser contexts (so OPFS and localStorage do not leak between tests),
records trace/screenshot/video on failure, and writes an HTML report to
`playwright-report/`. Use `npm run test:e2e:headed` or `npm run test:e2e:debug` while
developing. `.github/workflows/ci.yml` runs lint, e2e typecheck, build, the Node smoke
tests and the Playwright suite on every push and pull request, and uploads the report.

## Production build & hosting

```bash
cd frontend
npm run build
```

Everything needed is in `frontend/dist/`. Serve it from any static host (GitHub Pages,
Netlify, Cloudflare Pages, S3, ...). `dist/_headers` and `dist/_redirects` cover the
security headers and SPA fallback on Netlify/Cloudflare Pages; other hosts need the
equivalent configuration described under [Headers to set at the host](#headers-to-set-at-the-host).
The CSP meta tag is already in the built `index.html`, and `sw.js` sits at the root so its
scope covers the whole app. Serve everything over HTTPS: the app refuses to boot on a
non-secure origin, and both service workers and OPFS require a secure context.

## Up API endpoints used

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/util/ping` | Validate the token on login and on the boot probe |
| GET | `/accounts` | Account balances |
| GET | `/accounts/{id}` | Account name (for the CSV filename) |
| GET | `/accounts/{id}/transactions` | Transactions with `filter[...]` (status, since, until) |
| GET | `/categories` | Category id → name map |
| GET | `/tags` | All tags (fetched by the shared client) |

## Notes

- Single-user: Up allows one personal access token at a time. The client caches rows per
  token fingerprint, and switching tokens wipes the previous token's cache.
- Transaction pages are fetched by `useInfiniteQuery`; `Refresh` refetches all loaded
  pages, while focus/reconnect only refresh balances so the list keeps its place.
- Run `npm ci` (not a floating install) and `npm audit` before deploying. The app has no
  runtime third-party origins, so a compromised dependency has to ship in the bundle to
  matter.
- The main bundle is ~233 kB gzipped (TanStack DB, React, and the persistence wrapper).
  The SQLite engine is a separate ~530 kB gzipped wasm asset fetched the first time the
  local cache opens, from a worker.
- The local cache is a convenience, not a source of truth. Balances and transaction status
  change server-side; anything that happened while the tab was closed appears on the next
  sync (reconnect, focus, poll, or Refresh).
- The service worker cache name carries a build id, so each deploy installs a fresh cache
  and the old one is deleted on activate. `navigator.storage.persist()` is best-effort:
  some browsers grant it silently, others ignore it.
- This app was previously a FastAPI + React project. The backend (token store, CORS proxy,
  webhook receiver, CSV endpoint) was removed in favour of the browser talking to Up
  directly; see git history for the original.
