import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FREQUENCY_SPECS,
  MAX_PLAN_ROWS,
  formatCalendarDate,
  formatMoney,
  planToCsv,
  summarisePlan,
  weeklySetAsideCents,
  type PlanDraftRow,
  type PlanRow,
} from '../budget'
import { downloadBlob } from '../download'
import { formatRelativeTime } from '../format'
import { clearPaid, forgetPaidForExpenses } from '../paidStore'
import { PLAN_PREFIX, clearPlan, newPlanId, readPlan, writePlan } from '../planStore'
import { useToday } from '../useToday'
import { PlanFormDialog } from './PlanFormDialog'
import { PlanImportDialog } from './PlanImportDialog'
import { PlanModal } from './PlanModal'

interface PlanViewProps {
  uid: string
  onNotify: (label: string, description?: string) => void
  onBack: () => void
}

type EditorState = { mode: 'add' } | { mode: 'edit'; row: PlanRow }

function ReceiptIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  )
}

export function PlanView({ uid, onNotify, onBack }: PlanViewProps) {
  const initialPlan = useMemo(() => readPlan(uid), [uid])
  const [rows, setRows] = useState<PlanRow[]>(initialPlan.rows)
  const [savedAt, setSavedAt] = useState<number | null>(initialPlan.updatedAt)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const today = useToday()

  const summary = useMemo(() => summarisePlan(rows, today), [rows, today])
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  )
  const allSelected = rows.length > 0 && selectedRows.length === rows.length

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PLAN_PREFIX)) return
      const snapshot = readPlan(uid)
      setRows(snapshot.rows)
      setSavedAt(snapshot.updatedAt)
      setSelectedIds(new Set())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [uid])

  const commit = useCallback(
    (next: PlanRow[]) => {
      setRows(next)
      const saved = writePlan(uid, next)
      if (saved) {
        setSavedAt(Date.now())
      } else {
        onNotify(
          'Plan not saved',
          'This browser refused the write, so the change will be lost on reload. Export a CSV to keep it.',
        )
      }
      return saved
    },
    [uid, onNotify],
  )

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
  }

  function handleSave(draft: PlanDraftRow, id?: string) {
    if (id) {
      commit(
        rows.map((row) =>
          row.id === id
            ? {
                id,
                name: draft.name,
                amountCents: draft.amountCents,
                frequency: draft.frequency,
                startDate: draft.startDate,
              }
            : row,
        ),
      )
      onNotify('Recurring expense updated', draft.name)
    } else {
      commit([...rows, { ...draft, id: newPlanId() }])
      onNotify('Recurring expense added', draft.name)
    }
    setEditor(null)
  }

  function handleDelete(id: string) {
    const removed = rows.find((row) => row.id === id)
    const saved = commit(rows.filter((row) => row.id !== id))
    if (saved) forgetPaidForExpenses(uid, [id])
    setEditor(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    onNotify('Recurring expense removed', removed?.name)
  }

  function handleBulkDelete() {
    const doomed = selectedRows.map((row) => row.id)
    if (doomed.length === 0) return
    const saved = commit(rows.filter((row) => !selectedIds.has(row.id)))
    if (saved) forgetPaidForExpenses(uid, doomed)
    setSelectedIds(new Set())
    setConfirmBulk(false)
    onNotify(
      'Recurring expenses deleted',
      `${doomed.length} ${doomed.length === 1 ? 'expense' : 'expenses'} removed`,
    )
  }

  function handleImport(drafts: PlanDraftRow[], mode: 'append' | 'replace') {
    const imported = drafts.map((draft) => ({ ...draft, id: newPlanId() }))
    const next =
      mode === 'replace' ? imported : [...rows, ...imported].slice(0, MAX_PLAN_ROWS)
    const added = mode === 'replace' ? imported.length : next.length - rows.length
    const saved = commit(next)
    // Replacing the plan also replaces the expenses those paid occurrences
    // belonged to; appending leaves existing history alone.
    if (saved && mode === 'replace') clearPaid(uid)
    setImportOpen(false)
    setSelectedIds(new Set())
    onNotify(
      mode === 'replace' ? 'Plan replaced' : 'Recurring expenses imported',
      `${added} ${added === 1 ? 'expense' : 'expenses'} ${
        mode === 'replace' ? 'now in the plan' : 'added to the plan'
      }.`,
    )
  }

  function handleDeletePlan() {
    const cleared = clearPlan(uid)
    if (cleared) clearPaid(uid)
    setRows([])
    setSavedAt(null)
    setSelectedIds(new Set())
    setConfirmClear(false)
    onNotify('Plan deleted', 'Every recurring expense and its paid history was removed.')
  }

  function handleExport() {
    if (rows.length === 0) return
    downloadBlob(
      new Blob([planToCsv(summary.rows)], { type: 'text/csv;charset=utf-8' }),
      `recurring-expenses-${today}.csv`,
    )
    onNotify('Plan exported', `${rows.length} expenses · ${today}.csv`)
  }

  const hasRows = rows.length > 0

  return (
    <section id="plan-section" aria-labelledby="plan-title">
      <header className="plan-header">
        <div className="plan-heading">
          <button
            type="button"
            className="plan-back"
            onClick={onBack}
            aria-label="Back to week"
          >
            ← Back to week
          </button>
          <p className="plan-eyebrow">Set-aside plan</p>
          <h2 id="plan-title" className="plan-title">
            Recurring expenses
          </h2>
          <p className="plan-subtitle">
            The template behind each week. A start date and frequency generate the
            occurrences you see in Week.
          </p>
        </div>
        <div className="plan-header-actions">
          <button
            type="button"
            className="plan-btn plan-btn-ghost"
            onClick={() => setImportOpen(true)}
          >
            Import
          </button>
          <button
            type="button"
            className="plan-btn plan-btn-ghost"
            onClick={handleExport}
            disabled={!hasRows}
            title={hasRows ? 'Download this plan as a CSV' : 'Add an expense first'}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="plan-btn plan-btn-primary"
            onClick={() => setEditor({ mode: 'add' })}
          >
            Add expense
          </button>
        </div>
      </header>

      {!hasRows ? (
        <div className="plan-empty">
          <div className="plan-empty-mark">
            <ReceiptIcon />
          </div>
          <h3>No recurring expenses yet</h3>
          <p>
            Add them here, or copy the rows straight out of the Google Sheet. Each
            expense gets a start date and frequency; the weekly set-aside is calculated
            for you.
          </p>
          <div className="plan-empty-actions">
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              onClick={() => setImportOpen(true)}
            >
              Import from Google Sheets
            </button>
            <button
              type="button"
              className="plan-btn plan-btn-ghost"
              onClick={() => setEditor({ mode: 'add' })}
            >
              Add one manually
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="plan-summary-strip">
            <div data-stat="weekly">
              <span>Weekly set-aside</span>
              <b>{formatMoney(summary.weeklyCents)}</b>
            </div>
            <div data-stat="seed">
              <span>One-off catch-up</span>
              <b>{formatMoney(summary.catchUpCents)}</b>
            </div>
            <div data-stat="fortnightly">
              <span>Fortnightly</span>
              <b>{formatMoney(summary.fortnightlyCents)}</b>
            </div>
            <div data-stat="annual">
              <span>Annual</span>
              <b>{formatMoney(summary.annualCents)}</b>
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className="plan-bulk-bar">
              <span>
                {selectedRows.length}{' '}
                {selectedRows.length === 1 ? 'expense' : 'expenses'} selected
              </span>
              <div className="plan-bulk-actions">
                <button
                  type="button"
                  className="plan-btn plan-btn-ghost"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="plan-btn plan-btn-danger"
                  onClick={() => setConfirmBulk(true)}
                >
                  Delete selected
                </button>
              </div>
            </div>
          )}

          <div className="plan-list-tools">
            <label className="plan-check plan-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all recurring expenses"
              />
              <span>Select all</span>
            </label>
          </div>

          <div className="plan-expense-list">
            <div className="plan-expense-head">
              <span />
              <span>Expense</span>
              <span>Billed</span>
              <span>Frequency</span>
              <span>Starts</span>
              <span className="plan-num">Weekly</span>
              <span />
            </div>

            {rows.map((row) => {
              const selected = selectedIds.has(row.id)
              return (
                <div
                  className={`plan-expense-row${selected ? ' is-selected' : ''}`}
                  key={row.id}
                >
                  <label className="plan-check">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </label>
                  <div className="plan-expense-name">
                    {row.name}
                  </div>
                  <div className="plan-expense-amount" data-label="Billed">
                    {formatMoney(row.amountCents)}
                  </div>
                  <div data-label="Frequency">
                    <span className="plan-freq">
                      {FREQUENCY_SPECS[row.frequency].label}
                    </span>
                  </div>
                  <div className="plan-expense-start" data-label="Starts">
                    {formatCalendarDate(row.startDate)}
                  </div>
                  <div className="plan-expense-weekly" data-label="Weekly set-aside">
                    {formatMoney(
                      Math.round(weeklySetAsideCents(row.amountCents, row.frequency)),
                    )}
                  </div>
                  <div className="plan-expense-actions">
                    <button
                      type="button"
                      className="plan-row-btn"
                      aria-label={`Edit ${row.name}`}
                      onClick={() => setEditor({ mode: 'edit', row })}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <footer className="plan-footer">
            <p>
              {savedAt
                ? `Saved in this browser · ${formatRelativeTime(savedAt)}`
                : 'Stored in this browser only. Export a CSV to keep a copy.'}
            </p>
            <button
              type="button"
              className="plan-link-danger"
              onClick={() => setConfirmClear(true)}
            >
              Delete plan
            </button>
          </footer>
        </>
      )}

      {editor !== null && (
        <PlanFormDialog
          key={editor.mode === 'edit' ? editor.row.id : 'add'}
          open
          row={editor.mode === 'edit' ? editor.row : null}
          onClose={() => setEditor(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      {importOpen && (
        <PlanImportDialog
          open
          hasRows={hasRows}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}

      <PlanModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Delete this plan?"
        description="The recurring expenses and their paid history are removed from this browser."
        footer={
          <div className="plan-modal-actions">
            <div className="plan-modal-actions-left" />
            <div className="plan-modal-actions-right">
              <button
                type="button"
                className="plan-btn plan-btn-ghost"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="plan-btn plan-btn-danger"
                onClick={handleDeletePlan}
              >
                Delete plan
              </button>
            </div>
          </div>
        }
      >
        <p className="plan-confirm-copy">
          This removes{' '}
          {rows.length === 1 ? 'this expense' : `all ${rows.length} expenses`} and{' '}
          {rows.length === 1 ? 'its' : 'their'} paid history from this browser. Export a
          CSV first if you want to keep a copy.
        </p>
      </PlanModal>

      <PlanModal
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Delete ${selectedRows.length} ${selectedRows.length === 1 ? 'expense' : 'expenses'}?`}
        description="This cannot be undone. Their paid history will be removed too."
        footer={
          <div className="plan-modal-actions">
            <div className="plan-modal-actions-left" />
            <div className="plan-modal-actions-right">
              <button
                type="button"
                className="plan-btn plan-btn-ghost"
                onClick={() => setConfirmBulk(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="plan-btn plan-btn-danger"
                onClick={handleBulkDelete}
              >
                Delete selected
              </button>
            </div>
          </div>
        }
      >
        <p className="plan-confirm-copy">
          {selectedRows.map((row) => row.name).join(', ')} will no longer appear in any
          week.
        </p>
      </PlanModal>
    </section>
  )
}
