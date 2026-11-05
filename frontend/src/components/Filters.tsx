import type { TransactionFilters } from '../types'

interface FiltersProps {
  title: string
  value: TransactionFilters
  onChange: (next: TransactionFilters) => void
  onApply: () => void
  onClear: () => void
}

export function Filters({ title, value, onChange, onApply, onClear }: FiltersProps) {
  return (
    <div className="tx-header">
      <h2 className="tx-title">{title}</h2>
      <div className="filter-bar">
        <select
          className="filter-select"
          value={value.status ?? ''}
          onChange={(event) => onChange({ ...value, status: event.target.value })}
        >
          <option value="">All statuses</option>
          <option value="SETTLED">Settled</option>
          <option value="HELD">Pending</option>
        </select>

        <input
          type="date"
          className="filter-input"
          title="From date"
          value={value.since ?? ''}
          onChange={(event) => onChange({ ...value, since: event.target.value })}
        />

        <input
          type="date"
          className="filter-input"
          title="To date"
          value={value.until ?? ''}
          onChange={(event) => onChange({ ...value, until: event.target.value })}
        />

        <button className="filter-btn filter-btn-primary" onClick={onApply}>
          Filter
        </button>
        <button className="filter-btn filter-btn-secondary" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
