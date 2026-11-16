/**
 * Set-aside plan maths, ported from the Google Sheets tracker's formulas.
 *
 * The sheet answers one question: how much of each bill should be put aside
 * every week so that none of them ever lands as a surprise? Two numbers matter
 * per bill:
 *
 *   weekly set-aside = billed amount × (payments per year ÷ 52)
 *   one-off catch-up = amount − (weekly set-aside × weeks until due)
 *
 * Catch-up is what is missing *today*: a bill due tomorrow has had no time to
 * be saved for, so almost all of it must be seeded from somewhere else. It is
 * clamped at zero because a bill far enough away is already fully covered by
 * its weekly set-aside.
 *
 * Everything here is pure and date-only. Dates are kept as `YYYY-MM-DD`
 * strings and compared through UTC midnight so a daylight-saving change can
 * never make a bill appear a day early. Money is integer cents; fractional
 * cents are only allowed inside the weekly figure, which is where the sheet's
 * rounding behaves the same way.
 */
import { csvCell } from './csv'

export const FREQUENCIES = [
  'WEEKLY',
  'FORTNIGHTLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUALLY',
  'ANNUALLY',
] as const

export type Frequency = (typeof FREQUENCIES)[number]

export interface FrequencySpec {
  id: Frequency
  /** The label the sheet uses, also what CSV import/export round-trips. */
  label: string
  perYear: number
}

export const FREQUENCY_SPECS: Record<Frequency, FrequencySpec> = {
  WEEKLY: { id: 'WEEKLY', label: 'Weekly', perYear: 52 },
  FORTNIGHTLY: { id: 'FORTNIGHTLY', label: 'Fortnightly', perYear: 26 },
  MONTHLY: { id: 'MONTHLY', label: 'Monthly', perYear: 12 },
  QUARTERLY: { id: 'QUARTERLY', label: 'Quarterly', perYear: 4 },
  BIANNUALLY: { id: 'BIANNUALLY', label: 'Biannually', perYear: 2 },
  ANNUALLY: { id: 'ANNUALLY', label: 'Annually', perYear: 1 },
}

export const FREQUENCY_OPTIONS = FREQUENCIES.map((id) => FREQUENCY_SPECS[id])

/** Rows are a personal bill list; these caps keep a hostile localStorage entry bounded. */
export const MAX_PLAN_ROWS = 500
export const MAX_EXPENSE_NAME_LENGTH = 120
export const MAX_AMOUNT_CENTS = 100_000_000_000

export interface PlanRow {
  id: string
  name: string
  amountCents: number
  frequency: Frequency
  /** First occurrence, `YYYY-MM-DD`. Later occurrences follow the frequency. */
  startDate: string
}

export interface DerivedRow extends PlanRow {
  /** Exact (possibly fractional) cents per week, before display rounding. */
  weeklyCents: number
  /** The first occurrence on or after today, derived from `startDate`. */
  nextDueDate: string
  weeksUntilDue: number
  daysUntilDue: number
  catchUpCents: number
  annualCents: number
}

export interface PlanSummary {
  rows: DerivedRow[]
  /** Rounded to whole cents for display, matching the sheet's headline. */
  weeklyCents: number
  fortnightlyCents: number
  annualCents: number
  catchUpCents: number
  dueSoonCount: number
  overdueCount: number
}

export interface PlanDraftRow {
  name: string
  amountCents: number
  frequency: Frequency
  startDate: string
}

export interface ImportIssue {
  /** 1-based row in the pasted text, including the header row. */
  line: number
  message: string
}

export interface PlanImportResult {
  rows: PlanDraftRow[]
  issues: ImportIssue[]
  /** Whether a header row was recognised (and skipped) somewhere in the text. */
  hasHeader: boolean
}

const DAY_MS = 86_400_000
const MONTHS = [
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

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export interface DateParts {
  year: number
  month: number
  day: number
}

/** Parse a strict calendar date; rejects `2026-02-30` and friends. */
export function isoDateParts(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return isValidYmd(year, month, day) ? { year, month, day } : null
}

export function isIsoDate(value: string): boolean {
  return isoDateParts(value) !== null
}

export function localDateIso(now = new Date()): string {
  return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Whole calendar days from `fromIso` to `toIso` (negative when in the past). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = isoDateParts(fromIso)
  const to = isoDateParts(toIso)
  if (!from || !to) return 0
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      DAY_MS,
  )
}

