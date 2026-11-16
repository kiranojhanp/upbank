/**
 * Paid occurrences for recurring expenses.
 *
 * A week is a set of occurrences generated from each expense's start date and
 * frequency. Marking an occurrence paid records which Up transaction paid it,
 * so the occurrence drops out of that week. The next occurrence is generated
 * independently, which is why a weekly expense reappears the following week.
 *
 * Only ids and dates are stored here; transaction descriptions, amounts and
 * account names stay live in the Up cache/API. Records are per token
 * fingerprint, like the plan and the weekly budgets, and survive sign-out.
 */
import { isIsoDate } from './budget'

export const PAID_PREFIX = 'up:paid:'
export const PAID_VERSION = 1
export const MAX_PAID_OCCURRENCES = 5_000

export interface PaidOccurrence {
  expenseId: string
  /** The occurrence date, `YYYY-MM-DD`. */
  date: string
  transactionId: string
  paidAt: number
}

export type PaidMap = Record<string, PaidOccurrence>

interface PaidFile {
  version: number
  paid: PaidMap
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9:_-]{1,120}$/

export function paidKey(expenseId: string, date: string): string {
  return `${expenseId}:${date}`
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizePaidFile(value: unknown): PaidMap | null {
  if (!isRecord(value)) return null
  if (value.version !== PAID_VERSION) return null
  if (!isRecord(value.paid)) return null

  const paid: PaidMap = Object.create(null) as PaidMap
  for (const [key, raw] of Object.entries(value.paid)) {
    if (!isRecord(raw)) continue
    const expenseId = typeof raw.expenseId === 'string' ? raw.expenseId : ''
    const date = typeof raw.date === 'string' ? raw.date.trim() : ''
    const transactionId = typeof raw.transactionId === 'string' ? raw.transactionId : ''
    const paidAt =
      typeof raw.paidAt === 'number' && Number.isFinite(raw.paidAt) ? raw.paidAt : 0
    if (!ID_PATTERN.test(expenseId)) continue
    if (!isIsoDate(date)) continue
    if (!TRANSACTION_ID_PATTERN.test(transactionId)) continue
    if (paidAt <= 0) continue
    const expected = paidKey(expenseId, date)
    if (key !== expected) continue
    paid[key] = { expenseId, date, transactionId, paidAt }
  }
  return paid
}

function readFile(uid: string): PaidMap {
  const raw = store()?.getItem(`${PAID_PREFIX}${uid}`)
  if (!raw) return Object.create(null) as PaidMap
  try {
    return sanitizePaidFile(JSON.parse(raw)) ?? (Object.create(null) as PaidMap)
  } catch {
    return Object.create(null) as PaidMap
  }
}

export function readPaid(uid: string): PaidMap {
  return readFile(uid)
}

function writeFile(uid: string, paid: PaidMap): boolean {
  try {
    const storage = store()
    if (!storage) return false
    const kept = Object.values(paid)
      .sort((a, b) => b.paidAt - a.paidAt)
      .slice(0, MAX_PAID_OCCURRENCES)
    const next: PaidMap = Object.create(null) as PaidMap
    for (const occurrence of kept) {
      next[paidKey(occurrence.expenseId, occurrence.date)] = occurrence
    }
    storage.setItem(
      `${PAID_PREFIX}${uid}`,
      JSON.stringify({ version: PAID_VERSION, paid: next } satisfies PaidFile),
    )
    return true
  } catch {
    return false
  }
}

export function markPaid(
  uid: string,
  expenseId: string,
  date: string,
  transactionId: string,
): boolean {
  if (!ID_PATTERN.test(expenseId) || !isIsoDate(date)) return false
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) return false
  const paid = readFile(uid)
  paid[paidKey(expenseId, date)] = {
    expenseId,
    date,
    transactionId,
    paidAt: Date.now(),
  }
  return writeFile(uid, paid)
}

/** Remove the paid records belonging to deleted expenses. */
export function forgetPaidForExpenses(uid: string, expenseIds: string[]): boolean {
  if (expenseIds.length === 0) return true
  const doomed = new Set(expenseIds)
  const paid = readFile(uid)
  let changed = false
  for (const [key, occurrence] of Object.entries(paid)) {
    if (doomed.has(occurrence.expenseId)) {
      delete paid[key]
      changed = true
    }
  }
  if (!changed) return true
  return writeFile(uid, paid)
}

export function clearPaid(uid: string): boolean {
  try {
    store()?.removeItem(`${PAID_PREFIX}${uid}`)
    return true
  } catch {
    return false
  }
}
