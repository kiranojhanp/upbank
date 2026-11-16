import { useDbClient, useLiveQuery } from '@tanstack/react-db'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { SessionExpiredError, api } from '../api'
import { accountsDescriptor, getTransactionsDescriptor, useTransactionsEnvelope } from '../db'
import {
  readEnvelope,
  readLastSynced,
  subscribeStoredData,
  writeEnvelope,
  writeLastSynced,
} from '../envelopeStore'
import { formatRelativeTime, groupByDate } from '../format'
import type { Account, Transaction, TransactionFilters } from '../types'
import { useDocumentVisible, useOnlineStatus } from '../useOnlineStatus'
import { AccountCard, SidebarBrand } from './AccountCard'
import { DetailPanel } from './DetailPanel'
import { Filters } from './Filters'
import { Toasts, type ToastItem } from './Toasts'
import { TransactionItem } from './TransactionItem'

interface DashboardProps {
  uid: string
  onSessionExpired: () => void
  onSignOut: () => void
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

export function Dashboard({ uid, onSessionExpired, onSignOut }: DashboardProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [draftFilters, setDraftFilters] = useState<TransactionFilters>({})
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>({})
  const [panelTransactionId, setPanelTransactionId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isBlurred, setIsBlurred] = useState(false)
  const [revealedAccountId, setRevealedAccountId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const toastId = useRef(0)
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
  // knows a cache exists and when it was last refreshed.
  useEffect(() => {
    if (!accounts) return
    const at = Date.now()
    writeEnvelope(uid, ACCOUNTS_CACHE_KEY, {
      rows: accounts.length,
      nextPage: null,
      categoryMap: {},
      syncedAt: at,
    })
    if (accounts.length > 0) writeLastSynced(uid, at)
  }, [accounts, uid])

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

  const {
    data: transactions,
    status: transactionsStatus,
    isSyncError: transactionsSyncError,
  } = useLiveQuery({
    query: (q) =>
      transactionsCollection
        ? q
            .from({ tx: transactionsCollection })
            .orderBy(({ tx }) => tx.attributes.createdAt, 'desc')
        : undefined,
  })

  // Cursor and category names restored from the previous visit. The live
  // envelope takes precedence once the network answers.
  const stored = useMemo(
    () => (transactionsEntry ? readEnvelope(uid, transactionsEntry.id) : null),
    [uid, transactionsEntry],
  )

  const [pagination, setPagination] = useState<{
    source: unknown
    nextPage: string | null
  }>({ source: undefined, nextPage: null })

  const envelope = useTransactionsEnvelope(dbClient, transactionsEntry?.queryKey)
  const categoryMap = envelope?.categoryMap ?? stored?.categoryMap ?? {}

  // A refetch replaces the collection with page 1, so pagination restarts
  // whenever the live envelope (or the restored one) changes. Adjusting state
  // during render is the documented alternative to a setState-in-effect cascade.
  const envelopeSource = envelope ?? stored ?? null
  if (pagination.source !== envelopeSource) {
    setPagination({
      source: envelopeSource,
      nextPage: envelope?.nextPage ?? stored?.nextPage ?? null,
    })
  }

  const nextPage = pagination.nextPage

  // Persist the envelope after a successful fetch so a reload can render the
  // cursor and category names without a network round trip.
  useEffect(() => {
    if (!envelope || !transactionsEntry) return
    const at = Date.now()
    writeEnvelope(uid, transactionsEntry.id, {
      rows: envelope.transactions.length,
      nextPage: envelope.nextPage,
      categoryMap: envelope.categoryMap,
      syncedAt: at,
    })
    if (envelope.transactions.length > 0) writeLastSynced(uid, at)
  }, [envelope, transactionsEntry, uid])

  const panelTransaction = useMemo(
    () => transactions?.find((transaction) => transaction.id === panelTransactionId) ?? null,
    [transactions, panelTransactionId],
  )

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

  // Pull fresh accounts and the selected account's transactions. Triggered by
  // reconnect, tab focus, the Refresh button, and a first visit with no cache;
  // everything else renders from SQLite.
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await accountsCollection.utils.refetch()
      if (transactionsCollection) await transactionsCollection.utils.refetch()
      writeLastSynced(uid, Date.now())
    } catch (error) {
      if (error instanceof SessionExpiredError) onSessionExpired()
    } finally {
      setRefreshing(false)
    }
  }, [accountsCollection, transactionsCollection, uid, onSessionExpired])

  // Lighter background sync for the poll: balances only, so it does not reset
  // the transaction list or flip the Refresh button.
  const refreshAccounts = useCallback(async () => {
    try {
      await accountsCollection.utils.refetch()
      writeLastSynced(uid, Date.now())
    } catch (error) {
      if (error instanceof SessionExpiredError) onSessionExpired()
    }
  }, [accountsCollection, uid, onSessionExpired])

  // Coming back online is an explicit sync trigger. Listening to the DOM event
  // (rather than a state change) keeps the refresh out of the effect body.
  useEffect(() => {
    const onOnline = () => void refresh()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refresh])

  function handleSelectAccount(account: Account) {
    setSelectedAccountId(account.id)
    setRevealedAccountId(account.id)
    setPanelTransactionId(null)
    setSidebarOpen(false)
  }

  function handleApplyFilters() {
    setPanelTransactionId(null)
    setAppliedFilters(draftFilters)
  }

  function handleClearFilters() {
    setPanelTransactionId(null)
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
      addToast('Export failed', error instanceof Error ? error.message : undefined)
    } finally {
      setExporting(false)
    }
  }

  async function handleLoadMore() {
    if (!nextPage || !transactionsCollection || !transactionsEntry || loadingMore || !online) return
    setLoadingMore(true)
    try {
      const data = await api.nextTransactions(nextPage)
      await transactionsCollection.utils.writeUpsert(data.transactions)
      setPagination((current) => ({ ...current, nextPage: data.nextPage }))
      writeEnvelope(uid, transactionsEntry.id, {
        rows: (transactions?.length ?? 0) + data.transactions.length,
        nextPage: data.nextPage,
        categoryMap,
        syncedAt: Date.now(),
      })
    } catch (error) {
      if (error instanceof SessionExpiredError) onSessionExpired()
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleBlur() {
    setIsBlurred((current) => !current)
    setRevealedAccountId(null)
  }

  // Up has no client-side event stream, so a slow account poll stands in for
  // the old webhook feed while the tab is visible. Backgrounded tabs make no
  // requests, and reconnecting to the network already triggers a full refresh.
  useEffect(() => {
    if (!online || !visible) return
    const interval = window.setInterval(() => void refreshAccounts(), POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [online, visible, refreshAccounts])

  // Returning to the tab is the natural moment to pull fresh transactions.
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (visible && !wasVisible.current) void refresh()
    wasVisible.current = visible
  }, [visible, refresh])

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

  useEffect(() => {
    if (!online || !transactionsCollection) return
    if (transactionsStatus !== 'loading' && transactionsStatus !== 'idle') return
    const timer = window.setTimeout(() => {
      void transactionsCollection.utils.refetch().catch(() => {})
    }, READY_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [transactionsStatus, online, transactionsCollection])

  const groupedTransactions = useMemo(() => groupByDate(transactions ?? []), [transactions])
  const isJoint = selectedAccount?.attributes.ownershipType === 'JOINT'
  const showLoading = transactionsStatus === 'loading' || transactionsStatus === 'idle'
  const showingCached = !online && !showLoading && (transactions?.length ?? 0) > 0

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

              {(transactionsSyncError || showingCached) && (
                <p className="offline-note">Offline — showing saved transactions.</p>
              )}

              <div id="transaction-list" className="transaction-list">
                {showLoading && (transactions?.length ?? 0) === 0 ? (
                  <p className="loading-text">Loading…</p>
                ) : groupedTransactions.length === 0 ? (
                  <p className="loading-text">No transactions found.</p>
                ) : (
                  groupedTransactions.map(({ date, items }) => (
                    <Fragment key={date}>
                      <div className="transaction-date-header">{date}</div>
                      {items.map((transaction: Transaction) => (
                        <TransactionItem
                          key={transaction.id}
                          transaction={transaction}
                          categoryMap={categoryMap}
                          isJoint={Boolean(isJoint)}
                          onOpen={(selected) => setPanelTransactionId(selected.id)}
                        />
                      ))}
                    </Fragment>
                  ))
                )}
              </div>

              {nextPage && (
                <div
                  id="load-more-container"
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    marginTop: '1.5rem',
                    padding: '0.5rem 0 1rem',
                  }}
                >
                  <button
                    id="load-more-btn"
                    className="load-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore || !online}
                    title={online ? undefined : 'Unavailable offline'}
                  >
                    {loadingMore ? 'Loading…' : online ? 'Load more' : 'Load more (offline)'}
                  </button>
                </div>
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

      <DetailPanel
        transaction={panelTransaction}
        categoryMap={categoryMap}
        isJoint={Boolean(isJoint)}
        onClose={() => setPanelTransactionId(null)}
      />
    </>
  )
}
