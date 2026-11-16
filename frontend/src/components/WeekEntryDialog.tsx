import { useState, type FormEvent } from 'react'
import {
  MAX_EXPENSE_NAME_LENGTH,
  formatCents,
  parseAmountToCents,
} from '../budget'
import type { WeekEntry } from '../week'
import { PlanModal } from './PlanModal'

interface WeekEntryDialogProps {
  entry: WeekEntry | null
  attachedCount: number
  onClose: () => void
  onSave: (draft: { name: string; budgetCents: number }, id?: string) => void
  onDelete: (id: string) => void
}

interface FieldErrors {
  name?: string
  budget?: string
}

const FORM_ID = 'week-entry-form'

export function WeekEntryDialog({
  entry,
  attachedCount,
  onClose,
  onSave,
  onDelete,
}: WeekEntryDialogProps) {
  const [name, setName] = useState(entry?.name ?? '')
  const [budget, setBudget] = useState(entry ? formatCents(entry.budgetCents) : '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    const next: FieldErrors = {}
    if (!trimmed) next.name = 'Give the entry a name.'
    const cents = parseAmountToCents(budget)
    if (cents === null) next.budget = 'Enter a planned amount.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    onSave({ name: trimmed, budgetCents: cents as number }, entry?.id)
  }

  return (
    <PlanModal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={entry ? 'Edit budget entry' : 'Add budget entry'}
      description="This changes this week only. Your recurring set-aside plan stays the same."
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            {entry &&
              (confirmDelete ? (
                <span className="plan-inline-confirm">
                  <span>
                    Delete entry?
                    {attachedCount > 0
                      ? ` ${attachedCount} attached ${attachedCount === 1 ? 'transaction' : 'transactions'} will be unassigned.`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="plan-btn plan-btn-danger"
                    onClick={() => onDelete(entry.id)}
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
                  Delete entry
                </button>
              ))}
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form={FORM_ID} className="plan-btn plan-btn-primary">
              {entry ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} className="plan-form" onSubmit={handleSubmit} noValidate>
        <label className="plan-field">
          <span className="plan-field-label">Entry name</span>
          <input
            className="plan-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_EXPENSE_NAME_LENGTH}
            placeholder="Groceries, Rent, Fuel…"
            autoFocus
            required
          />
          {errors.name && <span className="plan-field-error">{errors.name}</span>}
        </label>

        <label className="plan-field">
          <span className="plan-field-label">Planned for this week</span>
          <div className="plan-money-input">
            <span className="plan-money-prefix">$</span>
            <input
              className="plan-input"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              required
            />
          </div>
          {errors.budget && <span className="plan-field-error">{errors.budget}</span>}
        </label>

        {entry?.sourcePlanId && (
          <p className="week-form-note">
            Seeded from your set-aside plan. Editing it here does not change the plan.
          </p>
        )}
      </form>
    </PlanModal>
  )
}
