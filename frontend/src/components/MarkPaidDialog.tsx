import { useDbClient, useLiveQuery } from '@tanstack/react-db'
import { useMemo, useState } from 'react'
import { SessionExpiredError, api } from '../api'
import { formatMoney, localDateIso } from '../budget'
import { getTransactionsDescriptor } from '../db'
import type { Account, Transaction } from '../types'
import {
  endOfWeek,
  formatWeekDay,
  startOfWeek,
  type WeekOccurrence,
} from '../week'
import { PlanModal } from './PlanModal'

interface MarkPaidDialogProps {
  accounts: Account[]
  occurrence: WeekOccurrence
  online: boolean
  /** Transaction id → expense name, for transactions already used. */
  usedTransactions: Map<string, string>
  onClose: () => void
  onConfirm: (transaction: Transaction) => void
  onSessionExpired: () => void
}

interface Validation {
  ok: boolean
  message: string
  tone: 'hint' | 'error' | 'ok'
}

function transactionDay(transaction: Transaction): string {
  return localDateIso(new Date(transaction.attributes.createdAt))
}

function comparable(transaction: Transaction): string {
  return JSON.stringify({
    attributes: transaction.attributes,
    relationships: transaction.relationships,
  })
}

function signMoney(transaction: Transaction): string {
  const cents = transaction.attributes.amount.valueInBaseUnits
  if (typeof cents !== 'number') return '—'
  return `${cents < 0 ? '-' : '+'}${formatMoney(Math.abs(cents))}`
}

