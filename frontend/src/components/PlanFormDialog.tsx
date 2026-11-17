import { useMemo, useState } from 'react'
import { useForm, useSelector } from '@tanstack/react-form'
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

const FORM_ID = 'plan-expense-form'

export function PlanFormDialog({
  open,
  row,
  onClose,
  onSave,
  onDelete,
}: PlanFormDialogProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The parent mounts a fresh dialog for every add/edit, so initial state is
  // the whole reset: a cancelled edit can never leak into the next one.
  const form = useForm({
    defaultValues: {
      name: row?.name ?? '',
      amount: row ? formatCents(row.amountCents) : '',
      frequency: (row?.frequency ?? 'WEEKLY') as Frequency,
      startDate: row?.startDate ?? '',
    },
    onSubmit: ({ value }) => {
      const cents = parseAmountToCents(value.amount)
      if (cents === null) return
      onSave(
        {
          name: value.name.trim(),
          amountCents: cents,
          frequency: value.frequency,
          startDate: value.startDate,
        },
        row?.id,
      )
    },
  })

  const amount = useSelector(form.store, (state) => state.values.amount)
  const frequency = useSelector(form.store, (state) => state.values.frequency)
  const startDate = useSelector(form.store, (state) => state.values.startDate)

  const preview = useMemo(() => {
    const cents = parseAmountToCents(amount)
    if (cents === null || cents <= 0) return null
    return Math.round(weeklySetAsideCents(cents, frequency))
  }, [amount, frequency])

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
      <form
        id={FORM_ID}
        className="plan-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field
          name="name"
          validators={{
            onSubmit: ({ value }) =>
              value.trim() ? undefined : 'Give the expense a name.',
          }}
        >
          {(field) => (
            <label className="plan-field">
              <span className="plan-field-label">Expense name</span>
              <input
                className="plan-input"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={MAX_EXPENSE_NAME_LENGTH}
                placeholder="Rent, electricity, car rego…"
                autoFocus
                required
              />
              {field.state.meta.errors.length > 0 && (
                <span className="plan-field-error">
                  {field.state.meta.errors.join(', ')}
                </span>
              )}
            </label>
          )}
        </form.Field>

        <div className="plan-form-row">
          <form.Field
            name="amount"
            validators={{
              onSubmit: ({ value }) => {
                const cents = parseAmountToCents(value)
                return cents !== null && cents > 0
                  ? undefined
                  : 'Enter an amount above $0.'
              },
            }}
          >
            {(field) => (
              <label className="plan-field">
                <span className="plan-field-label">Billed amount</span>
                <div className="plan-money-input">
                  <span className="plan-money-prefix">$</span>
                  <input
                    className="plan-input"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                  />
                </div>
                {field.state.meta.errors.length > 0 && (
                  <span className="plan-field-error">
                    {field.state.meta.errors.join(', ')}
                  </span>
                )}
              </label>
            )}
          </form.Field>

          <form.Field name="frequency">
            {(field) => (
              <label className="plan-field">
                <span className="plan-field-label">Frequency</span>
                <select
                  className="plan-select"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.target.value as Frequency)
                  }
                >
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </form.Field>
        </div>

        <form.Field
          name="startDate"
          validators={{
            onSubmit: ({ value }) =>
              isIsoDate(value) ? undefined : 'Choose the first occurrence.',
          }}
        >
          {(field) => (
            <label className="plan-field">
              <span className="plan-field-label">Start date</span>
              <input
                className="plan-input"
                type="date"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                required
              />
              {field.state.meta.errors.length > 0 && (
                <span className="plan-field-error">
                  {field.state.meta.errors.join(', ')}
                </span>
              )}
            </label>
          )}
        </form.Field>

        {preview !== null && (
          <div className="plan-preview" aria-live="polite">
            <div className="plan-preview-item">
              <span>Weekly set-aside</span>
              <strong>{formatMoney(preview)}</strong>
            </div>
            <p className="plan-preview-note">
              The first occurrence is{' '}
              {isIsoDate(startDate) ? formatCalendarDate(startDate) : 'the start date'};
              later occurrences follow the frequency.
            </p>
          </div>
        )}
      </form>
    </PlanModal>
  )
}
