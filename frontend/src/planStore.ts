/**
 * Per-user storage for the set-aside plan.
 *
 * Unlike Up's accounts and transactions, a plan is authored by the person
 * using the app rather than fetched from the bank, so it lives in a small
 * `localStorage` record instead of the OPFS row cache. It is namespaced by the
 * token fingerprint (`uid`), so two tokens on one browser never see each
 * other's plan, and it is intentionally **not** removed by sign-out or "Clear
 * cache": those actions clear banking data that can be re-fetched, while a
 * hand-built plan cannot. The plan view has its own explicit "Delete plan"
 * action, and the render-error recovery path removes every `up:` key.
 *
 * Reads treat the stored JSON as untrusted input: anything that does not match
 * the current schema is dropped row by row rather than crashing the view.
 */
import {
  FREQUENCIES,
  MAX_AMOUNT_CENTS,
  MAX_EXPENSE_NAME_LENGTH,
  MAX_PLAN_ROWS,
  isIsoDate,
  type Frequency,
  type PlanRow,
} from './budget'

export const PLAN_VERSION = 1
export const PLAN_PREFIX = 'up:plan:'

export interface PlanSnapshot {
  rows: PlanRow[]
  /** Epoch ms of the last successful write, or null when no plan is stored. */
  updatedAt: number | null
}

const EMPTY_PLAN: PlanSnapshot = { rows: [], updatedAt: null }

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function planKey(uid: string): string {
  return `${PLAN_PREFIX}${uid}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFrequency(value: unknown): value is Frequency {
  return typeof value === 'string' && (FREQUENCIES as readonly string[]).includes(value)
}

/**
 * Validate one stored plan. Returns null when the envelope itself is unusable
 * (wrong version/shape), and an array (possibly empty) when the rows inside it
 * could be read. Individual bad rows are skipped.
 */
export function sanitizePlan(value: unknown): PlanRow[] | null {
  if (!isRecord(value)) return null
  if (value.version !== PLAN_VERSION) return null
  if (!Array.isArray(value.rows)) return null

  const rows: PlanRow[] = []
  const seen = new Set<string>()

  for (const entry of value.rows) {
    if (rows.length >= MAX_PLAN_ROWS) break
    if (!isRecord(entry)) continue

    const id =
      typeof entry.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(entry.id) ? entry.id : null
    if (!id || seen.has(id)) continue

    const rawName = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!rawName || rawName.length > MAX_EXPENSE_NAME_LENGTH) continue

    const amountCents = entry.amountCents
    if (
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents) ||
      amountCents < 0 ||
      amountCents > MAX_AMOUNT_CENTS
    ) {
      continue
    }

    if (!isFrequency(entry.frequency)) continue
    // `nextDueDate` is the pre-start-date schema. Reading it keeps an existing
    // plan usable; it becomes the first occurrence and the next write migrates it.
    const startDate =
      typeof entry.startDate === 'string'
        ? entry.startDate.trim()
        : typeof entry.nextDueDate === 'string'
          ? entry.nextDueDate.trim()
          : ''
    if (!isIsoDate(startDate)) continue

    seen.add(id)
    rows.push({
      id,
      name: rawName,
      amountCents,
      frequency: entry.frequency,
      startDate,
    })
  }

  return rows
}

export function readPlan(uid: string): PlanSnapshot {
  const raw = store()?.getItem(planKey(uid))
  if (!raw) return EMPTY_PLAN
  try {
    const value: unknown = JSON.parse(raw)
    const rows = sanitizePlan(value)
    if (!rows) return EMPTY_PLAN
    const updatedAt =
      isRecord(value) && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : null
    return { rows, updatedAt }
  } catch {
    return EMPTY_PLAN
  }
}

/** Returns false when the browser refused the write (quota, disabled storage). */
export function writePlan(uid: string, rows: PlanRow[]): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(
      planKey(uid),
      JSON.stringify({
        version: PLAN_VERSION,
        rows: rows.slice(0, MAX_PLAN_ROWS),
        updatedAt: Date.now(),
      }),
    )
    return true
  } catch {
    return false
  }
}

export function clearPlan(uid: string): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.removeItem(planKey(uid))
    return true
  } catch {
    return false
  }
}

/** UUID where available; the fallback still matches the stored id pattern. */
export function newPlanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
