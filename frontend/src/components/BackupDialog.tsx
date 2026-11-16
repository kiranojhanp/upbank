import { useState, type ChangeEvent } from 'react'
import { localDateIso } from '../budget'
import { createBackup, parseBackup, type BackupData } from '../backup'
import { downloadBlob } from '../download'
import { readPaid, replacePaid } from '../paidStore'
import { readPlan, writePlan } from '../planStore'
import { PlanModal } from './PlanModal'

interface BackupDialogProps {
  uid: string
  onClose: () => void
}

const MAX_BACKUP_BYTES = 5_000_000

export function BackupDialog({ uid, onClose }: BackupDialogProps) {
  const [planCount, setPlanCount] = useState(() => readPlan(uid).rows.length)
  const [paidCount, setPaidCount] = useState(() => Object.keys(readPaid(uid)).length)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<BackupData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  function handleExport() {
    const plan = readPlan(uid)
    const paid = readPaid(uid)
    const json = createBackup(plan.rows, paid)
    downloadBlob(
      new Blob([json], { type: 'application/json;charset=utf-8' }),
      `unofficial-up-backup-${localDateIso()}.json`,
    )
    setPlanCount(plan.rows.length)
    setPaidCount(Object.keys(paid).length)
    setStatus('Backup downloaded.')
    setError(null)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    setFileName(null)
    setParsed(null)
    setStatus(null)
    setError(null)
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setError('That file is larger than 5 MB. It does not look like a budget backup.')
      return
    }
    try {
      const text = await file.text()
      const data = parseBackup(text)
      setParsed(data)
      setFileName(file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that backup.')
    }
  }

  function handleImport() {
    if (!parsed) return
    if (!writePlan(uid, parsed.planRows)) {
      setError('This browser refused to write the recurring plan.')
      return
    }
    if (!replacePaid(uid, parsed.paid)) {
      setError('The plan was written, but the paid history could not be saved.')
      return
    }
    setError(null)
    setImporting(true)
    setStatus('Imported. Reloading…')
    window.setTimeout(() => window.location.reload(), 450)
  }

  const planLabel = `${planCount} recurring ${planCount === 1 ? 'expense' : 'expenses'}`
  const paidLabel = `${paidCount} paid ${paidCount === 1 ? 'occurrence' : 'occurrences'}`
  const parsedPlanLabel = parsed
    ? `${parsed.planRows.length} recurring ${parsed.planRows.length === 1 ? 'expense' : 'expenses'}`
    : ''
  const parsedPaidLabel = parsed
    ? `${Object.keys(parsed.paid).length} paid ${Object.keys(parsed.paid).length === 1 ? 'occurrence' : 'occurrences'}`
    : ''

  return (
    <PlanModal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Backup & restore"
      description="Move your recurring plan and paid history between browsers. Your Up token is never included; sign in again with the same token, then import this file."
      wide
      footer={
        <div className="plan-modal-actions">
          <div className="plan-modal-actions-left" />
          <div className="plan-modal-actions-right">
            <button
              type="button"
              className="plan-btn plan-btn-ghost"
              onClick={onClose}
              disabled={importing}
            >
              Close
            </button>
          </div>
        </div>
      }
    >
      <section className="backup-section">
        <div className="backup-section-head">
          <h4>Export backup</h4>
          <span className="backup-count">
            {planLabel} · {paidLabel}
          </span>
        </div>
        <p className="backup-copy">
          Downloads a JSON file with your recurring expenses and which Up transaction
          paid each occurrence. Account balances and transactions are not included — they
          are fetched fresh from Up.
        </p>
        <div className="backup-actions">
          <button
            type="button"
            className="plan-btn plan-btn-primary"
            onClick={handleExport}
            disabled={planCount === 0 && paidCount === 0}
          >
            Download backup
          </button>
        </div>
      </section>

      <section className="backup-section">
        <div className="backup-section-head">
          <h4>Import backup</h4>
        </div>
        <p className="backup-copy">
          Restores the plan and paid history for the account signed in on this browser.
          This replaces what is currently stored here.
        </p>
        <div className="backup-actions">
          <label className="plan-btn plan-btn-ghost plan-file-btn">
            {fileName ? 'Choose a different backup' : 'Choose backup file'}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(event) => void handleFile(event)}
              disabled={importing}
            />
          </label>
          {fileName && <span className="backup-file-name">{fileName}</span>}
        </div>

        {error && <p className="backup-error">{error}</p>}
        {status && <p className="backup-status">{status}</p>}

        {parsed && (
          <div className="backup-preview">
            <p className="backup-preview-summary">
              {parsedPlanLabel} · {parsedPaidLabel}
            </p>
            {parsed.exportedAt && (
              <p className="backup-preview-date">Exported {parsed.exportedAt.slice(0, 10)}</p>
            )}
            {parsed.droppedPlan > 0 && (
              <p className="backup-preview-warning">
                {parsed.droppedPlan} invalid plan {parsed.droppedPlan === 1 ? 'row was' : 'rows were'} ignored.
              </p>
            )}
            {parsed.droppedPaid > 0 && (
              <p className="backup-preview-warning">
                {parsed.droppedPaid} paid {parsed.droppedPaid === 1 ? 'record was' : 'records were'} ignored.
              </p>
            )}
            <p className="backup-warning">
              Importing replaces the current plan and paid history on this browser. It
              cannot be undone.
            </p>
            <button
              type="button"
              className="plan-btn plan-btn-primary"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import backup'}
            </button>
          </div>
        )}
      </section>
    </PlanModal>
  )
}
