import { useMemo, useState, type ChangeEvent } from 'react'
import {
  FREQUENCY_SPECS,
  formatCalendarDate,
  formatMoney,
  parsePlanImport,
  type PlanDraftRow,
} from '../budget'
import { PlanModal } from './PlanModal'

interface PlanImportDialogProps {
  open: boolean
  hasRows: boolean
  onClose: () => void
  onImport: (rows: PlanDraftRow[], mode: 'append' | 'replace') => void
}

const MAX_FILE_BYTES = 1_000_000

const PLACEHOLDER =
  'Expense Name\tBilled Amount ($)\tFrequency\tNext Due Date\n' +
  'Rent\t500.00\tWeekly\t2026-12-01\n' +
  'Internet\t80.00\tMonthly\t2026-12-05'

export function PlanImportDialog({
  open,
  hasRows,
  onClose,
  onImport,
}: PlanImportDialogProps) {
  // Mounted fresh for each import, so an earlier paste never reappears.
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('replace')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const result = useMemo(() => parsePlanImport(text), [text])
  const preview = result.rows.slice(0, 3)

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Allow picking the same file again after an edit.
    event.target.value = ''
    if (!file) return
    setFileError(null)
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is larger than 1 MB. Paste the rows instead.')
      return
    }
    setReading(true)
    try {
      setText(await file.text())
      setFileName(file.name)
    } catch {
      setFileError('Could not read that file. Try opening it and pasting the rows.')
    } finally {
      setReading(false)
    }
  }

  function handleImport() {
    if (result.rows.length === 0) return
    onImport(result.rows, hasRows ? mode : 'replace')
  }

  const canImport = result.rows.length > 0 && !reading
  const noun = result.rows.length === 1 ? 'expense' : 'expenses'

  return (
    <PlanModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Import expenses"
      description="Bring the tracker across from Google Sheets, or restore a CSV export."
      wide
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left">
            {hasRows && canImport && (
              <div className="plan-import-mode" role="radiogroup" aria-label="Import mode">
                <label>
                  <input
                    type="radio"
                    name="plan-import-mode"
                    checked={mode === 'append'}
                    onChange={() => setMode('append')}
                  />
                  Add to plan
                </label>
                <label>
                  <input
                    type="radio"
                    name="plan-import-mode"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                  />
                  Replace plan
                </label>
              </div>
            )}
          </div>
          <div className="plan-modal-actions-right">
            <button type="button" className="plan-btn plan-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              disabled={!canImport}
              onClick={handleImport}
            >
              {canImport ? `Import ${result.rows.length} ${noun}` : 'Import expenses'}
            </button>
          </div>
        </div>
      }
    >
      <div className="plan-import-toolbar">
        <label className={`plan-btn plan-btn-ghost plan-file-btn${reading ? ' is-busy' : ''}`}>
          {reading ? 'Reading…' : 'Choose a CSV file'}
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={(event) => void handleFile(event)}
            disabled={reading}
          />
        </label>
        {fileName && <span className="plan-import-file">{fileName}</span>}
        <span className="plan-import-or">or paste below</span>
      </div>

      <p className="plan-import-help">
        In Google Sheets, select the header row and the expenses (columns{' '}
        <strong>Expense Name</strong>, <strong>Billed Amount</strong>,{' '}
        <strong>Frequency</strong> and <strong>Next Due Date</strong>), copy, then paste here.
        Calculated columns such as Weekly Set-Aside are ignored.
      </p>

      <textarea
        className="plan-import-text"
        aria-label="Paste expenses"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={PLACEHOLDER}
        rows={7}
        spellCheck={false}
        autoFocus
      />

      {fileError && <p className="plan-field-error">{fileError}</p>}

      {text.trim() === '' ? (
        <p className="plan-import-status">Paste rows to preview them before importing.</p>
      ) : (
        <div className="plan-import-result">
          <p
            className={`plan-import-status${result.rows.length > 0 ? ' is-good' : ' is-bad'}`}
            aria-live="polite"
          >
            {result.rows.length > 0
              ? `${result.rows.length} ${noun} ready${result.issues.length > 0 ? `, ${result.issues.length} row${result.issues.length === 1 ? '' : 's'} skipped` : ''}.`
              : 'Nothing importable yet.'}
          </p>

          {preview.length > 0 && (
            <ul className="plan-import-preview">
              {preview.map((row, index) => (
                <li key={`${row.name}-${index}`}>
                  <span className="plan-import-preview-name">{row.name}</span>
                  <span className="plan-import-preview-meta">
                    {formatMoney(row.amountCents)} · {FREQUENCY_SPECS[row.frequency].label} ·{' '}
                    {formatCalendarDate(row.nextDueDate)}
                  </span>
                </li>
              ))}
              {result.rows.length > preview.length && (
                <li className="plan-import-more">
                  + {result.rows.length - preview.length} more
                </li>
              )}
            </ul>
          )}

          {result.issues.length > 0 && (
            <ul className="plan-import-issues">
              {result.issues.slice(0, 4).map((issue) => (
                <li key={`${issue.line}-${issue.message}`}>
                  Row {issue.line}: {issue.message}
                </li>
              ))}
              {result.issues.length > 4 && (
                <li>…and {result.issues.length - 4} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </PlanModal>
  )
}
