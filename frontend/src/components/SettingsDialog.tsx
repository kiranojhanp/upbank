import { useState } from 'react'
import { useForm, useSelector } from '@tanstack/react-form'
import { formatWeekRange, startOfWeek } from '../week'
import {
  WEEKDAY_OPTIONS,
  readSettings,
  weekStartsOnLabel,
  writeSettings,
  type WeekStartsOn,
} from '../settingsStore'
import { useToday } from '../useToday'
import { PlanModal } from './PlanModal'

interface SettingsDialogProps {
  uid: string
  onClose: () => void
  onSaved: () => void
}

const FORM_ID = 'settings-form'

export function SettingsDialog({ uid, onClose, onSaved }: SettingsDialogProps) {
  const today = useToday()
  const [error, setError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { weekStartsOn: readSettings(uid).weekStartsOn as WeekStartsOn },
    onSubmit: ({ value }) => {
      if (!writeSettings(uid, { weekStartsOn: value.weekStartsOn })) {
        setError('This browser refused to save the setting.')
        return
      }
      onSaved()
      onClose()
    },
  })

  const weekStartsOn = useSelector(form.store, (state) => state.values.weekStartsOn)
  const weekEndDay = weekStartsOnLabel(((weekStartsOn + 6) % 7) as WeekStartsOn)
  const preview = formatWeekRange(startOfWeek(today, weekStartsOn))

  return (
    <PlanModal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Settings"
      description="Choose how your budgeting week is laid out. Changes apply as soon as you save."
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            <button
              type="button"
              className="plan-btn plan-btn-ghost"
              onClick={() => form.setFieldValue('weekStartsOn', 3)}
            >
              Reset to Wednesday
            </button>
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form={FORM_ID} className="plan-btn plan-btn-primary">
              Save settings
            </button>
          </div>
        </div>
      }
    >
      <form
        id={FORM_ID}
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <section className="settings-section">
          <h4>Week</h4>
          <p className="settings-copy">
            The day your week starts determines the calendar strip, which occurrences
            are due, and how the week navigation moves.
          </p>

          <form.Field name="weekStartsOn">
            {(field) => (
              <label className="plan-field settings-field">
                <span className="plan-field-label">Week starts on</span>
                <select
                  className="plan-select"
                  name={field.name}
                  value={String(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(Number(event.target.value) as WeekStartsOn)
                  }
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </form.Field>

          <div className="settings-preview" aria-live="polite">
            <span>This week</span>
            <strong>{preview}</strong>
            <p>
              {weekStartsOnLabel(weekStartsOn)} to {weekEndDay}. Paid occurrences stay
              visible under “Paid this week”.
            </p>
          </div>

          {error && <p className="settings-error">{error}</p>}
        </section>
      </form>
    </PlanModal>
  )
}
