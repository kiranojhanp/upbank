/**
 * Per-user storage for weekly budgets and transaction attachments.
 *
 * A week is only materialised when the user changes an entry or attaches a
 * transaction; until then the entries are derived live from the set-aside
 * plan. The record holds budget names, amounts and a transaction-id → entry-id
 * map. It deliberately does **not** store transaction descriptions or amounts:
 * those stay in the Up cache and are fetched for the active week. That keeps
 * the at-rest footprint of this view to user-authored budgeting data.
 *
 * Like the plan, the store is namespaced by the token fingerprint and survives
 * sign-out; it is removed by the render-error reset or manually via the entry
 * actions. Stored JSON is treated as untrusted and validated row by row.
 */
import { MAX_AMOUNT_CENTS, MAX_EXPENSE_NAME_LENGTH, isIsoDate } from './budget'
import {
  MAX_TRANSACTION_ID_LENGTH,
  MAX_WEEK_ENTRIES,
  type WeekEntry,
  type WeekSnapshot,
} from './week'

export const WEEK_VERSION = 1
export const WEEK_PREFIX = 'up:week:'
/** Roughly two years of weekly budgets; older weeks are pruned on write. */
export const MAX_STORED_WEEKS = 104

export interface StoredWeek {
  entries: WeekEntry[]
  links: Record<string, string>
  updatedAt: number
}

interface WeekFile {
  version: number
  weeks: Record<string, StoredWeek>
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

export function weekKey(uid: string): string {
  return `${WEEK_PREFIX}${uid}`
}

function sanitizeEntries(value: unknown): WeekEntry[] {
  if (!Array.isArray(value)) return []
  const entries: WeekEntry[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (entries.length >= MAX_WEEK_ENTRIES) break
    if (!isRecord(item)) continue

    const id =
      typeof item.id === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(item.id)
        ? item.id
        : null
    if (!id || seen.has(id)) continue

    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || name.length > MAX_EXPENSE_NAME_LENGTH) continue

    const budgetCents = item.budgetCents
    if (
      typeof budgetCents !== 'number' ||
      !Number.isInteger(budgetCents) ||
      budgetCents < 0 ||
      budgetCents > MAX_AMOUNT_CENTS
    ) {
      continue
    }

    const sourcePlanId =
      typeof item.sourcePlanId === 'string' && item.sourcePlanId.length <= 80
        ? item.sourcePlanId
        : undefined

    seen.add(id)
    entries.push(
      sourcePlanId ? { id, name, budgetCents, sourcePlanId } : { id, name, budgetCents },
    )
  }

  return entries
}

function sanitizeLinks(value: unknown, entries: WeekEntry[]): Record<string, string> {
  const links: Record<string, string> = Object.create(null) as Record<string, string>
  if (!isRecord(value)) return links
  const entryIds = new Set(entries.map((entry) => entry.id))
  for (const [transactionId, entryId] of Object.entries(value)) {
    if (!transactionId || transactionId.length > MAX_TRANSACTION_ID_LENGTH) continue
    if (typeof entryId !== 'string' || !entryIds.has(entryId)) continue
    links[transactionId] = entryId
  }
  return links
}

function sanitizeWeek(value: unknown): StoredWeek | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.entries) || !isRecord(value.links)) return null
  const entries = sanitizeEntries(value.entries)
  return {
    entries,
    links: sanitizeLinks(value.links, entries),
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : 0,
  }
}

/** Validate a whole store. Exported for the unit checks. */
export function sanitizeWeekStore(value: unknown): Record<string, StoredWeek> | null {
  if (!isRecord(value)) return null
  if (value.version !== WEEK_VERSION) return null
  if (!isRecord(value.weeks)) return null

  const weeks: Record<string, StoredWeek> = Object.create(null) as Record<
    string,
    StoredWeek
  >
  for (const [weekStart, raw] of Object.entries(value.weeks)) {
    if (!isIsoDate(weekStart)) continue
    const week = sanitizeWeek(raw)
    if (week) weeks[weekStart] = week
  }
  return weeks
}

function readFile(uid: string): Record<string, StoredWeek> | null {
  const raw = store()?.getItem(weekKey(uid))
  if (!raw) return null
  try {
    return sanitizeWeekStore(JSON.parse(raw))
  } catch {
    return null
  }
}

export function readWeek(uid: string, weekStart: string): WeekSnapshot | null {
  const file = readFile(uid)
  const week = file?.[weekStart]
  if (!week) return null
  return {
    entries: week.entries,
    links: week.links,
    updatedAt: week.updatedAt,
  }
}

/** Returns false when the browser refused the write. */
export function writeWeek(
  uid: string,
  weekStart: string,
  data: Pick<WeekSnapshot, 'entries' | 'links'>,
): boolean {
  try {
    const storage = store()
    if (!storage) return false
    const file: WeekFile = {
      version: WEEK_VERSION,
      weeks: readFile(uid) ?? {},
    }
    file.weeks[weekStart] = {
      entries: data.entries.slice(0, MAX_WEEK_ENTRIES),
      links: data.links,
      updatedAt: Date.now(),
    }

    const kept = Object.keys(file.weeks)
      .sort()
      .slice(-MAX_STORED_WEEKS)
    const weeks: Record<string, StoredWeek> = {}
    for (const key of kept) weeks[key] = file.weeks[key]

    storage.setItem(
      weekKey(uid),
      JSON.stringify({ version: WEEK_VERSION, weeks } satisfies WeekFile),
    )
    return true
  } catch {
    return false
  }
}

export function clearWeek(uid: string, weekStart: string): boolean {
  try {
    const storage = store()
    if (!storage) return false
    const file = readFile(uid)
    if (!file || !file[weekStart]) return true
    delete file[weekStart]
    if (Object.keys(file).length === 0) {
      storage.removeItem(weekKey(uid))
    } else {
      storage.setItem(
        weekKey(uid),
        JSON.stringify({ version: WEEK_VERSION, weeks: file } satisfies WeekFile),
      )
    }
    return true
  } catch {
    return false
  }
}

/** UUID where available; the fallback still matches the stored id pattern. */
export function newWeekEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `week-entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
