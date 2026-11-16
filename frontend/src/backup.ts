/**
 * Budget backup/restore.
 *
 * Firefox and Chrome each keep their own localStorage/OPFS origin data, so a
 * plan created in one browser is invisible in the other. This module writes a
 * small, versioned JSON file containing only the irreplaceable user data: the
 * recurring plan and the paid occurrences. The Up token is deliberately
 * excluded, and the account/transaction cache is not included because it is
 * re-fetched from Up after signing in again.
 */
import type { PlanRow } from './budget'
import {
  PAID_VERSION,
  sanitizePaidFile,
  type PaidMap,
} from './paidStore'
import { PLAN_VERSION, sanitizePlan } from './planStore'

export const BACKUP_FORMAT = 'unofficial-up-backup'
export const BACKUP_VERSION = 1

export interface BackupData {
  planRows: PlanRow[]
  paid: PaidMap
  exportedAt: string | null
  /** Rows/records dropped by validation; reported in the restore preview. */
  droppedPlan: number
  droppedPaid: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createBackup(
  planRows: PlanRow[],
  paid: PaidMap,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      plan: { version: PLAN_VERSION, rows: planRows },
      paid: { version: PAID_VERSION, paid },
    },
    null,
    2,
  )
}

export function parseBackup(text: string): BackupData {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!isRecord(value)) throw new Error('That file is not an Unofficial Up backup.')
  if (value.format !== BACKUP_FORMAT) {
    throw new Error('That file is not an Unofficial Up backup.')
  }
  if (value.version !== BACKUP_VERSION) {
    throw new Error('That backup was made with a different app version.')
  }

  const planEnvelope = value.plan
  if (!planEnvelope) {
    throw new Error('The backup is missing its recurring-expense plan.')
  }
  const rawPlanRows =
    isRecord(planEnvelope) && Array.isArray(planEnvelope.rows)
      ? planEnvelope.rows.length
      : 0
  const planRows = sanitizePlan(planEnvelope)
  if (!planRows) {
    throw new Error('The backup does not contain a valid recurring-expense plan.')
  }

  const paidEnvelope =
    value.paid ?? { version: PAID_VERSION, paid: Object.create(null) as PaidMap }
  const rawPaid =
    isRecord(paidEnvelope) && isRecord(paidEnvelope.paid)
      ? Object.keys(paidEnvelope.paid).length
      : 0
  const parsedPaid = sanitizePaidFile(paidEnvelope)
  if (!parsedPaid) {
    throw new Error('The backup does not contain valid paid history.')
  }

  const expenseIds = new Set(planRows.map((row) => row.id))
  const paid: PaidMap = Object.create(null) as PaidMap
  let kept = 0
  for (const [key, occurrence] of Object.entries(parsedPaid)) {
    if (!expenseIds.has(occurrence.expenseId)) continue
    paid[key] = occurrence
    kept += 1
  }

  return {
    planRows,
    paid,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : null,
    droppedPlan: rawPlanRows - planRows.length,
    droppedPaid: rawPaid - kept,
  }
}
