import { useEffect, useMemo, useRef, useState } from 'react'
import { FREQUENCY_SPECS, formatCalendarDate, formatMoney } from '../budget'
import { PAID_PREFIX, markPaid, readPaid, type PaidMap } from '../paidStore'
import { PLAN_PREFIX, readPlan } from '../planStore'
import type { Account, Transaction } from '../types'
import {
  formatWeekDay,
  nextDateAfterOccurrence,
  summariseWeek,
  type WeekOccurrence,
} from '../week'
import { MarkPaidDialog } from './MarkPaidDialog'

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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

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
  const [paid, setPaid] = useState<PaidMap>(() => readPaid(uid))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<WeekOccurrence | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const detailRef = useRef<HTMLElement | null>(null)

  const summary = useMemo(
    () => summariseWeek(planRows, paid, weekStart, weekEnd),
    [planRows, paid, weekStart, weekEnd],
  )
  const selectedOccurrence =
    summary.occurrences.find((occurrence) => occurrence.key === selectedKey) ??
    summary.due[0] ??
    summary.occurrences[0] ??
    null

  const usedTransactions = useMemo(() => {
    const used = new Map<string, string>()
    for (const occurrence of Object.values(paid)) {
      const expense = planRows.find((row) => row.id === occurrence.expenseId)
      if (expense) used.set(occurrence.transactionId, expense.name)
    }
    return used
  }, [paid, planRows])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PLAN_PREFIX)) {
        setPlanRows(readPlan(uid).rows)
      }
      if (event.key === null || event.key.startsWith(PAID_PREFIX)) {
        setPaid(readPaid(uid))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [uid])

  function selectOccurrence(occurrence: WeekOccurrence) {
    setSelectedKey(occurrence.key)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches) {
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }

  function handleMarkPaid(transaction: Transaction) {
    if (!pickerFor) return
    const saved = markPaid(
      uid,
      pickerFor.expense.id,
      pickerFor.date,
      transaction.id,
    )
    if (!saved) {
      onNotify(
        'Payment not saved',
        'This browser refused the write, so the paid occurrence will return on reload.',
      )
      return
    }
    setPaid(readPaid(uid))
    setPickerFor(null)
    setAnnouncement(
      `${pickerFor.expense.name} marked paid for ${formatWeekDay(pickerFor.date)}`,
    )
  }

  const dueCount = summary.due.length
  const paidCount = summary.paid.length
  const paidLabel = `${paidCount} ${paidCount === 1 ? 'expense' : 'expenses'}`

  return (
    <>
      <p className="plan-sr-only" aria-live="polite">
        {announcement}
      </p>

      <div className="week-summary">
        <div className="week-summary-main">
          <span className="week-summary-kicker">Due this week</span>
          <p className="week-summary-value" data-week-stat="due">
            <strong>{formatMoney(summary.dueCents)}</strong>
            <span>
              {' '}
              across {dueCount} {dueCount === 1 ? 'expense' : 'expenses'}
            </span>
          </p>
        </div>
        <div className="week-summary-metrics">
          <div data-week-stat="paid">
            <span>Paid</span>
            <b>
              {paidCount} · {formatMoney(summary.paidCents)}
            </b>
          </div>
          <div data-week-stat="setaside">
            <span>Set aside</span>
            <b>{formatMoney(summary.weeklySetAsideCents)}</b>
          </div>
        </div>
      </div>

      <div className="week-board">
        <aside className="week-pane week-entries-pane" aria-label="Recurring expenses this week">
          <div className="week-pane-head">
            <div>
              <h3>Due this week</h3>
              <p>
                {dueCount} {dueCount === 1 ? 'expense' : 'expenses'} ·{' '}
                {formatMoney(summary.dueCents)}
              </p>
            </div>
            <button
              type="button"
              className="week-icon-btn"
              aria-label="Manage recurring expenses"
              onClick={onOpenPlan}
            >
              <PlusIcon />
            </button>
          </div>

          {dueCount === 0 ? (
            <div className="week-empty-list">
              <p>
                {paidCount > 0
                  ? `All done for this week — ${paidLabel} paid.`
                  : 'Nothing due this week.'}
              </p>
              <div className="week-empty-actions">
                <button
                  type="button"
                  className="plan-btn plan-btn-ghost"
                  onClick={onOpenPlan}
                >
                  Manage recurring expenses
                </button>
              </div>
            </div>
          ) : (
            <div className="week-entry-list">
              {summary.due.map((occurrence) => {
                const isSelected = selectedOccurrence?.key === occurrence.key
                return (
                  <button
                    key={occurrence.key}
                    type="button"
                    className={`week-entry${isSelected ? ' is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => selectOccurrence(occurrence)}
                  >
                    <span className="week-entry-top">
                      <span className="week-entry-name">{occurrence.expense.name}</span>
                      <span className="week-entry-remaining">
                        {formatMoney(occurrence.expense.amountCents)}
                      </span>
                    </span>
                    <span className="week-entry-meta">
                      <span>
                        {FREQUENCY_SPECS[occurrence.expense.frequency].label} ·{' '}
                        {formatWeekDay(occurrence.date)}
                      </span>
                      <span>View</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {paidCount > 0 && (
            <section className="week-paid-block" aria-labelledby="week-paid-title">
              <div className="week-paid-head">
                <div>
                  <h3 id="week-paid-title">Paid this week</h3>
                  <p>
                    {paidCount} {paidCount === 1 ? 'expense' : 'expenses'} ·{' '}
                    {formatMoney(summary.paidCents)}
                  </p>
                </div>
              </div>
              <div className="week-paid-list">
                {summary.paid.map((occurrence) => {
                  const isSelected = selectedOccurrence?.key === occurrence.key
                  return (
                    <button
                      key={occurrence.key}
                      type="button"
                      className={`week-entry week-entry-paid${isSelected ? ' is-selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => selectOccurrence(occurrence)}
                    >
                      <span className="week-entry-top">
                        <span className="week-entry-name">{occurrence.expense.name}</span>
                        <span className="week-entry-remaining">
                          {formatMoney(occurrence.expense.amountCents)}
                        </span>
                      </span>
                      <span className="week-entry-meta">
                        <span>
                          {FREQUENCY_SPECS[occurrence.expense.frequency].label} ·{' '}
                          {formatWeekDay(occurrence.date)}
                        </span>
                        <span className="week-paid-badge">
                          <CheckIcon />
                          Paid
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </aside>

        {selectedOccurrence ? (
          <article
            className="week-pane week-detail"
            aria-labelledby="week-detail-title"
            ref={detailRef}
          >
            <header className="week-detail-head">
              <div>
                <p className="week-detail-eyebrow">
                  {selectedOccurrence.paid ? 'Paid this week' : 'Recurring expense'}
                </p>
                <h3 id="week-detail-title" className="week-detail-title">
                  {selectedOccurrence.expense.name}
                </h3>
                <p className="week-detail-source">
                  {FREQUENCY_SPECS[selectedOccurrence.expense.frequency].label} from{' '}
                  {formatCalendarDate(selectedOccurrence.expense.startDate)}
                </p>
              </div>
            </header>

            <div className="week-figures">
              <div className="week-figure">
                <span>Amount</span>
                <b>{formatMoney(selectedOccurrence.expense.amountCents)}</b>
              </div>
              <div className="week-figure">
                <span>Due</span>
                <b>{formatWeekDay(selectedOccurrence.date)}</b>
              </div>
              <div className="week-figure">
                <span>Next</span>
                <b>
                  {formatCalendarDate(
                    nextDateAfterOccurrence(
                      selectedOccurrence.expense,
                      selectedOccurrence.date,
                    ),
                  )}
                </b>
              </div>
            </div>

            {selectedOccurrence.paid ? (
              <section className="week-detail-section week-paid-section">
                <p className="week-paid-status">
                  <span className="week-paid-status-icon">
                    <CheckIcon />
                  </span>
                  Paid this week
                </p>
                <p className="week-pay-hint">
                  This occurrence stays in the week for reference. The next occurrence
                  appears in its own week.
                </p>
              </section>
            ) : (
              <section className="week-detail-section week-pay-section">
                <p className="week-pay-hint">
                  Marking this paid asks you to choose the Up transaction that paid it.
                  It then moves under “Paid this week” so you can still see it, and the
                  next occurrence appears in its own week.
                </p>
                <button
                  type="button"
                  className="plan-btn plan-btn-primary week-pay-btn"
                  onClick={() => setPickerFor(selectedOccurrence)}
                >
                  Mark paid
                </button>
              </section>
            )}
          </article>
        ) : (
          <div className="week-pane week-detail week-detail-empty">
            <p className="week-detail-eyebrow">Nothing scheduled</p>
            <p>No recurring expenses fall in this week.</p>
            <button
              type="button"
              className="plan-btn plan-btn-ghost"
              onClick={onOpenPlan}
            >
              Manage recurring expenses
            </button>
          </div>
        )}
      </div>

      {pickerFor && (
        <MarkPaidDialog
          key={pickerFor.key}
          occurrence={pickerFor}
          weekStart={weekStart}
          weekEnd={weekEnd}
          accounts={accounts}
          online={online}
          usedTransactions={usedTransactions}
          onClose={() => setPickerFor(null)}
          onConfirm={handleMarkPaid}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  )
}
