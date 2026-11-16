/**
 * Transaction → CSV serialisation for the client-side export.
 *
 * Ported from the old server endpoint: same columns, the same spreadsheet
 * formula-injection guard, and Up's own decimal strings for money so a leading
 * minus stays a negative number rather than text.
 */
import type { Transaction } from './types'

const HEADER = [
  'Date',
  'Settled At',
  'Status',
  'Description',
  'Amount',
  'Currency',
  'Category',
  'Tags',
  'Note',
  'Foreign Amount',
  'Foreign Currency',
]

// A spreadsheet may ignore leading whitespace (and a BOM) before deciding that
// a cell is a formula, so look past it instead of only checking text[0].
// Newlines are included because some importers treat a leading CR/LF as the
// start of a new row or formula.
const INJECTION_PATTERN = /^[\s\uFEFF]*[=+\-@\t\r\n]/

/** Neutralise a text cell that a spreadsheet would treat as a formula. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return INJECTION_PATTERN.test(text) ? `'${text}` : text
}

const NUMERIC_PATTERN = /^-?\d+(?:\.\d+)?$/

/**
 * Money is copied from Up as a decimal string so a leading minus stays a
 * number. Only accept that exact shape; anything else goes through the formula
 * guard instead of being written to the file verbatim.
 */
export function csvNumber(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return NUMERIC_PATTERN.test(text) ? text : csvCell(text)
}

function field(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function row(cells: string[]): string {
  return cells.map(field).join(',')
}

/** Reduce a name to something safe inside a download filename. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _-]/gu, '-').trim()
  return cleaned || 'account'
}

export function csvFilename(accountName: string): string {
  return `${safeFilename(accountName)}-transactions.csv`
}

export function transactionsToCsv(
  transactions: Transaction[],
  categoryMap: Record<string, string>,
): string {
  const lines = [row(HEADER)]

  for (const transaction of transactions) {
    const attributes = transaction.attributes
    const relationships = transaction.relationships ?? {}
    const categoryId = relationships.category?.data?.id
    const tags = (relationships.tags?.data ?? []).map((tag) => tag.id)
    const amount = attributes.amount
    const foreign = attributes.foreignAmount ?? null

    lines.push(
      row([
        csvCell(attributes.createdAt),
        csvCell(attributes.settledAt),
        csvCell(attributes.status),
        csvCell(attributes.description),
        // Up-formatted decimal; left raw so a leading minus is numeric.
        csvNumber(amount?.value),
        csvCell(amount?.currencyCode),
        csvCell(categoryId ? categoryMap[categoryId] : ''),
        csvCell(tags.join('; ')),
        csvCell(attributes.message),
        csvNumber(foreign?.value),
        csvCell(foreign?.currencyCode),
      ]),
    )
  }

  // CRLF, matching the previous server-side `csv.writer` output.
  return `${lines.join('\r\n')}\r\n`
}
