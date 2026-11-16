import { useMemo, useState, type FormEvent } from 'react'
import {
  FREQUENCY_OPTIONS,
  MAX_EXPENSE_NAME_LENGTH,
  formatCalendarDate,
  formatCents,
  formatMoney,
  isIsoDate,
  parseAmountToCents,
  weeklySetAsideCents,
  type Frequency,
  type PlanDraftRow,
  type PlanRow,
} from '../budget'
import { PlanModal } from './PlanModal'

interface PlanFormDialogProps {
  open: boolean
  row: PlanRow | null
  onClose: () => void
  onSave: (draft: PlanDraftRow, id?: string) => void
  onDelete: (id: string) => void
}

interface FieldErrors {
  name?: string
  amount?: string
  start?: string
}

const FORM_ID = 'plan-expense-form'

export function PlanFormDialog({
  open,
  row,
  onClose,
  onSave,
  onDelete,
}: PlanFormDialogProps) {
  // The parent mounts a fresh dialog for every add/edit, so initial state is
  // the whole reset: a cancelled edit can never leak into the next one.
  const [name, setName] = useState(row?.name ?? '')
  const [amount, setAmount] = useState(row ? formatCents(row.amountCents) : '')
  const [frequency, setFrequency] = useState<Frequency>(row?.frequency ?? 'WEEKLY')
  const [startDate, setStartDate] = useState(row?.startDate ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  const preview = useMemo(() => {
    const cents = parseAmountToCents(amount)
    if (cents === null || cents <= 0) return null
    return Math.round(weeklySetAsideCents(cents, frequency))
  }, [amount, frequency])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    const next: FieldErrors = {}
    if (!trimmed) next.name = 'Give the expense a name.'
    const cents = parseAmountToCents(amount)
    if (cents === null || cents <= 0) next.amount = 'Enter an amount above $0.'
    if (!isIsoDate(startDate)) next.start = 'Choose the first occurrence.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSave(
      {
        name: trimmed,
        amountCents: cents as number,
        frequency,
        startDate,
      },
      row?.id,
    )
  }

  return (
    <PlanModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={row ? 'Edit expense' : 'Add an expense'}
      description={
        row
          ? 'Change the recurring expense. Occurrences are generated from the start date.'
          : 'Add a recurring expense. The start date is the first occurrence; later ones follow the frequency.'
      }
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            {row &&
              (confirmDelete ? (
                <span className="plan-inline-confirm">
                  <span>Delete this expense?</span>
                  <button
                    type="button"
                    className="plan-btn plan-btn-danger"
                    onClick={() => onDelete(row.id)}
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    className="plan-btn plan-btn-ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="plan-link-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete expense
                </button>
              ))}
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form={FORM_ID} className="plan-btn plan-btn-primary">
              {row ? 'Save changes' : 'Add expense'}
            </button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} className="plan-form" onSubmit={handleSubmit} noValidate>
        <label className="plan-field">
          <span className="plan-field-label">Expense name</span>
          <input
            className="plan-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_EXPENSE_NAME_LENGTH}
            placeholder="Rent, electricity, car rego…"
            autoFocus
            required
          />
          {errors.name && <span className="plan-field-error">{errors.name}</span>}
        </label>

        <div className="plan-form-row">
          <label className="plan-field">
            <span className="plan-field-label">Billed amount</span>
            <div className="plan-money-input">
              <span className="plan-money-prefix">$</span>
              <input
                className="plan-input"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </div>
            {errors.amount && <span className="plan-field-error">{errors.amount}</span>}
          </label>

          <label className="plan-field">
            <span className="plan-field-label">Frequency</span>
            <select
              className="plan-select"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as Frequency)}
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="plan-field">
          <span className="plan-field-label">Start date</span>
          <input
            className="plan-input"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
          {errors.start && <span className="plan-field-error">{errors.start}</span>}
        </label>

        {preview !== null && (
          <div className="plan-preview" aria-live="polite">
            <div className="plan-preview-item">
              <span>Weekly set-aside</span>
              <strong>{formatMoney(preview)}</strong>
            </div>
            <p className="plan-preview-note">
              The first occurrence is {isIsoDate(startDate) ? formatCalendarDate(startDate) : 'the start date'};
              later occurrences follow the frequency.
            </p>
          </div>
        )}
      </form>
    </PlanModal>
  )
}
