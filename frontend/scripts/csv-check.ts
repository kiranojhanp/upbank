// Checks for src/csv.ts: column order, escaping, and the spreadsheet
// formula-injection guard.
import { csvCell, csvFilename, csvNumber, transactionsToCsv } from '../src/csv'
import type { Transaction } from '../src/types'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}

check('formula neutralised', csvCell('=cmd|x') === "'=cmd|x")
check('leading minus text neutralised', csvCell('-5') === "'-5")
check('plain passes through', csvCell('Woolworths') === 'Woolworths')
check('null -> empty', csvCell(null) === '')
check('leading whitespace formula neutralised', csvCell('  =cmd') === "'  =cmd")
check('BOM formula neutralised', csvCell('\uFEFF=cmd') === "'\uFEFF=cmd")
check('leading newline formula neutralised', csvCell('\n=cmd') === "'\n=cmd")
check('numeric amount stays numeric', csvNumber('-12.34') === '-12.34')
check('invalid amount neutralised', csvNumber('=1+1') === "'=1+1")
check('non-decimal amount neutralised', csvNumber('-1+2') === "'-1+2")
check('filename sanitised', csvFilename('Everyday / Account') === 'Everyday - Account-transactions.csv')

const tx = [
  {
    id: 't1',
    attributes: {
      description: 'Woolworths',
      createdAt: '2026-01-05T03:00:00+11:00',
      settledAt: '2026-01-05T03:00:01+11:00',
      status: 'SETTLED',
      amount: { value: '-12.34', currencyCode: 'AUD', valueInBaseUnits: -1234 },
      message: 'weekly shop',
      foreignAmount: { value: '-8.00', currencyCode: 'USD' },
      rawText: null,
    },
    relationships: {
      category: { data: { id: 'cat-1' } },
      tags: { data: [{ id: 'Holiday' }, { id: 'Pizza Night' }] },
    },
  },
  {
    id: 't2',
    attributes: {
      description: 'Comma, "quoted"',
      createdAt: '2026-01-06T03:00:00+11:00',
      status: 'HELD',
      amount: { value: '200.00', currencyCode: 'AUD', valueInBaseUnits: 20000 },
    },
  },
] as unknown as Transaction[]

const csv = transactionsToCsv(tx, { 'cat-1': 'Groceries' })
const lines = csv.split('\r\n')
check(
  'header',
  lines[0] ===
    'Date,Settled At,Status,Description,Amount,Currency,Category,Tags,Note,Foreign Amount,Foreign Currency',
)
check('row + trailing empty', lines.length === 4)
check(
  'row content',
  csv.includes(
    '2026-01-05T03:00:00+11:00,2026-01-05T03:00:01+11:00,SETTLED,Woolworths,-12.34,AUD,Groceries,Holiday; Pizza Night,weekly shop,-8.00,USD',
  ),
)
check('fields with commas/quotes escaped', csv.includes('"Comma, ""quoted"""'))
check('uses CRLF', csv.includes('\r\n'))

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
