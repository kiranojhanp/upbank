import { useEffect, useMemo, useRef, useState } from 'react'
import { formatMoney, localDateIso } from '../budget'
import { PLAN_PREFIX, readPlan } from '../planStore'
import type { Account } from '../types'
import { useWeekTransactions } from '../useWeekTransactions'
import {
  deriveWeekEntries,
  formatWeekDay,
  summariseWeek,
  type WeekEntry,
  type WeekSnapshot,
  type WeekTransaction,
} from '../week'
import { WEEK_PREFIX, newWeekEntryId, readWeek, writeWeek } from '../weekStore'
import { WeekEntryDialog } from './WeekEntryDialog'

interface WeekBoardProps {
  uid: string
  weekStart: string
  weekEnd: string
  accounts: Account[]
  online: boolean
  onNotify: (label: string, description?: string) => void
  onOpenPlan: () => void
  onSessionExpired: () => void
}

type EntryDialogState = { mode: 'add' } | { mode: 'edit'; entry: WeekEntry }

const EMPTY_LINKS: Record<string, string> = {}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function isPending(status: string): boolean {
  return status !== 'SETTLED'
}

function transactionDay(transaction: WeekTransaction): string {
  return localDateIso(new Date(transaction.createdAt))
}

export function WeekBoard({
  uid,
  weekStart,
  weekEnd,
  accounts,
  online,
  onNotify,
  onOpenPlan,
  onSessionExpired,
}: WeekBoardProps) {
  const [planRows, setPlanRows] = useState(() => readPlan(uid).rows)
  const derivedEntries = useMemo(
    () => deriveWeekEntries(planRows, weekStart),
    [planRows, weekStart],
  )
  const [stored, setStored] = useState<Pick<WeekSnapshot, 'entries' | 'links'> | null>(() =>
    readWeek(uid, weekStart),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<EntryDialogState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const detailRef = useRef<HTMLElement | null>(null)

  const entries = stored?.entries ?? derivedEntries
  const links = stored?.links ?? EMPTY_LINKS
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null

  const week = useWeekTransactions({
    accounts,
    weekStart,
    weekEnd,
    online,
    onSessionExpired,
  })
  const summary = useMemo(
    () => summariseWeek(entries, links, week.transactions),
    [entries, links, week.transactions],
  )
  const selectedSummary =
    summary.entries.find((item) => item.entry.id === selectedEntry?.id) ?? null

  // Another tab may edit the plan that seeds this week, or the week itself.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PLAN_PREFIX)) {
        setPlanRows(readPlan(uid).rows)
      }
      if (event.key === null || event.key.startsWith(WEEK_PREFIX)) {
        setStored(readWeek(uid, weekStart))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [uid, weekStart])

  function commit(nextEntries: WeekEntry[], nextLinks: Record<string, string>) {
    setStored({ entries: nextEntries, links: nextLinks })
    if (!writeWeek(uid, weekStart, { entries: nextEntries, links: nextLinks })) {
      onNotify(
        'Week not saved',
        'This browser refused the write, so the change will be lost on reload.',
      )
    }
  }

  function selectEntry(id: string) {
    setSelectedId(id)
    // On stacked layouts the detail pane sits below the list; bring it into
    // view when an entry is chosen so the transaction list is right there.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches) {
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  function handleSaveEntry(draft: { name: string; budgetCents: number }, id?: string) {
    const base = entries
    if (id) {
      commit(
        base.map((entry) =>
          entry.id === id ? { ...entry, name: draft.name, budgetCents: draft.budgetCents } : entry,
        ),
        links,
      )
      setAnnouncement(`${draft.name} updated`)
      setDialog(null)
      return
    }

    const newId = newWeekEntryId()
    commit([...base, { id: newId, name: draft.name, budgetCents: draft.budgetCents }], links)
    selectEntry(newId)
    setDialog(null)
    setAnnouncement(`${draft.name} added`)
  }

  function handleDeleteEntry(id: string) {
    const removed = entries.find((entry) => entry.id === id)
    const nextLinks: Record<string, string> = {}
    let unassigned = 0
    for (const [transactionId, entryId] of Object.entries(links)) {
      if (entryId === id) unassigned += 1
      else nextLinks[transactionId] = entryId
    }
    commit(
      entries.filter((entry) => entry.id !== id),
      nextLinks,
    )
    setDialog(null)
    setAnnouncement(
      `${removed?.name ?? 'Entry'} removed${unassigned > 0 ? `, ${unassigned} unassigned` : ''}`,
    )
  }

  function handleAttach(transaction: WeekTransaction) {
    if (!selectedEntry) return
    const previousEntryId = links[transaction.id]
    if (previousEntryId === selectedEntry.id) {
      handleDetach(transaction)
      return
    }
    commit(entries, { ...links, [transaction.id]: selectedEntry.id })
    const previous = entries.find((entry) => entry.id === previousEntryId)
    setAnnouncement(
      `${transaction.description} ${previous ? 'moved' : 'attached'} to ${selectedEntry.name}`,
    )
  }

  function handleDetach(transaction: WeekTransaction) {
    const nextLinks = { ...links }
    delete nextLinks[transaction.id]
    commit(entries, nextLinks)
    setAnnouncement(`${transaction.description} detached from ${selectedEntry?.name ?? 'entry'}`)
  }

  function restoreFromPlan() {
    commit(derivedEntries, {})
    setSelectedId(null)
    setAnnouncement(
      `Week filled with ${derivedEntries.length} ${derivedEntries.length === 1 ? 'entry' : 'entries'} from the set-aside plan`,
    )
  }

  const hasTransactions = week.transactions !== null
  const otherTransactions = selectedEntry
    ? (week.transactions ?? []).filter(
        (transaction) => links[transaction.id] !== selectedEntry.id,
      )
    : []
  const percent =
    summary.spentCents !== null && summary.plannedCents > 0
      ? Math.min(100, Math.round((summary.spentCents / summary.plannedCents) * 100))
      : 0
  const overBudget = summary.leftCents !== null && summary.leftCents < 0

  return (
    <>
      <p className="plan-sr-only" aria-live="polite">
        {announcement}
      </p>
      <div className="week-summary">
        <div className="week-summary-main">
          <span className="week-summary-kicker">Spent this week</span>
          <p className="week-summary-value">
            <strong>
              {summary.spentCents === null ? '—' : formatMoney(summary.spentCents)}
            </strong>
            <span>
              {summary.plannedCents > 0
                ? ` of ${formatMoney(summary.plannedCents)} planned`
                : ' with no budget planned'}
            </span>
          </p>
          <div className="week-summary-bar" aria-hidden="true">
            <span
              className={overBudget ? 'is-over' : undefined}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
        <div className="week-summary-metrics">
          <div data-week-stat="planned">
            <span>Planned</span>
            <b>{formatMoney(summary.plannedCents)}</b>
          </div>
          <div data-week-stat="left">
            <span>Left</span>
            <b className={overBudget ? 'is-over' : undefined}>
              {summary.leftCents === null
                ? '—'
                : `${summary.leftCents < 0 ? '-' : ''}${formatMoney(
                    Math.abs(summary.leftCents),
                  )}`}
            </b>
          </div>
          <div data-week-stat="unassigned">
            <span>Unassigned</span>
            <b>
              {summary.unassignedCents === null
                ? '—'
                : `${summary.unassignedCount} · ${formatMoney(summary.unassignedCents)}`}
            </b>
          </div>
        </div>
      </div>

      <div className="week-board">
        <aside className="week-pane week-entries-pane" aria-label="Budget entries">
          <div className="week-pane-head">
            <div>
              <h3>Budget entries</h3>
              <p>
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'} ·{' '}
                {formatMoney(summary.plannedCents)} planned
              </p>
            </div>
            <button
              type="button"
              className="week-icon-btn"
              aria-label="Add budget entry"
              onClick={() => setDialog({ mode: 'add' })}
            >
              <PlusIcon />
            </button>
          </div>

          {entries.length === 0 ? (
            <div className="week-empty-list">
              <p>No budget entries for this week.</p>
              <div className="week-empty-actions">
                <button
                  type="button"
                  className="plan-btn plan-btn-primary"
                  onClick={() => setDialog({ mode: 'add' })}
                >
                  Add entry
                </button>
                <button
                  type="button"
                  className="plan-btn plan-btn-ghost"
                  onClick={onOpenPlan}
                >
                  Open set-aside plan
                </button>
                {stored && derivedEntries.length > 0 && (
                  <button
                    type="button"
                    className="plan-btn plan-btn-ghost"
                    onClick={restoreFromPlan}
                  >
                    Use set-aside plan
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="week-entry-list">
              {summary.entries.map((item) => {
                const { entry, spentCents, remainingCents } = item
                const over = remainingCents !== null && remainingCents < 0
                const width =
                  spentCents !== null && entry.budgetCents > 0
                    ? Math.min(100, (spentCents / entry.budgetCents) * 100)
                    : 0
                const isSelected = selectedEntry?.id === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`week-entry${isSelected ? ' is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => selectEntry(entry.id)}
                  >
                    <span className="week-entry-top">
                      <span className="week-entry-name">{entry.name}</span>
                      <span
                        className={`week-entry-remaining${over ? ' is-over' : ''}`}
                      >
                        {remainingCents === null
                          ? ''
                          : over
                            ? `${formatMoney(Math.abs(remainingCents))} over`
                            : `${formatMoney(remainingCents)} left`}
                      </span>
                    </span>
                    {spentCents !== null && (
                      <span className="week-entry-bar" aria-hidden="true">
                        <span
                          className={over ? 'is-over' : undefined}
                          style={{ width: `${width}%` }}
                        />
                      </span>
                    )}
                    <span className="week-entry-meta">
                      <span>{formatMoney(entry.budgetCents)} planned</span>
                      <span>
                        {spentCents === null
                          ? item.linkedCount > 0
                            ? `${item.linkedCount} linked`
                            : 'Spend unavailable'
                          : item.attached.length > 0
                            ? `${item.attached.length} tx · ${formatMoney(spentCents)}`
                            : 'Nothing attached'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        {selectedEntry ? (
          <article
            className="week-pane week-detail"
            aria-labelledby="week-detail-title"
            ref={detailRef}
          >
            <header className="week-detail-head">
              <div>
                <p className="week-detail-eyebrow">Budget entry</p>
                <h3 id="week-detail-title" className="week-detail-title">
                  {selectedEntry.name}
                </h3>
                {selectedEntry.sourcePlanId && (
                  <p className="week-detail-source">
                    Weekly set-aside from your plan
                  </p>
                )}
              </div>
              <button
                type="button"
                className="plan-btn plan-btn-ghost"
                onClick={() => setDialog({ mode: 'edit', entry: selectedEntry })}
              >
                Edit
              </button>
            </header>

            <div className="week-figures">
              <div className="week-figure">
                <span>Planned</span>
                <b>{formatMoney(selectedEntry.budgetCents)}</b>
              </div>
              <div className="week-figure">
                <span>Attached</span>
                <b>
                  {selectedSummary?.spentCents == null
                    ? '—'
                    : formatMoney(selectedSummary.spentCents)}
                </b>
              </div>
              <div className="week-figure">
                <span>
                  {selectedSummary?.remainingCents != null &&
                  selectedSummary.remainingCents < 0
                    ? 'Over'
                    : 'Left'}
                </span>
                <b
                  className={
                    selectedSummary?.remainingCents != null &&
                    selectedSummary.remainingCents < 0
                      ? 'is-over'
                      : undefined
                  }
                >
                  {selectedSummary?.remainingCents == null
                    ? '—'
                    : formatMoney(Math.abs(selectedSummary.remainingCents))}
                </b>
              </div>
            </div>

            <section className="week-detail-section">
              <div className="week-section-head">
                <h4>
                  Attached{' '}
                  <span>
                    {hasTransactions
                      ? (selectedSummary?.attached.length ?? 0)
                      : (selectedSummary?.linkedCount ?? 0)}
                  </span>
                </h4>
              </div>

              {!hasTransactions && (selectedSummary?.linkedCount ?? 0) > 0 && (
                <p className="week-section-note">
                  Linked transactions are saved, but reconnect to show their details.
                </p>
              )}

              {selectedSummary && selectedSummary.attached.length > 0 ? (
                <div className="week-tx-list">
                  {selectedSummary.attached.map((transaction) => (
                    <div className="week-tx is-attached" key={transaction.id}>
                      <span className="week-tx-date">
                        {formatWeekDay(transactionDay(transaction))}
                      </span>
                      <span className="week-tx-main">
                        <span className="week-tx-desc">{transaction.description}</span>
                        <span className="week-tx-sub">
                          {transaction.accountName}
                          {isPending(transaction.status) ? ' · Pending' : ''}
                        </span>
                      </span>
                      <span className="week-tx-amount">
                        -{formatMoney(transaction.amountCents)}
                      </span>
                      <button
                        type="button"
                        className="week-tx-remove"
                        aria-label={`Detach ${transaction.description}`}
                        onClick={() => handleDetach(transaction)}
                      >
                        <XIcon />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="week-section-note">
                  {hasTransactions
                    ? week.transactions?.length === 0
                      ? 'No spending transactions in this week.'
                      : 'Nothing attached yet. Pick a transaction below.'
                    : 'Attached transactions will appear here once this week is loaded.'}
                </p>
              )}
            </section>

            <section className="week-detail-section">
              <div className="week-section-head">
                <h4>
                  Other transactions this week{' '}
                  <span>{hasTransactions ? otherTransactions.length : '—'}</span>
                </h4>
                <button
                  type="button"
                  className="week-refresh"
                  onClick={() => void week.refetch()}
                  disabled={!online || week.fetching}
                  aria-label="Refresh transactions"
                >
                  {week.fetching ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {!online && !hasTransactions ? (
                <p className="week-section-note">
                  Connect to Up to load this week&apos;s transactions. Your entries and
                  attachments are saved.
                </p>
              ) : week.error && !hasTransactions ? (
                <div className="week-tx-error">
                  <p>Could not load this week&apos;s transactions.</p>
                  <p className="week-tx-error-detail">{week.error.message}</p>
                  <button
                    type="button"
                    className="plan-btn plan-btn-ghost"
                    onClick={() => void week.refetch()}
                  >
                    Try again
                  </button>
                </div>
              ) : week.loading && !hasTransactions ? (
                <p className="week-section-note">Loading this week&apos;s transactions…</p>
              ) : !hasTransactions ? (
                <p className="week-section-note">Transactions are unavailable right now.</p>
              ) : otherTransactions.length === 0 ? (
                <p className="week-section-note">
                  {week.transactions?.length === 0
                    ? 'No spending transactions in this week.'
                    : 'Every spending transaction this week is attached to this entry.'}
                </p>
              ) : (
                <>
                  <p className="week-section-hint">
                    Click a transaction to attach it to <strong>{selectedEntry.name}</strong>.
                  </p>
                  <div className="week-tx-list">
                    {otherTransactions.map((transaction) => {
                      const linkedEntry = entries.find(
                        (entry) => entry.id === links[transaction.id],
                      )
                      return (
                        <button
                          key={transaction.id}
                          type="button"
                          className="week-tx week-tx-button"
                          aria-label={`${linkedEntry ? 'Move' : 'Attach'} ${transaction.description} to ${selectedEntry.name}`}
                          onClick={() => handleAttach(transaction)}
                        >
                          <span className="week-tx-date">
                            {formatWeekDay(transactionDay(transaction))}
                          </span>
                          <span className="week-tx-main">
                            <span className="week-tx-desc">{transaction.description}</span>
                            <span className="week-tx-sub">
                              {transaction.accountName}
                              {isPending(transaction.status) ? ' · Pending' : ''}
                              {linkedEntry ? ` · ${linkedEntry.name}` : ''}
                            </span>
                          </span>
                          <span className="week-tx-amount">
                            -{formatMoney(transaction.amountCents)}
                          </span>
                          <span className="week-tx-action">
                            {linkedEntry ? 'Move here' : 'Attach'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {week.error && (
                    <p className="week-section-note is-error">
                      Showing saved results. {week.error.message}
                    </p>
                  )}
                </>
              )}
            </section>
          </article>
        ) : (
          <div className="week-pane week-detail week-detail-empty">
            <p className="week-detail-eyebrow">Nothing selected</p>
            <p>
              Add a budget entry to start attaching this week&apos;s transactions to it.
            </p>
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              onClick={() => setDialog({ mode: 'add' })}
            >
              Add entry
            </button>
          </div>
        )}
      </div>

      {dialog !== null && (
        <WeekEntryDialog
          key={dialog.mode === 'edit' ? dialog.entry.id : 'add'}
          entry={dialog.mode === 'edit' ? dialog.entry : null}
          attachedCount={
            dialog.mode === 'edit'
              ? Object.values(links).filter((entryId) => entryId === dialog.entry.id).length
              : 0
          }
          onClose={() => setDialog(null)}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
        />
      )}
    </>
  )
}
