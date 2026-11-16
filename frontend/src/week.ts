/**
 * Week-domain helpers for the Wed–Tue budgeting view.
 *
 * The week is the unit of work: a set of budget entries (seeded from the
 * recurring set-aside plan, then editable for this week only) and the Up
 * transactions that have been attached to them. A transaction is "spent" once
 * it is attached; the rest of the week's spending is surfaced as unassigned.
 *
 * Dates stay as local `YYYY-MM-DD` strings so a week never shifts under a
 * daylight-saving change, and money stays in integer cents.
 */
import {
  addDaysIso,
  daysBetweenIso,
  isoDateParts,
  localDateIso,
  weeklySetAsideCents,
  type PlanRow,
} from './budget'

export const MAX_WEEK_ENTRIES = 200
export const MAX_TRANSACTION_ID_LENGTH = 120

export interface WeekEntry {
  id: string
  name: string
  budgetCents: number
  /** The set-aside row this entry was seeded from, when it came from the plan. */
  sourcePlanId?: string
}

export interface WeekSnapshot {
  entries: WeekEntry[]
  /** Attached Up transaction id → entry id. Only ids are stored, never transaction details. */
  links: Record<string, string>
  updatedAt: number
}

/** A debit transaction, normalised for the week view. */
export interface WeekTransaction {
  id: string
  description: string
  createdAt: string
  /** Positive number of cents spent (Up reports debits as negative values). */
  amountCents: number
  accountName: string
  status: string
}

export interface WeekEntrySummary {
  entry: WeekEntry
  spentCents: number | null
  remainingCents: number | null
  attached: WeekTransaction[]
  /** Links recorded even when transaction details are not currently loaded. */
  linkedCount: number
}

export interface WeekSummary {
  entries: WeekEntrySummary[]
  plannedCents: number
  /** null when transaction details are unavailable (offline / not fetched yet). */
  spentCents: number | null
  leftCents: number | null
  unassignedCount: number
  unassignedCents: number | null
  transactionCount: number
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function utcWeekday(iso: string): number {
  const parts = isoDateParts(iso)
  if (!parts) return 0
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[utcWeekday(iso)] ?? ''
}

/** The Wednesday on or before `dateIso`. */
export function startOfWeek(dateIso = localDateIso()): string {
  const parts = isoDateParts(dateIso)
  if (!parts) return dateIso
  // Wed = 3. Thu/Fri/Sat/Sun/Mon/Tue map to 1…6 days back.
  const offset = (utcWeekday(dateIso) - 3 + 7) % 7
  return addDaysIso(dateIso, -offset)
}

export function endOfWeek(weekStart: string): string {
  return addDaysIso(weekStart, 6)
}

export function formatWeekRange(weekStart: string): string {
  const start = isoDateParts(weekStart)
  const end = isoDateParts(endOfWeek(weekStart))
  if (!start || !end) return weekStart
  const sameMonth = start.year === end.year && start.month === end.month
  const startLabel = `${weekdayShort(weekStart)} ${start.day}${sameMonth ? '' : ` ${MONTH_SHORT[start.month - 1]}`}`
  const endLabel = `${weekdayShort(endOfWeek(weekStart))} ${end.day} ${MONTH_SHORT[end.month - 1]}`
  return `${startLabel} – ${endLabel} ${end.year}`
}

export function formatWeekDay(iso: string): string {
  const parts = isoDateParts(iso)
  if (!parts) return iso
  return `${weekdayShort(iso)} ${parts.day} ${MONTH_SHORT[parts.month - 1]}`
}

export interface WeekDayCell {
  iso: string
  weekday: string
  day: number
  isToday: boolean
}

export function weekDayCells(weekStart: string, todayIso: string): WeekDayCell[] {
  return Array.from({ length: 7 }, (_, index) => {
    const iso = addDaysIso(weekStart, index)
    const parts = isoDateParts(iso)
    return {
      iso,
      weekday: weekdayShort(iso),
      day: parts?.day ?? 0,
      isToday: iso === todayIso,
    }
  })
}

/** "This week", "Next week", "3 weeks ago"… */
export function weekRelativeLabel(weekStart: string, todayIso = localDateIso()): string {
  const difference = daysBetweenIso(startOfWeek(todayIso), weekStart)
  if (difference === 0) return 'This week'
  if (difference === 7) return 'Next week'
  if (difference === -7) return 'Last week'
  const weeks = Math.round(Math.abs(difference) / 7)
  return difference > 0 ? `In ${weeks} weeks` : `${weeks} weeks ago`
}

/**
 * One entry per recurring set-aside row, using the same weekly amount as the
 * sheet. Ids are derived from the week and plan row, so they are stable for as
 * long as that week is read-only; the first edit or attachment materialises a
 * snapshot of the week in storage.
 */
export function deriveWeekEntries(planRows: PlanRow[], weekStart: string): WeekEntry[] {
  return planRows.slice(0, MAX_WEEK_ENTRIES).map((row) => ({
    id: `week:${weekStart}:plan:${row.id}`,
    name: row.name,
    budgetCents: Math.max(
      0,
      Math.round(weeklySetAsideCents(row.amountCents, row.frequency)),
    ),
    sourcePlanId: row.id,
  }))
}

/**
 * Join budget entries, attachment links and the week's debit transactions.
 * `transactions === null` means the transaction source is not available, so
 * spend and remaining amounts are unknown rather than zero.
 */
export function summariseWeek(
  entries: WeekEntry[],
  links: Record<string, string>,
  transactions: WeekTransaction[] | null,
): WeekSummary {
  const entryIds = new Set(entries.map((entry) => entry.id))
  const attached = new Map<string, WeekTransaction[]>()
  const linkedCounts = new Map<string, number>()
  for (const entry of entries) {
    attached.set(entry.id, [])
    linkedCounts.set(entry.id, 0)
  }
  for (const entryId of Object.values(links)) {
    if (entryIds.has(entryId)) {
      linkedCounts.set(entryId, (linkedCounts.get(entryId) ?? 0) + 1)
    }
  }

  let plannedCents = 0
  for (const entry of entries) plannedCents += entry.budgetCents

  let spentCents: number | null = null
  let unassignedCents: number | null = null
  let unassignedCount = 0

  if (transactions) {
    spentCents = 0
    unassignedCents = 0
    for (const transaction of transactions) {
      spentCents += transaction.amountCents
      const entryId = links[transaction.id]
      if (entryId && entryIds.has(entryId)) {
        attached.get(entryId)?.push(transaction)
      } else {
        unassignedCount += 1
        unassignedCents += transaction.amountCents
      }
    }
  }

  const entrySummaries: WeekEntrySummary[] = entries.map((entry) => {
    const attachedTransactions = attached.get(entry.id) ?? []
    const entrySpent = transactions
      ? attachedTransactions.reduce((total, transaction) => total + transaction.amountCents, 0)
      : null
    return {
      entry,
      spentCents: entrySpent,
      remainingCents: entrySpent === null ? null : entry.budgetCents - entrySpent,
      attached: attachedTransactions,
      linkedCount: linkedCounts.get(entry.id) ?? 0,
    }
  })

  return {
    entries: entrySummaries,
    plannedCents,
    spentCents,
    leftCents: spentCents === null ? null : plannedCents - spentCents,
    unassignedCount,
    unassignedCents,
    transactionCount: transactions?.length ?? 0,
  }
}
