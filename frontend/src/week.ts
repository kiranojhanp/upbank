/**
 * Week-domain helpers for the Wednesday–Tuesday recurring-expense view.
 *
 * A recurring expense has a start date and a frequency. The occurrence that
 * falls inside a week is what appears in that week's list. Marking it paid
 * records that occurrence; the next occurrence is generated independently, so
 * a weekly expense disappears from this week and appears again next week.
 */
import {
  addDaysIso,
  daysBetweenIso,
  isoDateParts,
  localDateIso,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  weeklySetAsideCents,
  type PlanRow,
} from './budget'
import { paidKey, type PaidMap } from './paidStore'

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

export interface WeekOccurrence {
  expense: PlanRow
  date: string
  key: string
  paid: boolean
  transactionId?: string
}

export interface WeekSummary {
  occurrences: WeekOccurrence[]
  due: WeekOccurrence[]
  paid: WeekOccurrence[]
  dueCents: number
  paidCents: number
  /** The recurring plan's weekly set-aside total, shown for reference. */
  weeklySetAsideCents: number
}

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

/** The occurrence of `expense` that falls in this week, or null. */
export function occurrenceInWeek(
  expense: PlanRow,
  weekStart: string,
  weekEnd: string,
): string | null {
  const date = nextOccurrenceOnOrAfter(expense.startDate, expense.frequency, weekStart)
  return date <= weekEnd ? date : null
}

export function occurrenceForExpense(
  expense: PlanRow,
  date: string,
): WeekOccurrence {
  const key = paidKey(expense.id, date)
  return { expense, date, key, paid: false }
}

/** The next occurrence after this one. Weekly → seven days later, etc. */
export function nextDateAfterOccurrence(expense: PlanRow, date: string): string {
  return nextOccurrenceAfter(expense.startDate, expense.frequency, date)
}

export function summariseWeek(
  planRows: PlanRow[],
  paid: PaidMap,
  weekStart: string,
  weekEnd: string,
): WeekSummary {
  const occurrences: WeekOccurrence[] = []
  for (const expense of planRows) {
    const date = occurrenceInWeek(expense, weekStart, weekEnd)
    if (!date) continue
    const key = paidKey(expense.id, date)
    const payment = paid[key]
    occurrences.push({
      expense,
      date,
      key,
      paid: Boolean(payment),
      transactionId: payment?.transactionId,
    })
  }
  const planOrder = new Map(planRows.map((expense, index) => [expense.id, index]))
  occurrences.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (planOrder.get(a.expense.id) ?? 0) - (planOrder.get(b.expense.id) ?? 0),
  )

  let dueCents = 0
  let paidCents = 0
  for (const occurrence of occurrences) {
    if (occurrence.paid) paidCents += occurrence.expense.amountCents
    else dueCents += occurrence.expense.amountCents
  }

  let weeklyExact = 0
  for (const expense of planRows) {
    weeklyExact += weeklySetAsideCents(expense.amountCents, expense.frequency)
  }

  return {
    occurrences,
    due: occurrences.filter((occurrence) => !occurrence.paid),
    paid: occurrences.filter((occurrence) => occurrence.paid),
    dueCents,
    paidCents,
    weeklySetAsideCents: Math.round(weeklyExact),
  }
}
