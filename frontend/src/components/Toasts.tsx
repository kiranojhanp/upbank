import { fmt } from '../format'

export interface ToastItem {
  id: number
  label: string
  description?: string
  amount?: string
}

interface ToastsProps {
  items: ToastItem[]
  onDismiss: (id: number) => void
}

export function Toasts({ items, onDismiss }: ToastsProps) {
  return (
    <div id="toast-container">
      {items.map((toast) => {
        if (!toast.description) {
          return (
            <div key={toast.id} className="toast show" onClick={() => onDismiss(toast.id)}>
              {toast.label}
            </div>
          )
        }

        const debit = Boolean(toast.amount?.startsWith('-'))
        return (
          <div key={toast.id} className="toast show" onClick={() => onDismiss(toast.id)}>
            <div className="toast-label">{toast.label}</div>
            <div className="toast-detail">
              <span>{toast.description}</span>
              <span className={`toast-amount ${debit ? 'debit' : 'credit'}`}>
                {toast.amount
                  ? debit
                    ? `-$${fmt(toast.amount.substring(1))}`
                    : `+$${fmt(toast.amount)}`
                  : ''}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
