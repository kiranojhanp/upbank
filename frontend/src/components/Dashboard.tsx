import { useDbClient, useLiveQuery } from '@tanstack/react-db'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SessionExpiredError, api } from '../api'
import { accountsDescriptor, getTransactionsDescriptor } from '../db'
import {
  readEnvelope,
  readLastSynced,
  subscribeStoredData,
  writeEnvelope,
  writeLastSynced,
} from '../envelopeStore'
import { formatRelativeTime } from '../format'
import type { Account, TransactionFilters } from '../types'
import { forgetUserData } from '../persistence'
import type { TransactionsSeed } from '../pagination'
import { useDocumentVisible, useOnlineStatus } from '../useOnlineStatus'
import { AccountCard, SidebarBrand } from './AccountCard'
import { Filters } from './Filters'
import { Toasts, type ToastItem } from './Toasts'
import { TransactionsView, type TransactionsHandle } from './TransactionsView'

interface DashboardProps {
  uid: string
  cacheAvailable: boolean
  onSessionExpired: () => void
  onSignOut: () => void
}

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

const ACCOUNTS_CACHE_KEY = 'accounts'
// How long to wait before kicking a collection that never became ready. With a
// warm cache the restore makes it ready immediately; this only covers a cache
// that was cleared outside the app while its metadata survived.
const READY_FALLBACK_MS = 1500
// Without a webhook feed, balances are re-read from Up on a slow timer while
// the tab is visible. It refreshes accounts only, so it never collapses a
// transaction list the user has paged through.
const POLL_INTERVAL_MS = 60_000

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function EyeOpenIcon() {
  return (
    <svg
      id="eye-open"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.8"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function EyeClosedIcon() {
  return (
    <svg
      id="eye-closed"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.8"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  )
}

export function Dashboard({ uid, cacheAvailable, onSessionExpired, onSignOut }: DashboardProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [draftFilters, setDraftFilters] = useState<TransactionFilters>({})
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>({})
  const [isBlurred, setIsBlurred] = useState(false)
  const [revealedAccountId, setRevealedAccountId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [timedOutEntry, setTimedOutEntry] = useState<string | null>(null)

  const toastId = useRef(0)
  const refreshingRef = useRef(false)
  const transactionsRef = useRef<TransactionsHandle>(null)
  const dbClient = useDbClient()
  const online = useOnlineStatus()
  const visible = useDocumentVisible()

  const lastSynced = useSyncExternalStore(
    subscribeStoredData,
    () => readLastSynced(uid),
    () => null,
  )

  const accountsCollection = useMemo(
    () => dbClient.collection(accountsDescriptor),
    [dbClient],
  )

  const { data: accounts, status: accountsStatus } = useLiveQuery({
    query: (q) =>
      q.from({ accounts: accountsCollection }).orderBy(({ accounts }) => accounts.sortIndex, 'asc'),
  })

  // Mirror the non-row parts of the accounts response so the next cold start
  // knows a cache exists and when it was last refreshed. Use Query's update
  // time, not render time: restoring rows offline must not extend the cache's
  // 90-day lifetime.
  useEffect(() => {
    if (!accounts) return
    const at = accountsCollection.utils.dataUpdatedAt
    if (!at) return
    const storedAccounts = readEnvelope(uid, ACCOUNTS_CACHE_KEY)
    if (storedAccounts && at <= storedAccounts.syncedAt) return
    writeEnvelope(uid, ACCOUNTS_CACHE_KEY, {
      rows: accounts.length,
      nextPage: null,
      categoryMap: {},
      syncedAt: at,
      oldestCreatedAt: null,
    })
    if (accounts.length > 0) writeLastSynced(uid, at)
  }, [accounts, accountsCollection, uid])

  const selectedAccount = useMemo(
    () => accounts?.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )

  const transactionsEntry = useMemo(
    () => (selectedAccountId ? getTransactionsDescriptor(selectedAccountId, appliedFilters) : null),
    [selectedAccountId, appliedFilters],
  )

  const transactionsCollection = useMemo(
    () => (transactionsEntry ? dbClient.collection(transactionsEntry.descriptor) : null),
    [dbClient, transactionsEntry],
  )

  // The collection is the offline mirror. Read it first so the infinite query
  // can start from cached rows instead of fetching page 1 on every cold start.
  const { data: cachedTransactions, status: cacheStatus } = useLiveQuery({
    query: (q) =>
      transactionsCollection
        ? q
            .from({ tx: transactionsCollection })
            .orderBy(({ tx }) => tx.attributes.createdAt, 'desc')
        : undefined,
  })

  const stored = useMemo(
    () => (transactionsEntry ? readEnvelope(uid, transactionsEntry.id) : null),
    [uid, transactionsEntry],
  )

  const seed = useMemo<TransactionsSeed | null>(() => {
    if (!stored || stored.rows <= 0 || !cachedTransactions?.length) return null
    return {
      rows: cachedTransactions,
      nextPage: stored.nextPage,
      categoryMap: stored.categoryMap,
      syncedAt: stored.syncedAt,
      oldestCreatedAt: stored.oldestCreatedAt,
    }
  }, [stored, cachedTransactions])

  const cacheReady = cacheStatus === 'ready' || cacheStatus === 'error'
  const expectingCache = Boolean(stored && stored.rows > 0)
  const cacheTimedOut = Boolean(transactionsEntry && timedOutEntry === transactionsEntry.id)
  const waitingForSeed = Boolean(transactionsEntry && expectingCache && !seed)
  const waitingForCache = Boolean(transactionsEntry && (!cacheReady || waitingForSeed))

  useEffect(() => {
    if (!transactionsEntry || !waitingForCache) return
    const id = transactionsEntry.id
    const timer = window.setTimeout(() => setTimedOutEntry(id), READY_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [transactionsEntry, waitingForCache])

  const canMountTransactions = Boolean(
    transactionsEntry &&
      transactionsCollection &&
      (seed || cacheTimedOut || (cacheReady && !expectingCache)),
  )
  const isJoint = selectedAccount?.attributes.ownershipType === 'JOINT'

  const addToast = useCallback((label: string, description?: string, amount?: string) => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, label, description, amount }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  // Full refresh: balances plus all loaded transaction pages. Infinite Query's
  // refetch keeps the page count, so a paged list is refreshed without
  // collapsing back to page 1.
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      await accountsCollection.utils.refetch({ throwOnError: true })
      await transactionsRef.current?.refresh()
      writeLastSynced(uid, Date.now())
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onSessionExpired()
        return
      }
      addToast('Refresh failed', errorDetail(error))
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [accountsCollection, uid, onSessionExpired, addToast])

  // Lighter sync for polling, focus and reconnect. It deliberately refreshes
  // balances only, so returning to the tab cannot reset the transaction pages.
  const refreshAccounts = useCallback(
    async (notify: boolean) => {
      try {
        await accountsCollection.utils.refetch({ throwOnError: true })
        writeLastSynced(uid, Date.now())
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          onSessionExpired()
          return
        }
        if (notify) addToast('Could not refresh balances', errorDetail(error))
      }
    },
    [accountsCollection, uid, onSessionExpired, addToast],
  )

  // Coming back online refreshes balances. Transactions refresh from the
  // Refresh button or a filter change, never by collapsing the paged list.
  useEffect(() => {
    const onOnline = () => void refreshAccounts(true)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshAccounts])

  function handleSelectAccount(account: Account) {
    setSelectedAccountId(account.id)
    setRevealedAccountId(account.id)
    setSidebarOpen(false)
  }

  function handleApplyFilters() {
    setAppliedFilters(draftFilters)
  }

  function handleClearFilters() {
    setDraftFilters({})
    setAppliedFilters({})
  }

  // Export the selected account as CSV. Only the date inputs are sent, so with
  // no dates chosen the file spans the account's whole history.
  async function handleExportCsv() {
    if (!selectedAccount || exporting) return
    if (!online) {
      addToast('Export unavailable offline', 'Reconnect to download a CSV')
      return
    }
    setExporting(true)
    try {
      const { blob, filename } = await api.exportTransactionsCsv(
        selectedAccount.id,
        draftFilters,
      )
      downloadBlob(blob, filename)
      addToast('CSV exported', selectedAccount.attributes.displayName)
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onSessionExpired()
        return
      }
      addToast('Export failed', errorDetail(error))
    } finally {
      setExporting(false)
    }
  }

  function toggleBlur() {
    setIsBlurred((current) => !current)
    setRevealedAccountId(null)
  }

  async function handleClearCache() {
    try {
      await forgetUserData(uid)
      window.location.reload()
    } catch (error) {
      addToast('Could not clear the offline cache', errorDetail(error))
    }
  }

  // Up has no client-side event stream, so a slow account poll stands in for
  // the old webhook feed while the tab is visible.
  useEffect(() => {
    if (!online || !visible) return
    const interval = window.setInterval(() => void refreshAccounts(false), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [online, visible, refreshAccounts])

  // Returning to the tab refreshes balances only; the transaction list keeps
  // its loaded pages. Use Refresh for a full transaction refetch.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) void refreshAccounts(false)
    wasVisible.current = visible
  }, [visible, refreshAccounts])

  // A warm cache makes a collection ready without a fetch. If it stays idle
  // (for example the SQLite database was cleared outside the app while this
  // metadata survived), kick it once so the UI cannot hang on "Loading".
  const kickedAccounts = useRef(false)
  useEffect(() => {
    if (accountsStatus !== 'loading' && accountsStatus !== 'idle') {
      kickedAccounts.current = false
      return
    }
    if (!online || kickedAccounts.current) return
    const timer = window.setTimeout(() => {
      kickedAccounts.current = true
      void accountsCollection.utils.refetch().catch(() => {})
    }, READY_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [accountsStatus, online, accountsCollection])

  return (
    <>
      <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div id="sidebar-overlay" onClick={() => setSidebarOpen(false)} />

        <aside className="sidebar">
          <SidebarBrand />

          <div className="sidebar-scroll">
            <div className="sidebar-label-row">
              <span className="sidebar-label">Accounts</span>
              <button
                id="balance-toggle-btn"
                className="balance-toggle-btn"
                title="Toggle balance visibility"
                onClick={toggleBlur}
              >
                {isBlurred ? <EyeOpenIcon /> : <EyeClosedIcon />}
              </button>
            </div>

            <div className="account-list">
              {(accounts ?? []).map((account, index) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  index={index}
                  selected={selectedAccountId === account.id}
                  blurred={isBlurred && revealedAccountId !== account.id}
                  onSelect={handleSelectAccount}
                />
              ))}
            </div>
          </div>

          <div className="sidebar-footer">
            {!cacheAvailable && (
              <p className="cache-note">Offline cache unavailable — this session only.</p>
            )}
            <div className="sync-status">
              <span className="sync-time">
                {online
                  ? lastSynced
                    ? `Synced ${formatRelativeTime(lastSynced)}`
                    : 'Not synced yet'
                  : 'Offline'}
              </span>
              <button
                type="button"
                className="refresh-btn"
                onClick={() => void refresh()}
                disabled={refreshing || !online}
                title={online ? 'Fetch fresh data from Up' : 'Unavailable offline'}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {cacheAvailable && (
              <button
                type="button"
                className="logout-link"
                onClick={() => void handleClearCache()}
              >
                Clear cache
              </button>
            )}
            <button type="button" className="logout-link" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </aside>

        <main>
          {!selectedAccount && (
            <div id="empty-state" className="empty-state">
              <p className="empty-eyebrow">Up Web</p>
              <p className="empty-headline">
                Select an account
                <br /> to view <em>transactions</em>
              </p>
            </div>
          )}

          {selectedAccount && (
            <section id="transactions-section">
              <Filters
                title={selectedAccount.attributes.displayName}
                value={draftFilters}
                onChange={setDraftFilters}
                onApply={handleApplyFilters}
                onClear={handleClearFilters}
                onExport={handleExportCsv}
                exporting={exporting}
              />

              {canMountTransactions && transactionsEntry && transactionsCollection ? (
                <TransactionsView
                  key={`${transactionsEntry.id}:${seed ? 'seed' : 'empty'}`}
                  ref={transactionsRef}
                  uid={uid}
                  cacheKey={transactionsEntry.id}
                  accountId={selectedAccount.id}
                  filters={appliedFilters}
                  collection={transactionsCollection}
                  seed={seed}
                  online={online}
                  isJoint={Boolean(isJoint)}
                  onSessionExpired={onSessionExpired}
                  onNotify={addToast}
                />
              ) : (
                <p className="loading-text">Loading…</p>
              )}
            </section>
          )}
        </main>
      </div>

      <button id="accounts-fab" aria-label="Open accounts" onClick={() => setSidebarOpen(true)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        Accounts
      </button>

      <Toasts items={toasts} onDismiss={dismissToast} />

    </>
  )
}
