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

const INJECTION_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/** Neutralise a text cell that a spreadsheet would treat as a formula. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return INJECTION_TRIGGERS.has(text[0]) ? `'${text}` : text
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
        amount?.value ?? '',
        csvCell(amount?.currencyCode),
        csvCell(categoryId ? categoryMap[categoryId] : ''),
        csvCell(tags.join('; ')),
        csvCell(attributes.message),
        foreign?.value ?? '',
        csvCell(foreign?.currencyCode),
      ]),
    )
  }

  // CRLF, matching the previous server-side `csv.writer` output.
  return `${lines.join('\r\n')}\r\n`
}
