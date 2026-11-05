# Unofficial Up — React + FastAPI

A React + FastAPI port of [kiranojhanp/upbank](https://github.com/kiranojhanp/upbank),
an unofficial web app for viewing Up Banking accounts, balances and transactions, with
optional real-time updates via Up webhooks.

The original project is a Node.js/Express app with EJS views. This version uses the stack
described in [Ekky Armandi's React + FastAPI article](https://ekky.dev/blog/2026-06-12-why-react-fastapi-is-a-perfect-stack-for-an-ai-web-application/):
FastAPI exposes a typed JSON API and React owns the entire UI. The client data layer is
[TanStack DB](https://tanstack.com/db) 1.0 RC1, used as a reactive store backed by a
durable per-user SQLite cache.

## Stack

- **Backend:** FastAPI + httpx, with server-side sessions in SQLite
- **Frontend:** React 19 + TypeScript + Vite
- **Client data:** TanStack DB 1.0 RC1 (`@tanstack/react-db`, `query-db-collection`)
- **Local cache:** `@tanstack/browser-db-sqlite-persistence` (wa-sqlite in OPFS)
- **Styling:** the original Up-inspired stylesheet, plus Tailwind CSS v4
- **Components:** shadcn/ui, generated into `src/components/ui` with the CLI
- **Deploy:** multi-stage Docker image (Node builds the SPA, Python serves it)

TanStack packages are pinned to exact versions (no `^`). RC releases can change
collection semantics in a patch, and this app holds financial data.

## Features

- Sign in with your Up Banking Personal Access Token
- View all account balances (including 2Up joint accounts)
- Click an account to view transactions grouped by date
- Filter transactions by status (settled/pending) and date range
- Paginated transaction loading (50 at a time, with "Load more")
- Transaction detail panel: category, card method, foreign amounts, round-ups, cashback, sender
- Real-time transaction updates and toast notifications via Up webhooks
- Automatic webhook registration on login and deletion on logout
- Sign in once: the session lasts 30 days and extends on each visit
- Offline-first: accounts, transactions, categories and the pagination cursor are
  restored from a per-user local cache with no network round trip
- Background sync on reconnect, on webhook events, or from a Refresh button
- Balance blur toggle

## Data model: local-first with a durable cache

Collections are the source of truth for rendering; components never hold copies in
`useState`:

| Collection | Key | Source |
| --- | --- | --- |
| `accounts` | account id | `GET /api/accounts` |
| `transactions:<account>:<filters>` | transaction id | `GET /api/accounts/{id}/transactions` |

- `useLiveQuery` reads collections; webhook events refetch and the UI updates without
  manual state plumbing.
- The transactions endpoint returns `{ transactions, nextPage, categoryMap }`. `select`
  projects `transactions` into the collection; the envelope stays in the TanStack Query
  cache so pagination metadata and category names are read without a second request.
- "Load more" appends rows with `utils.writeUpsert`. A refetch replaces the collection
  with page 1, which is why the cursor resets whenever the envelope changes.
- A new `DbClient` + `QueryClient` is created per signed-in session. Ending the session
  (sign out or 401) drops the whole store rather than trying to scrub rows from a client
  that still has query observers attached.

### The local cache (OPFS SQLite)

When the browser supports it, every collection is wrapped in `persistedCollectionOptions`
and its rows are stored in SQLite (`wa-sqlite`, via
`@tanstack/browser-db-sqlite-persistence`) inside the Origin Private File System.
`initialRender: { strategy: 'network-first', networkTimeoutMs: 0 }` renders restored rows
immediately.

- **Per user.** The database is named after a non-reversible fingerprint of the Up token
  (`sha256(token)[:16]`) that the server returns from `GET /api/session`. Two Up accounts
  on one browser never read each other's rows.
- **Behind authentication.** Collections are only materialised after `GET /api/session`
  confirms the session. That probe re-checks the token against Up at most once per
  `SESSION_VERIFY_HOURS`, and a revoked token deletes the session and lands on the login
  screen, so cached rows are never shown to a browser that is no longer authorised.
- **Wiped on sign out.** "Sign out" closes SQLite and deletes the database files. Session
  expiry keeps the cache, because the next login is still authenticated.
- **Degrades cleanly.** Without OPFS (happy-dom in tests, Safari private mode, old
  browsers) `openLocalCache` returns null and the store is in-memory only.

### Offline-first fetching

A collection only hits the network when there is nothing cached to show. When a stored
copy exists (`rows > 0`), `enabled` is `false`, the restored rows render, and the app
syncs only on:

- **reconnect** — the browser's `online` event,
- **a webhook event** — while the tab is visible,
- **the Refresh button** — in the sidebar footer, next to a "Synced 4m ago" label,
- **a first visit** for that account/filter, when no cache exists.

`/api/events` polling pauses while the tab is hidden or offline, so a backgrounded tab
makes no requests at all. If a cache's rows are gone but its metadata survived (for
example the SQLite database was cleared outside the app), a short fallback timer forces a
fetch instead of hanging on "Loading".

Non-row response parts are stored in `localStorage` by `envelopeStore.ts`: the pagination
cursor, the category-name map, the row count used for the decision above, and the
last-synced time. It shares the same per-user namespace and is removed with the SQLite
files on sign out.

**Caveat:** the cursor is a position in a live, newest-first list. After a restore it can
point at a shifted window, so "Load more" after an offline period may skip or repeat
transactions. The button is disabled while offline; use Refresh first if the page boundary
matters.

### Why local-first is not the security control here

Local-first is a latency and resilience architecture. It does not improve authentication,
authorization, transport or storage security, and for financial data it *adds* exposure:
any XSS can read an in-memory store, and any at-rest store is readable by whoever has the
browser profile. So the security properties come from separate controls:

- **The Up token never reaches the browser.** The session cookie carries an opaque random
  id; the token lives in a server-side SQLite table. A signed cookie would be tamper-proof
  but readable, which is not good enough for a banking credential.
- **Strict CSP** — `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `worker-src 'self'`, no inline scripts, no third-party origins. Fonts are self-hosted
  for this reason.
- **`SameSite=Strict`** cookie plus an explicit `Origin` check on every unsafe method.
- **`Cache-Control: no-store`** on `/api/*` and the SPA shell.
- **Local rows are scoped to the user and removed on sign out.**
- **`X-Frame-Options: DENY`**, `nosniff`, `no-referrer`, COOP/CORP, and a restrictive
  `Permissions-Policy`.

`style-src 'unsafe-inline'` is required because React writes `style` attributes. It cannot
exfiltrate data because `connect-src` is `'self'`.

`'wasm-unsafe-eval'` is required to compile the SQLite wasm engine. It permits WebAssembly
compilation only, not JavaScript `eval`.

`SameSite=Strict` means following an external link into the app shows the login screen
once. That is the intended trade-off for banking data.

## Project layout

```
main.py                  FastAPI app: API routes, sessions, security middleware, SPA serving
.sessions.sqlite3        Server-side session store (created at startup, gitignored)
Procfile                 honcho process definitions for dev
frontend/
  index.html             Vite entry point
  vite.config.ts         Dev proxy → FastAPI on :8000, Tailwind, SQLite asset handling
  public/fonts/          Self-hosted woff2 fonts (no third-party origin)
  scripts/
    db-smoke.mjs         Data-layer test against the real TanStack DB packages
    persistence-smoke.ts Cache fallback when OPFS is unavailable
    render-smoke.mjs     Renders the production bundle in happy-dom
  src/
    App.tsx              Boot probe, per-session store, view switching
    api.ts               Typed fetch client (credentials: include)
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
components.json          shadcn/ui CLI configuration
Dockerfile               Multi-stage Node → Python build
docker-compose.yml
pyproject.toml
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
utilities but **not Preflight**, because the hand-tuned Up theme already has its own
reset and Preflight's global `line-height` would shift it. A small `base` layer recreates
the parts shadcn depends on (solid borders, form controls inheriting the page font).
Existing rules live in `@layer app`, ordered before `utilities`, so Tailwind spacing
utilities win over the global `* { margin: 0; padding: 0 }` reset while the app keeps
overriding the base layer.

Generated components read shadcn's semantic tokens (`--background`, `--primary`,
`--border`, ...). They are mapped to the Up palette in the `:root` block at the top of
`src/index.css`, so components match the app out of the box; change them there to
re-theme everything at once.

The v4 CLI generates components that import `cn` from the `cn` package. `src/lib/utils.ts`
is kept because `components.json` still aliases `utils` there for registry entries that
use the conventional `@/lib/utils` import.

## Development

One command starts both processes via [honcho](https://github.com/nickstenning/honcho)
(defined in `Procfile`). Vite proxies `/api` and `/logout` to FastAPI, so the session
cookie stays same-origin.

The proxy is configured with `changeOrigin: false` on purpose. Vite flips it to `true`
for the string shorthand form (`'/api': 'http://...'`), which rewrites the `Host` header
to `127.0.0.1:8000`; the server's CSRF check then sees `Origin: http://localhost:5173`
against a different host and returns `403 cross_origin_request_blocked`, which browsers
report as a CORS/blocked request. `X-Forwarded-Host` is also accepted for proxies that
do rewrite `Host`.

```bash
cp .env.example .env    # optional: tune the session lifetime
uv sync                 # installs Python deps, including honcho
cd frontend && npm install && cd ..

uv run honcho start
```

Open <http://localhost:5173>. Logs from both processes are prefixed with `api.1` and
`web.1`; Ctrl+C stops both. API docs are at <http://localhost:8000/docs>.

Sessions are stored in `.sessions.sqlite3` next to `main.py`, so a login survives server
restarts. That file holds live Up tokens: it is created with `0600` permissions and
ignored by git and Docker.

The local cache needs a secure context. `localhost` qualifies; any other host must be
served over HTTPS.

The `Procfile` is just:

```procfile
api: uvicorn main:app --reload --port 8000
web: npm --prefix frontend run dev -- --port 5173
```

So you can still run the processes separately if you prefer:

```bash
uv run uvicorn main:app --reload --port 8000
npm --prefix frontend run dev
```

### Checks

```bash
cd frontend
npm run lint
npm run build

npm run test:db          # collections, select, orderBy, pagination, teardown
npm run test:persistence # local cache falls back to memory without OPFS
npm run test:render      # production bundle in happy-dom: session probe → accounts →
                         # transactions → load more → sign out → re-login
```

`test:render` runs against `dist`, so build first.

## Production build

```bash
cd frontend
npm run build

cd ..
uv run uvicorn main:app --port 8000
```

FastAPI serves `frontend/dist` at `/`, mounts hashed assets under `/assets`, and falls back
to `index.html` for client-side routes. If `dist` is missing, `/` returns a 503 with a
build hint.

## Docker

```bash
docker compose build
docker compose up -d
```

The app is served on <http://localhost:8000>.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `SESSION_TTL_DAYS` | Optional | Login lifetime in days (default `30`). Slides forward on each visit. |
| `SESSION_VERIFY_HOURS` | Optional | How often the boot probe re-checks the Up token (default `6`). Between checks the stored session is trusted. |
| `SESSION_DB_PATH` | Optional | Path to the session store (default `.sessions.sqlite3` next to `main.py`). |
| `SESSION_HTTPS_ONLY` | Recommended in prod | Set to any non-empty value to mark cookies `Secure`. |
| `ALLOWED_ORIGINS` | Optional | Comma-separated extra origins allowed to make unsafe requests, e.g. `https://upbank.example.com`. Same-origin is always allowed. |
| `WEBHOOK_URL` | Optional | Public HTTPS URL for webhook delivery, e.g. `https://upbank.example.com/api/webhooks`. HTTP or localhost URLs are ignored. |

Webhooks require a publicly reachable HTTPS URL (for example via ngrok during local
development). Without one, real-time updates are disabled but everything else works.

## API routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | React SPA |
| POST | `/api/login` | JSON login (`{"accessToken": "..."}`) → `{ ok, uid, expiresAt }` |
| GET | `/api/session` | Boot probe → `{ authenticated, uid, expiresAt, verified, verifiedAt }` |
| POST | `/api/logout` | Delete webhook + clear session |
| GET | `/logout` | Same, then redirect home |
| GET | `/api/accounts` | Fresh account balances |
| GET | `/api/accounts/{id}/transactions` | Account transactions with filters |
| GET | `/api/transactions/next` | Next page by cursor |
| GET | `/api/tags` | All tags |
| POST | `/api/transactions/{id}/tags` | Add tags to a transaction |
| DELETE | `/api/transactions/{id}/tags` | Remove tags from a transaction |
| PATCH | `/api/transactions/{id}/category` | Set/clear transaction category |
| POST | `/api/webhooks` | Receive Up webhook events (HMAC-SHA256 verified) |
| GET | `/api/events` | Drain queued events |

Unsafe methods (`POST`/`PATCH`/`DELETE`) are rejected with `403` when an `Origin` header is
present and matches neither the request host, `X-Forwarded-Host`, nor `ALLOWED_ORIGINS`.

## Notes

- Like the original, this is a single-user app: the access token (for webhook handling) and
  webhook secret live in module-level state because Up's webhook callbacks arrive without a
  browser session. The session table can hold several browser sessions, but they share that
  module-level token.
- Webhook signatures are verified with HMAC-SHA256 against the raw request body.
- The main bundle is ~230 kB gzipped (TanStack DB, React, and the persistence wrapper). The
  SQLite engine is a separate ~530 kB gzipped wasm asset that is only fetched the first time
  the local cache opens, from a worker.
- `GET /api/session` costs at most one Up `util/ping` per `SESSION_VERIFY_HOURS`. That is
  what stops a revoked token from rendering cached rows without pinging Up on every load.
- The local cache is a convenience, not a source of truth. Balances and transaction status
  change server-side; anything that happened while the tab was closed appears on the next
  sync (reconnect, webhook, or Refresh).