export function addDaysIso(iso: string, days: number): string {
  const parts = isoDateParts(iso)
  if (!parts) return iso
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** Calendar-month stepping that clamps the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const parts = isoDateParts(iso)
  if (!parts) return iso
  const total = parts.year * 12 + (parts.month - 1) + months
  const year = Math.floor(total / 12)
  const month = (((total % 12) + 12) % 12) + 1
  const day = Math.min(parts.day, daysInMonth(year, month))
  return isoFromParts(year, month, day)
}

const MONTH_STEP: Record<'MONTHLY' | 'QUARTERLY' | 'BIANNUALLY' | 'ANNUALLY', number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  BIANNUALLY: 6,
  ANNUALLY: 12,
}

/**
 * The first occurrence on or after `fromIso`, counting from `startDate`.
 *
 * Occurrences are always computed from the original start date, so month-end
 * clamping does not drift: starting 31 Jan gives 28 Feb, then 31 Mar.
 */
export function nextOccurrenceOnOrAfter(
  startDate: string,
  frequency: Frequency,
  fromIso: string,
): string {
  if (!isIsoDate(startDate) || !isIsoDate(fromIso)) return startDate
  if (startDate >= fromIso) return startDate

  if (frequency === 'WEEKLY' || frequency === 'FORTNIGHTLY') {
    const step = frequency === 'WEEKLY' ? 7 : 14
    const days = daysBetweenIso(startDate, fromIso)
    const steps = Math.max(1, Math.ceil(days / step))
    return addDaysIso(startDate, steps * step)
  }

  const step = MONTH_STEP[frequency]
  const start = isoDateParts(startDate)
  const from = isoDateParts(fromIso)
  if (!start || !from) return startDate
  let index = Math.max(
    0,
    Math.floor(((from.year - start.year) * 12 + (from.month - start.month)) / step),
  )
  let occurrence = addMonthsIso(startDate, index * step)
  while (occurrence < fromIso) {
    index += 1
    occurrence = addMonthsIso(startDate, index * step)
  }
  return occurrence
}

/** The occurrence after the given one, e.g. next week's occurrence. */
export function nextOccurrenceAfter(
  startDate: string,
  frequency: Frequency,
  afterIso: string,
): string {
  return nextOccurrenceOnOrAfter(startDate, frequency, addDaysIso(afterIso, 1))
}

/** Weeks of saving before the bill lands; past-due counts as zero weeks, like the sheet. */
export function weeksUntilDue(dueIso: string, todayIso: string): number {
  return Math.max(0, Math.floor(daysBetweenIso(todayIso, dueIso) / 7))
}

