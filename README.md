# Unofficial Up — React SPA

An unofficial web app for viewing Up Banking accounts, balances and transactions. It is a
**static, frontend-only** React single-page app: the browser talks to the Up API directly
and caches what it fetches on the device. There is no server to run.

> Not affiliated with Up. Your personal access token can read and categorise your banking
> data — use at your own risk, ideally with a short-lived token.

## Stack

- **React 19 + TypeScript + Vite** — the app shell
- **TanStack DB + TanStack Query** — local-first collections the UI renders from
- **OPFS SQLite** (`wa-sqlite`) — a durable, per-user cache of those collections
- **Tailwind CSS v4 + shadcn/ui** — styling and primitives
- **No backend** — deploy the built `dist/` to any static host

## Features

- Sign in with your Up Banking Personal Access Token
- View all account balances (including 2Up joint accounts)
- Click an account to view transactions grouped by date
- Filter transactions by status (settled/pending) and date range
- Export an account's transactions to CSV, limited to the selected date range (or the
  whole account when no dates are chosen)
- Paginated transaction loading (50 at a time, with "Load more")
- Transaction detail panel: category, card method, foreign amounts, round-ups, cashback, sender
- Offline-first: accounts, transactions, categories and the pagination cursor are
  restored from a per-user local cache with no network round trip
- Installable PWA: a service worker precaches the whole app shell, so the installed app
  opens with no network at all
- Background sync on reconnect, on returning to the tab, from a Refresh button, and from a
  slow account poll

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
the origin could read it, so the app ships a strict CSP and loads no third-party code.
Generate a short-lived token in the Up app to bound the exposure.

### No real-time webhooks

Up webhooks need a publicly reachable HTTPS endpoint, which a static site cannot provide.
Instead the app refreshes on `online`, when the tab regains focus, from the Refresh
button, and via a slow timer while the tab is visible. The timer refreshes balances only,
so it never collapses a transaction list you have paged through.

## Data model: local-first with a durable cache

Collections are the source of truth for rendering; components never hold copies in
`useState`:

| Collection | Key | Source |
| --- | --- | --- |
| `accounts` | account id | Up `GET /accounts` |
| `transactions:<account>:<filters>` | transaction id | Up `GET /accounts/{id}/transactions` |

- `useLiveQuery` reads collections; a refetch updates the UI without manual state plumbing.
- The transactions query returns `{ transactions, nextPage, categoryMap }`. `select`
  projects `transactions` into the collection; the envelope stays in the TanStack Query
  cache so pagination metadata and category names are read without a second request.
- "Load more" appends rows with `utils.writeUpsert`. A refetch replaces the collection
  with page 1, which is why the cursor resets whenever the envelope changes.
- A new `DbClient` + `QueryClient` is created per signed-in session. Ending the session
  (sign out or 401) drops the whole store rather than scrubbing rows from a client that
  still has query observers attached.

### The local cache (OPFS SQLite)

When the browser supports it, every collection is wrapped in `persistedCollectionOptions`
and its rows are stored in SQLite (`wa-sqlite`, via
`@tanstack/browser-db-sqlite-persistence`) inside the Origin Private File System.
`initialRender: { strategy: 'network-first', networkTimeoutMs: 0 }` renders restored rows
immediately.

- **Per user.** The database is named after a non-reversible fingerprint of the token
  (`sha256(token)[:16]`) computed in the browser (`auth.ts`). Two Up accounts on one
  browser never read each other's rows.
- **Behind the boot probe.** Collections are only materialised once the stored token has
  passed a probe against Up. The probe re-checks the token at most once per 6 hours, so
  page loads do not always cost an Up request, and a revoked token signs out before cached
  rows can render.
- **Wiped on sign out.** "Sign out" closes SQLite and deletes the database files. A 401
  during a session keeps the cache, because the next login is still authenticated.
- **Degrades cleanly.** Without OPFS (happy-dom in tests, Safari private mode, old
  browsers) `openLocalCache` returns null and the store is in-memory only.

### Offline-first fetching

A collection only hits the network when there is nothing cached to show. When a stored
copy exists (`rows > 0`), `enabled` is `false`, the restored rows render, and the app
syncs only on:

