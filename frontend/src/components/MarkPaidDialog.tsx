import { useState } from 'react'
import { formatMoney, localDateIso } from '../budget'
import { formatWeekDay, type WeekOccurrence, type WeekTransaction } from '../week'
import { PlanModal } from './PlanModal'

interface MarkPaidDialogProps {
  occurrence: WeekOccurrence
  transactions: WeekTransaction[] | null
  loading: boolean
  error: Error | null
  online: boolean
  /** Transaction id → expense name, for transactions already used this period. */
  usedTransactions: Map<string, string>
  onRefresh: () => void
  onClose: () => void
  onConfirm: (transaction: WeekTransaction) => void
}

function transactionDay(transaction: WeekTransaction): string {
  return localDateIso(new Date(transaction.createdAt))
}

export function MarkPaidDialog({
  occurrence,
  transactions,
  loading,
  error,
  online,
  usedTransactions,
  onRefresh,
  onClose,
  onConfirm,
}: MarkPaidDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = transactions?.find((transaction) => transaction.id === selectedId) ?? null

  return (
    <PlanModal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`Mark ${occurrence.expense.name} as paid`}
      description="Choose the Up transaction that paid this occurrence. It will disappear from this week; the next occurrence appears in its own week."
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            <span className="mark-paid-total">
              {formatMoney(occurrence.expense.amountCents)}
            </span>
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              disabled={!selected}
              onClick={() => selected && onConfirm(selected)}
            >
              Mark paid
            </button>
          </div>
        </div>
      }
    >
      <div className="mark-paid-meta">
        <span>
          Due {formatWeekDay(occurrence.date)} ·{' '}
          {occurrence.expense.frequency.toLowerCase()}
        </span>
      </div>

      {!online && !transactions ? (
        <p className="week-section-note">
          Connect to Up to load this week&apos;s transactions, then mark this paid.
        </p>
      ) : error && !transactions ? (
        <div className="week-tx-error">
          <p>Could not load this week&apos;s transactions.</p>
          <p className="week-tx-error-detail">{error.message}</p>
          <button type="button" className="plan-btn plan-btn-ghost" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : loading && !transactions ? (
        <p className="week-section-note">Loading this week&apos;s transactions…</p>
      ) : !transactions || transactions.length === 0 ? (
        <p className="week-section-note">
          No debit transactions in this week. Nothing to associate yet.
        </p>
      ) : (
        <>
          <div className="mark-paid-head">
            <span>This week&apos;s transactions</span>
            <button
              type="button"
              className="week-refresh"
              onClick={onRefresh}
              disabled={!online}
            >
              Refresh
            </button>
          </div>
          <div className="mark-paid-list">
            {transactions.map((transaction) => {
              const usedBy = usedTransactions.get(transaction.id)
              const isSelected = selectedId === transaction.id
              return (
                <button
                  key={transaction.id}
                  type="button"
                  className={`week-tx week-tx-button mark-paid-row${isSelected ? ' is-selected' : ''}`}
                  disabled={Boolean(usedBy)}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(transaction.id)}
                >
                  <span className="week-tx-date">
                    {formatWeekDay(transactionDay(transaction))}
                  </span>
                  <span className="week-tx-main">
                    <span className="week-tx-desc">{transaction.description}</span>
                    <span className="week-tx-sub">
                      {transaction.accountName}
                      {transaction.status !== 'SETTLED' ? ' · Pending' : ''}
                    </span>
                  </span>
                  <span className="week-tx-amount">
                    -{formatMoney(transaction.amountCents)}
                  </span>
                  {usedBy ? (
                    <span className="mark-paid-used">Used for {usedBy}</span>
                  ) : (
                    <span className="mark-paid-check">
                      {isSelected ? 'Selected' : 'Choose'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {error && (
            <p className="week-section-note is-error">
              Showing saved results. {error.message}
            </p>
          )}
        </>
      )}
    </PlanModal>
  )
}
