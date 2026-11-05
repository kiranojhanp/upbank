import { useEffect, useRef } from 'react'
import type { Transaction } from '../types'
import { fmt, formatAmount } from '../format'

interface DetailPanelProps {
  transaction: Transaction | null
  categoryMap: Record<string, string>
  isJoint: boolean
  onClose: () => void
}

export function DetailPanel({ transaction, categoryMap, isJoint, onClose }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!transaction) return
      const target = event.target as Element
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !target.closest('.transaction-item')
      ) {
        onClose()
      }
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [transaction, onClose])

  const attributes = transaction?.attributes
  const catId = transaction?.relationships?.category?.data?.id
  const categoryName = catId ? categoryMap[catId] : undefined
  const tags = transaction?.relationships?.tags?.data?.map((tag) => tag.id) ?? []

  return (
    <div ref={panelRef} className={`slide-out-panel${transaction ? ' open' : ''}`}>
      <div className="panel-content">
        {transaction && attributes && (
          <>
            <div className="panel-tx-header">
              <div>
                <p className="panel-tx-desc">{attributes.description}</p>
                {attributes.message && <small className="panel-tx-msg">{attributes.message}</small>}
              </div>
              <div
                className={`panel-tx-amount ${
                  attributes.amount.value.startsWith('-') ? 'debit' : 'credit'
                }`}
              >
                {formatAmount(attributes.amount.value).text}
              </div>
            </div>

            <hr />

            <div className="panel-row">
              <span className="panel-label">
                {(attributes.amount.valueInBaseUnits ?? 0) < 0 ? 'Paid on' : 'Received'}
              </span>
              <span>{new Date(attributes.createdAt).toLocaleString()}</span>
            </div>

            {isJoint && attributes.performingCustomer?.displayName && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Paid by</span>
                  <span className="performer-name">
                    {attributes.performingCustomer.displayName}
                  </span>
                </div>
              </>
            )}

            {attributes.settledAt && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Settled</span>
                  <span>{new Date(attributes.settledAt).toLocaleString()}</span>
                </div>
              </>
            )}

            {attributes.status === 'HELD' && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Status</span>
                  <span className="status-badge status-held">Pending</span>
                </div>
              </>
            )}

            {categoryName && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Category</span>
                  <span>{categoryName}</span>
                </div>
              </>
            )}

            {attributes.cardPurchaseMethod && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Method</span>
                  <span>{attributes.cardPurchaseMethod.method.replace(/_/g, ' ').toLowerCase()}</span>
                </div>
              </>
            )}

            {attributes.foreignAmount && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Foreign amount</span>
                  <span>
                    {attributes.foreignAmount.value} {attributes.foreignAmount.currencyCode}
                  </span>
                </div>
              </>
            )}

            {attributes.holdInfo && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Original hold</span>
                  <span>${fmt(Math.abs(Number(attributes.holdInfo.amount.value)))}</span>
                </div>
              </>
            )}

            {attributes.roundUp && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Round-up</span>
                  <span>${fmt(Math.abs(Number(attributes.roundUp.amount.value)))}</span>
                </div>
              </>
            )}

            {attributes.cashback && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Cashback</span>
                  <span style={{ color: 'var(--green)' }}>
                    +${fmt(Number(attributes.cashback.amount.value))}
                  </span>
                </div>
              </>
            )}

            {attributes.rawText && attributes.rawText !== attributes.description && (
              <>
                <hr />
                <div className="panel-row">
                  <span className="panel-label">Sender name</span>
                  <span>{attributes.rawText}</span>
                </div>
              </>
            )}

            {tags.length > 0 && (
              <div className="panel-tags">
                {tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
