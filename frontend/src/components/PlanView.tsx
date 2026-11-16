import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FREQUENCY_SPECS,
  MAX_PLAN_ROWS,
  advanceDueDate,
  formatCalendarDate,
  formatDueLabel,
  formatMoney,
  planToCsv,
  summarisePlan,
  type PlanDraftRow,
  type PlanRow,
} from '../budget'
import { downloadBlob } from '../download'
import { formatRelativeTime } from '../format'
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

function DueDot({ days }: { days: number }) {
  const tone = days < 0 ? ' is-overdue' : days <= 7 ? ' is-soon' : ''
  return <span className={`plan-status-dot${tone}`} aria-hidden="true" />
}

export function PlanView({ uid, onNotify, onBack }: PlanViewProps) {
  const initialPlan = useMemo(() => readPlan(uid), [uid])
  const [rows, setRows] = useState<PlanRow[]>(initialPlan.rows)
  const [savedAt, setSavedAt] = useState<number | null>(initialPlan.updatedAt)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const today = useToday()

  const summary = useMemo(() => summarisePlan(rows, today), [rows, today])

  // A second tab editing the same plan should be reflected here rather than
  // letting the two windows drift apart. `writePlan` only fires `storage` in
  // other tabs, so this never fights a local edit.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(PLAN_PREFIX)) return
      const snapshot = readPlan(uid)
      setRows(snapshot.rows)
      setSavedAt(snapshot.updatedAt)
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

  function handleSave(draft: PlanDraftRow, id?: string) {
    if (id) {
      commit(rows.map((row) => (row.id === id ? { ...draft, id } : row)))
      onNotify('Expense updated', draft.name)
    } else {
      commit([...rows, { ...draft, id: newPlanId() }])
      onNotify('Expense added', draft.name)
    }
    setEditor(null)
  }

  function handleDelete(id: string) {
    const removed = rows.find((row) => row.id === id)
    commit(rows.filter((row) => row.id !== id))
    setEditor(null)
    onNotify('Expense removed', removed?.name)
  }

  function handleMarkPaid(row: PlanRow) {
    const nextDue = advanceDueDate(row.nextDueDate, row.frequency, today)
    commit(rows.map((entry) => (entry.id === row.id ? { ...entry, nextDueDate: nextDue } : entry)))
    onNotify('Marked paid', `${row.name} · next due ${formatCalendarDate(nextDue)}`)
  }

  function handleImport(drafts: PlanDraftRow[], mode: 'append' | 'replace') {
    const imported = drafts.map((draft) => ({ ...draft, id: newPlanId() }))
    const next =
      mode === 'replace' ? imported : [...rows, ...imported].slice(0, MAX_PLAN_ROWS)
    const added = mode === 'replace' ? imported.length : next.length - rows.length
    commit(next)
    setImportOpen(false)
    onNotify(
      mode === 'replace' ? 'Plan replaced' : 'Expenses imported',
      `${added} ${added === 1 ? 'expense' : 'expenses'} ${
        mode === 'replace' ? 'now in the plan' : 'added to the plan'
      }.`,
    )
  }

  function handleDeletePlan() {
    clearPlan(uid)
    setRows([])
    setSavedAt(null)
    setConfirmClear(false)
    onNotify('Plan deleted', 'Every expense was removed from this browser.')
  }

  function handleExport() {
    if (summary.rows.length === 0) return
    downloadBlob(
      new Blob([planToCsv(summary.rows)], { type: 'text/csv;charset=utf-8' }),
      `set-aside-plan-${today}.csv`,
    )
    onNotify('Plan exported', `${summary.rows.length} expenses · ${today}.csv`)
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
          <p className="plan-eyebrow">Recurring set-asides</p>
          <h2 id="plan-title" className="plan-title">
            Set-aside plan
          </h2>
          <p className="plan-subtitle">
            The template behind your weekly budgets. These weekly amounts seed a new week
            until you edit that week.
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
          <h3>No expenses yet</h3>
          <p>
            Add your bills, or copy the rows straight out of the Google Sheet. The app keeps
            the weekly target, catch-up and annual total up to date for you.
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
          <div className="plan-empty-steps">
            <span>
              <b>1</b> Paste the rows
            </span>
            <span>
              <b>2</b> Set money aside weekly
            </span>
            <span>
              <b>3</b> Top up what is due now
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="plan-stats">
            <article className="plan-stat plan-stat-primary" data-stat="weekly">
              <p className="plan-stat-label">Weekly lock-in target</p>
              <p className="plan-stat-value">{formatMoney(summary.weeklyCents)}</p>
              <p className="plan-stat-caption">Transfer to your bills account each week</p>
            </article>
            <article className="plan-stat" data-stat="seed">
              <p className="plan-stat-label">One-off seed / catch-up</p>
              <p className="plan-stat-value">{formatMoney(summary.catchUpCents)}</p>
              <p className="plan-stat-caption">
                {summary.catchUpCents > 0
                  ? 'Top up today to prevent a shortfall'
                  : 'Every bill is already covered by its set-aside'}
              </p>
            </article>
            <article className="plan-stat" data-stat="fortnightly">
              <p className="plan-stat-label">Fortnightly pay-split</p>
              <p className="plan-stat-value">{formatMoney(summary.fortnightlyCents)}</p>
              <p className="plan-stat-caption">Per pay if you are paid fortnightly</p>
            </article>
            <article className="plan-stat" data-stat="annual">
              <p className="plan-stat-label">Annual total</p>
              <p className="plan-stat-value">{formatMoney(summary.annualCents)}</p>
              <p className="plan-stat-caption">Total baseline yearly commitments</p>
            </article>
          </div>

          <div className="plan-banner">
            <div className="plan-banner-main">
              <span className="plan-banner-kicker">This week</span>
              <p>
                Move <strong>{formatMoney(summary.weeklyCents)}</strong> aside
                {summary.catchUpCents > 0 ? (
                  <>
                    {' '}
                    and seed <strong>{formatMoney(summary.catchUpCents)}</strong> for the bills
                    that are already close.
                  </>
                ) : (
                  <> — every bill is fully covered by its set-aside.</>
                )}
              </p>
            </div>
            <div className="plan-banner-chips">
              {summary.overdueCount > 0 && (
                <span className="plan-chip plan-chip-danger">
                  {summary.overdueCount} overdue
                </span>
              )}
              {summary.dueSoonCount > 0 && (
                <span className="plan-chip">{summary.dueSoonCount} due within 7 days</span>
              )}
              {summary.overdueCount === 0 && summary.dueSoonCount === 0 && (
                <span className="plan-chip plan-chip-ok">Nothing due this week</span>
              )}
            </div>
          </div>

          <div className="plan-table-card">
            <div className="plan-table-head">
              <h3>
                All expenses <span className="plan-count">{rows.length}</span>
              </h3>
              <p>
                Sorted by next due date. <strong>Paid</strong> rolls the date forward one cycle.
              </p>
            </div>

            <div className="plan-table-scroll">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th scope="col">Expense</th>
                    <th scope="col" className="plan-num">
                      Billed
                    </th>
                    <th scope="col">Frequency</th>
                    <th scope="col">Next due</th>
                    <th scope="col" className="plan-num">
                      Weeks
                    </th>
                    <th scope="col" className="plan-num">
                      Weekly set-aside
                    </th>
                    <th scope="col" className="plan-num">
                      One-off catch-up
                    </th>
                    <th scope="col">
                      <span className="plan-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="plan-name-cell" data-label="Expense">
                        <DueDot days={row.daysUntilDue} />
                        <span className="plan-name-text">{row.name}</span>
                      </td>
                      <td className="plan-num plan-billed" data-label="Billed">
                        <span className="plan-sr-only">Billed: </span>
                        {formatMoney(row.amountCents)}
                      </td>
                      <td data-label="Frequency">
                        <span className="plan-sr-only">Frequency: </span>
                        <span className="plan-freq">
                          {FREQUENCY_SPECS[row.frequency].label}
                        </span>
                      </td>
                      <td className="plan-due-cell" data-label="Next due">
                        <span className="plan-due-value">
                          <span className="plan-sr-only">Next due: </span>
                          <span className="plan-due-date">
                            {formatCalendarDate(row.nextDueDate)}
                          </span>
                          <span
                            className={`plan-due-hint${row.daysUntilDue < 0 ? ' is-overdue' : ''}`}
                          >
                            {formatDueLabel(row.nextDueDate, today)}
                          </span>
                        </span>
                      </td>
                      <td className="plan-num plan-weeks" data-label="Weeks">
                        <span className="plan-sr-only">Weeks until due: </span>
                        {row.weeksUntilDue}
                      </td>
                      <td className="plan-num plan-strong" data-label="Weekly set-aside">
                        <span className="plan-sr-only">Weekly set-aside: </span>
                        {formatMoney(Math.round(row.weeklyCents))}
                      </td>
                      <td
                        className={`plan-num${row.catchUpCents > 0 ? ' plan-catchup' : ' plan-zero'}`}
                        data-label="One-off catch-up"
                      >
                        <span className="plan-sr-only">One-off catch-up: </span>
                        {formatMoney(row.catchUpCents)}
                      </td>
                      <td className="plan-actions-cell">
                        <div className="plan-row-actions">
                          <button
                            type="button"
                            className="plan-row-btn"
                            aria-label={`Mark ${row.name} as paid`}
                            title="Advance the next due date by one cycle"
                            onClick={() => handleMarkPaid(row)}
                          >
                            Paid
                          </button>
                          <button
                            type="button"
                            className="plan-row-btn"
                            aria-label={`Edit ${row.name}`}
                            onClick={() => setEditor({ mode: 'edit', row })}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="plan-total-label">
                      Total
                    </td>
                    <td className="plan-num plan-strong">{formatMoney(summary.weeklyCents)}</td>
                    <td className="plan-num plan-catchup">
                      {formatMoney(summary.catchUpCents)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
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
          today={today}
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
        description="The expenses are removed from this browser only; your Up account is not touched."
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
              <button type="button" className="plan-btn plan-btn-danger" onClick={handleDeletePlan}>
                Delete plan
              </button>
            </div>
          </div>
        }
      >
        <p className="plan-confirm-copy">
          This removes all {rows.length} {rows.length === 1 ? 'expense' : 'expenses'} from
          this browser. Existing weekly budgets keep their saved entries. Export a CSV first
          if you want to keep a copy.
        </p>
      </PlanModal>
    </section>
  )
}
