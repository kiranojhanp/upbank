import { useForm } from '@tanstack/react-form'
import type { TransactionFilters } from '../types'

interface FiltersProps {
  title: string
  value: TransactionFilters
  onApply: (next: TransactionFilters) => void
  onClear: () => void
  onExport: (filters: TransactionFilters) => void
  exporting: boolean
}

export function Filters({
  title,
  value,
  onApply,
  onClear,
  onExport,
  exporting,
}: FiltersProps) {
  const form = useForm({
    defaultValues: value,
    onSubmit: ({ value: next }) => onApply(next),
  })

  return (
    <div className="tx-header">
      <h2 className="tx-title">{title}</h2>
      <form
        className="filter-bar"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="status">
          {(field) => (
            <select
              className="filter-select"
              name={field.name}
              value={field.state.value ?? ''}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="SETTLED">Settled</option>
              <option value="HELD">Pending</option>
            </select>
          )}
        </form.Field>

        <form.Field name="since">
          {(field) => (
            <input
              type="date"
              className="filter-input"
              name={field.name}
              title="From date"
              value={field.state.value ?? ''}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>

        <form.Field name="until">
          {(field) => (
            <input
              type="date"
              className="filter-input"
              name={field.name}
              title="To date"
              value={field.state.value ?? ''}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>

        <button type="submit" className="filter-btn filter-btn-primary">
          Filter
        </button>
        <button
          type="button"
          className="filter-btn filter-btn-secondary"
          onClick={() => {
            form.reset({})
            onClear()
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="filter-btn filter-btn-export"
          onClick={() => onExport(form.state.values)}
          disabled={exporting}
          title="Export to CSV (uses the selected date range)"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </form>
    </div>
  )
}