export function MarkPaidDialog({
  accounts,
  occurrence,
  online,
  usedTransactions,
  onClose,
  onConfirm,
  onSessionExpired,
}: MarkPaidDialogProps) {
  const dbClient = useDbClient()
  const [accountId, setAccountId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const entry = useMemo(
    () => (accountId ? getTransactionsDescriptor(accountId, {}) : null),
    [accountId],
  )
  const collection = useMemo(
    () => (entry ? dbClient.collection(entry.descriptor) : null),
    [dbClient, entry],
  )

  // This is the persisted row store the account view already fills. Reading it
  // is local: no Up request happens when the dialog opens or the account
  // changes.
  const { data: cachedTransactions, status: cacheStatus } = useLiveQuery({
    query: (q) =>
      collection
        ? q
            .from({ tx: collection })
            .orderBy(({ tx }) => tx.attributes.createdAt, 'desc')
        : undefined,
  })

  const transactions = useMemo(
    () => cachedTransactions ?? [],
    [cachedTransactions],
  )
  const selected =
    transactions.find((transaction) => transaction.id === selectedId) ?? null
  const account = accounts.find((candidate) => candidate.id === accountId) ?? null
  const expectedCents = occurrence.expense.amountCents
  const usedBy = selected ? usedTransactions.get(selected.id) : undefined

  let validation: Validation
  if (!accountId) {
    validation = {
      ok: false,
      message: 'Choose the Up account that paid this expense.',
      tone: 'hint',
    }
  } else if (!selected) {
    validation = {
      ok: false,
      message: `Choose a transaction from ${account?.attributes.displayName ?? 'this account'}.`,
      tone: 'hint',
    }
  } else if (usedBy) {
    validation = {
      ok: false,
      message: `This transaction is already used for ${usedBy}.`,
      tone: 'error',
    }
  } else {
    const amount = selected.attributes.amount.valueInBaseUnits
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      validation = {
        ok: false,
        message: 'This transaction has no usable amount.',
        tone: 'error',
      }
    } else if (amount >= 0) {
      validation = {
        ok: false,
        message: 'Credits cannot pay an expense. Choose a debit transaction.',
        tone: 'error',
      }
    } else if (Math.abs(amount) !== expectedCents) {
      validation = {
        ok: false,
        message: `Amounts do not match: the transaction is ${formatMoney(Math.abs(amount))}, but ${occurrence.expense.name} is ${formatMoney(expectedCents)}.`,
        tone: 'error',
      }
    } else {
      validation = {
        ok: true,
        message: `Amount matches. This transaction can pay ${occurrence.expense.name}.`,
        tone: 'ok',
      }
    }
  }

  const warnings: string[] = []
  if (selected) {
    if (selected.attributes.status !== 'SETTLED') {
      warnings.push('This transaction is still pending.')
    }
    const date = transactionDay(selected)
    if (
      date < startOfWeek(occurrence.date) ||
      date > endOfWeek(occurrence.date)
    ) {
      warnings.push('This transaction is dated outside the occurrence week.')
    }
  }

  async function loadTransactions() {
    if (!online || !accountId || !collection) return
    setLoadingTransactions(true)
    setLoadError(null)
    try {
      // Explicit, user-triggered sync for an account with no cache. This is
      // the only place the picker talks to Up.
      const fetched = await api.allTransactions(accountId, {})
      const current = collection.toArray
      const currentById = new Map(current.map((transaction) => [transaction.id, transaction]))
      const nextById = new Map(fetched.map((transaction) => [transaction.id, transaction]))
      const deleteIds = current
        .filter((transaction) => {
          const next = nextById.get(transaction.id)
          return !next || comparable(next) !== comparable(transaction)
        })
        .map((transaction) => transaction.id)
      const insertRows = fetched.filter((transaction) => {
        const existing = currentById.get(transaction.id)
        return !existing || comparable(existing) !== comparable(transaction)
      })
      if (deleteIds.length > 0) {
        await collection.delete(deleteIds).when('settled')
      }
      if (insertRows.length > 0) {
        await collection.insert(insertRows).when('settled')
      }
    } catch (cause) {
      if (cause instanceof SessionExpiredError) {
        onSessionExpired()
        return
      }
      setLoadError(
        cause instanceof Error ? cause.message : 'Could not load transactions.',
      )
    } finally {
      setLoadingTransactions(false)
    }
  }

  const cacheReady = cacheStatus === 'ready' || cacheStatus === 'error'

  return (
    <PlanModal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={`Mark ${occurrence.expense.name} as paid`}
      description="Choose the Up account, then the exact transaction that paid this occurrence. Only a matching debit can be saved."
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            <span className="mark-paid-total">
              {formatMoney(expectedCents)}
            </span>
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              disabled={!validation.ok}
              onClick={() => selected && validation.ok && onConfirm(selected)}
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

      <label className="mark-paid-account">
        <span>Up account</span>
        <select
          className="plan-select"
          value={accountId}
          onChange={(event) => {
            setAccountId(event.target.value)
            setSelectedId(null)
            setLoadError(null)
          }}
        >
          <option value="">Choose an account…</option>
          {accounts.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.attributes.displayName}
            </option>
          ))}
        </select>
      </label>

      {!accountId ? (
        <p className="mark-paid-empty">
          Choose the Up account first. Its cached transactions will appear here.
        </p>
      ) : !cacheReady ? (
        <p className="mark-paid-empty">Loading cached transactions…</p>
      ) : (
        <>
          <div className="mark-paid-head">
            <span>
              Cached transactions{' '}
              {transactions.length > 0 ? `· ${transactions.length}` : ''}
            </span>
            <button
              type="button"
              className="week-refresh"
              onClick={() => void loadTransactions()}
              disabled={!online || loadingTransactions}
            >
              {loadingTransactions
                ? 'Loading…'
                : transactions.length > 0
                  ? 'Refresh from Up'
                  : 'Load from Up'}
            </button>
          </div>

          {loadError && (
            <div className="mark-paid-error">
              <p>{loadError}</p>
              <button
                type="button"
                className="week-refresh"
                onClick={() => void loadTransactions()}
                disabled={!online || loadingTransactions}
              >
                Try again
              </button>
            </div>
          )}

          {transactions.length > 0 ? (
            <div className="mark-paid-list">
              {transactions.map((transaction) => {
                const isSelected = selectedId === transaction.id
                const usedFor = usedTransactions.get(transaction.id)
                const amount = transaction.attributes.amount.valueInBaseUnits
                const thisWeek =
                  transactionDay(transaction) >= startOfWeek(occurrence.date) &&
                  transactionDay(transaction) <= endOfWeek(occurrence.date)
                return (
                  <button
                    key={transaction.id}
                    type="button"
                    className={`week-tx week-tx-button mark-paid-row${isSelected ? ' is-selected' : ''}`}
                    disabled={Boolean(usedFor)}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(transaction.id)}
                  >
                    <span className="week-tx-date">
                      {formatWeekDay(transactionDay(transaction))}
                    </span>
                    <span className="week-tx-main">
                      <span className="week-tx-desc">
                        {transaction.attributes.description || 'Transaction'}
                      </span>
                      <span className="week-tx-sub">
                        {transaction.attributes.status !== 'SETTLED'
                          ? 'Pending'
                          : 'Settled'}
                        {thisWeek ? ' · This week' : ''}
                      </span>
                    </span>
                    <span
                      className={`week-tx-amount${typeof amount === 'number' && amount > 0 ? ' credit' : ''}`}
                    >
                      {signMoney(transaction)}
                    </span>
                    {usedFor ? (
                      <span className="mark-paid-used">Used for {usedFor}</span>
                    ) : (
                      <span className="mark-paid-check">
                        {isSelected ? 'Selected' : 'Choose'}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : !loadingTransactions ? (
            <p className="mark-paid-empty">
              {online
                ? 'No cached transactions for this account. Load them from Up once, then they will be available locally.'
                : 'No cached transactions for this account. Reconnect to load them from Up.'}
            </p>
          ) : null}

          <div className={`mark-paid-validation is-${validation.tone}`}>
            {validation.message}
          </div>
          {warnings.map((warning) => (
            <p className="mark-paid-warning" key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}
    </PlanModal>
  )
}