export function formatCalendarDate(iso: string): string {
  const parts = isoDateParts(iso)
  if (!parts) return iso
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`
}

export function formatDueLabel(dueIso: string, todayIso: string): string {
  const days = daysBetweenIso(todayIso, dueIso)
  if (days === 0) return 'due today'
  if (days === 1) return 'due tomorrow'
  if (days === -1) return '1 day overdue'
  if (days < -1) return `${Math.abs(days)} days overdue`
  if (days < 14) return `in ${days} days`
  return `in ${Math.round(days / 7)} weeks`
}

/**
 * Flexible date parsing for the import box. Google Sheets can copy an ISO
 * date, an Australian `19/11/2026`, or `19 Nov 2026` depending on the cell's
 * display format, so accept all three (and the month-first variant).
 */
export function parseDateInput(input: string): string | null {
  const text = input.trim().replace(/^["']|["']$/g, '')
  if (!text) return null

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    return isValidYmd(year, month, day) ? isoFromParts(year, month, day) : null
  }

  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    const rawYear = Number(numeric[3])
    const year = numeric[3].length === 2 ? 2000 + rawYear : rawYear
    return isValidYmd(year, month, day) ? isoFromParts(year, month, day) : null
  }

  const spaced = text
    .replace(/[,]/g, ' ')
    .replace(/[-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,}) (\d{4})$/.exec(spaced)
  const monthFirst = /^([A-Za-z]{3,}) (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(spaced)
  if (dayFirst || monthFirst) {
    const day = Number(dayFirst ? dayFirst[1] : monthFirst?.[2])
    const monthName = (dayFirst ? dayFirst[2] : monthFirst?.[1] ?? '').toLowerCase()
    const year = Number(dayFirst ? dayFirst[3] : monthFirst?.[3])
    const month = MONTHS.findIndex((name) => name.toLowerCase() === monthName.slice(0, 3)) + 1
    if (month > 0 && isValidYmd(year, month, day)) return isoFromParts(year, month, day)
  }

  return null
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Parse a pasted amount to integer cents. `$1,234.56`, `1234.56`, `70` all work. */
export function parseAmountToCents(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  const cleaned = text
    .replace(/^\s*AUD\s*/i, '')
    .replace(/\s*AUD\s*$/i, '')
    .replace(/[$,\s]/g, '')
  const match = /^(?:(\d+)(?:\.(\d{1,3}))?|\.(\d{1,3}))$/.exec(cleaned)
  if (!match) return null

  // Build cents from the string rather than multiplying a float: 1.005 must
  // round to 101, not 100.49999999999999.
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? match[3] ?? '').padEnd(3, '0').slice(0, 3)
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0)
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_AMOUNT_CENTS) return null
  return cents
}

/** Cents → `1,234.56`, without the currency symbol. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Cents → `$1,234.56`. */
export function formatMoney(cents: number): string {
  return `$${formatCents(cents)}`
}

// ---------------------------------------------------------------------------
// Set-aside maths
// ---------------------------------------------------------------------------

/** What one bill contributes to the weekly target. */
export function weeklySetAsideCents(amountCents: number, frequency: Frequency): number {
  return (amountCents * FREQUENCY_SPECS[frequency].perYear) / 52
}

export function annualCostCents(amountCents: number, frequency: Frequency): number {
  return amountCents * FREQUENCY_SPECS[frequency].perYear
}

export function deriveRow(row: PlanRow, todayIso: string): DerivedRow {
  const weeklyCents = weeklySetAsideCents(row.amountCents, row.frequency)
  const nextDueDate = nextOccurrenceOnOrAfter(row.startDate, row.frequency, todayIso)
  const weeks = weeksUntilDue(nextDueDate, todayIso)
  return {
    ...row,
    weeklyCents,
    nextDueDate,
    weeksUntilDue: weeks,
    daysUntilDue: daysBetweenIso(todayIso, nextDueDate),
    // Match ROUND(amount − setAside × weeks, 2) in the sheet. The unrounded
    // weekly figure is used here, exactly as the sheet's formula does.
    catchUpCents: Math.max(0, Math.round(row.amountCents - weeklyCents * weeks)),
    annualCents: annualCostCents(row.amountCents, row.frequency),
  }
}

export function summarisePlan(rows: PlanRow[], todayIso: string): PlanSummary {
  const derived = rows
    .map((row) => deriveRow(row, todayIso))
    .sort(
      (a, b) =>
        a.nextDueDate.localeCompare(b.nextDueDate) ||
        a.name.localeCompare(b.name, 'en-AU'),
    )

  let weeklyExact = 0
  let annual = 0
  let catchUp = 0
  let dueSoon = 0
  let overdue = 0
  for (const row of derived) {
    weeklyExact += row.weeklyCents
    annual += row.annualCents
    catchUp += row.catchUpCents
    if (row.daysUntilDue < 0) overdue += 1
    else if (row.daysUntilDue <= 7) dueSoon += 1
  }

  return {
    rows: derived,
    weeklyCents: Math.round(weeklyExact),
    // The sheet's pay-split is twice the weekly target, not a separate sum.
    fortnightlyCents: Math.round(weeklyExact * 2),
    annualCents: annual,
    catchUpCents: catchUp,
    dueSoonCount: dueSoon,
    overdueCount: overdue,
  }
}

export function normalizeFrequency(input: string): Frequency | null {
  const key = input.toLowerCase().replace(/[^a-z0-9]/g, '')
  switch (key) {
    case 'weekly':
    case 'week':
    case 'w':
    case 'everyweek':
      return 'WEEKLY'
    case 'fortnightly':
    case 'fortnight':
    case 'biweekly':
    case 'every2weeks':
    case '2weekly':
      return 'FORTNIGHTLY'
    case 'monthly':
    case 'month':
    case 'm':
    case 'everymonth':
      return 'MONTHLY'
    case 'quarterly':
    case 'quarter':
    case 'q':
    case 'everyquarter':
    case '3monthly':
      return 'QUARTERLY'
    case 'biannually':
    case 'biannual':
    case 'semiannually':
    case 'semiannual':
    case 'halfyearly':
    case 'sixmonthly':
    case '6monthly':
    case 'twiceayear':
      return 'BIANNUALLY'
    case 'annually':
    case 'annual':
    case 'yearly':
    case 'year':
    case 'y':
    case 'everyyear':
      return 'ANNUALLY'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// CSV / Google Sheets import and export
// ---------------------------------------------------------------------------

type Column = 'name' | 'amount' | 'frequency' | 'start'

function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      endField()
    } else if (char === '\n') {
      endRow()
    } else if (char === '\r') {
      // CRLF: the following \n ends the row.
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  let tabs = 0
  let commas = 0
  let quoted = false
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '\t') tabs += 1
    else if (!quoted && char === ',') commas += 1
  }
  return tabs > 0 && tabs >= commas ? '\t' : ','
}

function headerColumns(cells: string[]): Partial<Record<Column, number>> | null {
  const map: Partial<Record<Column, number>> = {}
  cells.forEach((cell, index) => {
    const text = cell.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (text === '') return
    if (map.name === undefined && /\b(name|expense|item)\b/.test(text)) {
      map.name = index
    } else if (map.amount === undefined && /\b(amount|cost|price|billed)\b/.test(text)) {
      map.amount = index
    } else if (
      map.frequency === undefined &&
      /\b(frequency|freq|cycle|period)\b/.test(text)
    ) {
      map.frequency = index
    } else if (
      map.start === undefined &&
      /\b(start|begin|commence|first|due|date)\b/.test(text)
    ) {
      map.start = index
    }
  })
  // Require two known columns before calling the row a header, so one stray
  // word in a data row cannot turn it into one.
  return Object.keys(map).length >= 2 ? map : null
}

/**
 * Parse pasted Google Sheets rows (tab-separated) or a CSV file. Extra columns
 * such as the weekly/catch-up formulas are ignored. A header is looked for in
 * the first ten rows (a sheet may put headline figures above the table) and is
 * recognised by naming at least two of the four columns. "Next Due Date" from
 * older sheets is accepted as a legacy alias for the start date.
 */
export function parsePlanImport(text: string): PlanImportResult {
  const clean = text.replace(/^\uFEFF/, '').trim()
  if (!clean) return { rows: [], issues: [], hasHeader: false }

  const delimiter = detectDelimiter(clean)
  const table = splitDelimited(clean, delimiter)
  if (table.length === 0) return { rows: [], issues: [], hasHeader: false }

  const first = table[0]
  const header = headerColumns(first)
  let columns: Record<Column, number>
  let hasHeader = false
  let start = 0

  if (header) {
    if (
      header.name === undefined ||
      header.amount === undefined ||
      header.frequency === undefined ||
      header.start === undefined
    ) {
      // A row that names a column but not all four is almost certainly a
      // header with a renamed/missing column, not a bill.
      if (header.name !== undefined && header.amount !== undefined) {
        return {
          rows: [],
          issues: [
            {
              line: 1,
              message:
                'The header row needs expense name, billed amount, frequency and start date columns.',
            },
          ],
          hasHeader: false,
        }
      }
      columns = { name: 0, amount: 1, frequency: 2, start: 3 }
    } else {
      columns = header as Record<Column, number>
      hasHeader = true
      start = 1
    }
  } else {
    columns = { name: 0, amount: 1, frequency: 2, start: 3 }
  }

  // A sheet may have headline rows above the table (as this one does). Look a
  // little way in for a complete header and start after it; otherwise treat
  // every row as data with the four columns in sheet order.
  if (!hasHeader) {
    let partial: { line: number; map: Partial<Record<Column, number>> } | null = null
    const limit = Math.min(table.length, 10)
    for (let index = 0; index < limit; index += 1) {
      const map = headerColumns(table[index])
      if (!map) continue
      if (
        map.name !== undefined &&
        map.amount !== undefined &&
        map.frequency !== undefined &&
        map.start !== undefined
      ) {
        columns = map as Record<Column, number>
        hasHeader = true
        start = index + 1
        break
      }
      if (map.name !== undefined && map.amount !== undefined && !partial) {
        partial = { line: index + 1, map }
      }
    }
    if (!hasHeader && partial) {
      return {
        rows: [],
        issues: [
          {
            line: partial.line,
            message:
              'The header row needs expense name, billed amount, frequency and start date columns.',
          },
        ],
        hasHeader: false,
      }
    }
  }

  const rows: PlanDraftRow[] = []
  const issues: ImportIssue[] = []
  let full = false

  for (let index = start; index < table.length; index += 1) {
    const cells = table[index]
    const line = index + 1
    const name = (cells[columns.name] ?? '').trim()
    const amountText = (cells[columns.amount] ?? '').trim()
    const frequencyText = (cells[columns.frequency] ?? '').trim()
    const startText = (cells[columns.start] ?? '').trim()

    // Sheets often leaves empty formatted rows at the bottom; those are not errors.
    if (!name && !amountText && !frequencyText && !startText) continue
    if (!name) {
      issues.push({ line, message: 'missing expense name' })
      continue
    }
    if (name.length > MAX_EXPENSE_NAME_LENGTH) {
      issues.push({
        line,
        message: `name is longer than ${MAX_EXPENSE_NAME_LENGTH} characters`,
      })
      continue
    }
    if (!amountText) {
      issues.push({ line, message: `"${name}" has no billed amount` })
      continue
    }
    const amountCents = parseAmountToCents(amountText)
    if (amountCents === null || amountCents <= 0) {
      issues.push({ line, message: `"${name}" has an invalid amount (${amountText})` })
      continue
    }
    if (!frequencyText) {
      issues.push({ line, message: `"${name}" has no frequency` })
      continue
    }
    const frequency = normalizeFrequency(frequencyText)
    if (!frequency) {
      issues.push({ line, message: `"${name}" has an unknown frequency (${frequencyText})` })
      continue
    }
    if (!startText) {
      issues.push({ line, message: `"${name}" has no start date` })
      continue
    }
    const startDate = parseDateInput(startText)
    if (!startDate) {
      issues.push({ line, message: `"${name}" has an invalid date (${startText})` })
      continue
    }

    if (rows.length >= MAX_PLAN_ROWS) {
      full = true
      break
    }
    rows.push({ name, amountCents, frequency, startDate })
  }

  if (full) {
    issues.push({
      line: table.length,
      message: `only the first ${MAX_PLAN_ROWS} expenses were imported`,
    })
  }

  return { rows, issues, hasHeader }
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Export the recurring expenses so they can go back into Google Sheets or be
 * kept as a backup. The derived weekly set-aside is included for reference.
 */
export function planToCsv(rows: DerivedRow[]): string {
  const header = [
    'Expense Name',
    'Billed Amount ($)',
    'Frequency',
    'Start Date',
    'Weekly Set-Aside ($)',
  ]
  const lines = [header.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(
      [
        // Guard against a name that a spreadsheet would treat as a formula.
        csvCell(row.name),
        (row.amountCents / 100).toFixed(2),
        FREQUENCY_SPECS[row.frequency].label,
        row.startDate,
        (row.weeklyCents / 100).toFixed(2),
      ]
        .map(csvField)
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