- **reconnect** — the browser's `online` event,
- **tab focus** — returning to a hidden tab,
- **the Refresh button** — in the sidebar footer, next to a "Synced 4m ago" label,
- **the visible-tab poll** — balances only, every 60 seconds,
- **a first visit** for that account/filter, when no cache exists.

All of these pause while the tab is hidden or offline, so a backgrounded tab makes no
requests. If a cache's rows are gone but its metadata survived (for example the SQLite
database was cleared outside the app), a short fallback timer forces a fetch instead of
hanging on "Loading".

Non-row response parts are stored in `localStorage` by `envelopeStore.ts`: the pagination
cursor, the category-name map, the row count used for the decision above, and the
last-synced time. It shares the same per-user namespace and is removed with the SQLite
files on sign out.

**Caveat:** the cursor is a position in a live, newest-first list. After a restore it can
point at a shifted window, so "Load more" after an offline period may skip or repeat
transactions. The button is disabled while offline; use Refresh first if the page boundary
matters.

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

Local-first is a latency and resilience architecture, not a security control: any XSS can
read an in-memory store, and any at-rest store is readable by whoever has the browser
profile. The security properties come from separate controls:

- **Strict CSP** — injected into `index.html` at build time by `vite.config.ts`:
  `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`,
  `connect-src 'self' https://api.up.com.au`, no inline scripts, no third-party origins.
  Fonts are self-hosted for this reason.
- **No third-party code** — the app ships its own bundle, fonts and assets.
- **`referrer: no-referrer`** via a meta tag.
- **Local rows are scoped to the user and removed on sign out.**

`style-src 'unsafe-inline'` is required because React writes `style` attributes. It cannot
exfiltrate data because `connect-src` is limited to `'self'` and the Up API.

`'wasm-unsafe-eval'` is required to compile the SQLite wasm engine. It permits WebAssembly
compilation only, not JavaScript `eval`.

### Headers to set at the host

A meta tag cannot express everything, so configure these on your static host:

```
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()

# index.html and sw.js must revalidate so deploys land; hashed assets never change.
Cache-Control: no-cache                                  # /index.html, /sw.js
Cache-Control: public, max-age=31536000, immutable       # /assets/*
```

## Project layout

```
README.md
.gitignore
frontend/
  index.html             Vite entry point (CSP meta and manifest link)
  vite.config.ts         Tailwind, SQLite asset handling, CSP + service-worker generation
  components.json        shadcn/ui CLI configuration
  public/
    fonts/               Self-hosted woff2 fonts (no third-party origin)
    manifest.webmanifest Web app manifest
    favicon.svg          Source icon; icon-192/512.png + apple-touch-icon.png generated from it
    # dist/sw.js is generated at build time with the precache list baked in
  scripts/
    db-smoke.mjs         Data-layer test against the real TanStack DB packages
    csv-check.ts         CSV columns, escaping and formula-injection guard
    persistence-smoke.ts Cache fallback when OPFS is unavailable
    render-smoke.mjs     Renders the production bundle in happy-dom against a fake Up API
  src/
    App.tsx              Boot probe, per-session store, view switching
    auth.ts              Token storage, cache fingerprint, verify window
    api.ts               Facade the UI and collections call
    up.ts                Direct Up API client (fetch, errors, pagination)
    csv.ts               Transaction → CSV serialisation for the export
    db.ts                TanStack DB client, descriptors, persistence, fetch gating
    persistence.ts       OPFS SQLite cache: open, dispose, wipe
    envelopeStore.ts     Cursor, category map and last-synced metadata
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
npm run test:persistence # local cache falls back to memory without OPFS
npm run test:render      # production bundle in happy-dom: boot → accounts →
                         # transactions → load more → sign out → re-login
```

`test:render` runs against `dist`, so build first.

## Production build & hosting

```bash
cd frontend
npm run build
```

Everything needed is in `frontend/dist/`. Serve it from any static host (GitHub Pages,
Netlify, Cloudflare Pages, S3, ...). Configure the host to serve `index.html` for unknown
paths (SPA fallback) and to send the headers listed above. The CSP meta tag is already in
the built `index.html`, and `sw.js` sits at the root so its scope covers the whole app.
Serve everything over HTTPS: both service workers and OPFS require a secure context.

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
  token fingerprint, so switching tokens starts from a clean cache.
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
