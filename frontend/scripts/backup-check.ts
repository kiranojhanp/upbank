// Checks for src/backup.ts: round-trip, validation, dropped rows and the
// guarantee that no token or transaction descriptions are in the file.
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  parseBackup,
} from '../src/backup'
import type { PlanRow } from '../src/budget'
import { paidKey, type PaidMap } from '../src/paidStore'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}
function equal(label: string, actual: unknown, expected: unknown) {
  check(`${label} (${String(actual)} = ${String(expected)})`, actual === expected)
}
function throws(label: string, fn: () => unknown) {
  try {
    fn()
    check(label, false)
  } catch {
    check(label, true)
  }
}

const plan: PlanRow[] = [
  {
    id: 'r1',
    name: 'Rent',
    amountCents: 40000,
    frequency: 'WEEKLY',
    startDate: '2026-11-05',
  },
  {
    id: 'r2',
    name: 'Internet',
    amountCents: 7500,
    frequency: 'MONTHLY',
    startDate: '2026-11-27',
  },
]
const paid: PaidMap = {
  [paidKey('r1', '2026-11-05')]: {
    expenseId: 'r1',
    date: '2026-11-05',
    transactionId: 'tx-coffee',
    paidAt: 1_700_000_000_000,
  },
}

const text = createBackup(plan, paid, '2026-11-16T00:00:00.000Z')
const value = JSON.parse(text) as Record<string, unknown>
equal('format marker', value.format, BACKUP_FORMAT)
equal('backup version', value.version, BACKUP_VERSION)
equal('exported timestamp', value.exportedAt, '2026-11-16T00:00:00.000Z')
check('no token property', !Object.prototype.hasOwnProperty.call(value, 'token'))
check('no token anywhere', !text.toLowerCase().includes('token'))
const paidRecord = (
  (value.paid as { paid: Record<string, Record<string, unknown>> }).paid
)['r1:2026-11-05']
check('paid record has no description', !('description' in paidRecord))
check('paid record has no amount', !('amountCents' in paidRecord))
equal('paid record keeps transaction id', paidRecord.transactionId, 'tx-coffee')

const parsed = parseBackup(text)
equal('round-trip plan rows', parsed.planRows.length, 2)
equal('round-trip paid records', Object.keys(parsed.paid).length, 1)
equal('round-trip export date', parsed.exportedAt, '2026-11-16T00:00:00.000Z')
equal('no dropped plan rows', parsed.droppedPlan, 0)
equal('no dropped paid records', parsed.droppedPaid, 0)
check('round-trip keeps start date', parsed.planRows[0].startDate === '2026-11-05')

const orphan: PaidMap = {
  ...paid,
  [paidKey('gone', '2026-11-05')]: {
    expenseId: 'gone',
    date: '2026-11-05',
    transactionId: 'tx-gone',
    paidAt: 1_700_000_000_001,
  },
}
const orphanParsed = parseBackup(createBackup(plan, orphan))
equal('orphan paid records dropped', Object.keys(orphanParsed.paid).length, 1)
equal('orphan paid count reported', orphanParsed.droppedPaid, 1)

const broken = JSON.parse(text) as {
  plan: { rows: unknown[] }
  paid: { paid: Record<string, unknown> }
}
broken.plan.rows.push({ id: 'bad', name: '', amountCents: 1 })
broken.paid.paid['bad:2026-11-05'] = { nonsense: true }
const brokenParsed = parseBackup(JSON.stringify(broken))
equal('invalid plan row dropped', brokenParsed.droppedPlan, 1)
equal('invalid paid record dropped', brokenParsed.droppedPaid, 1)
equal('valid rows still imported', brokenParsed.planRows.length, 2)

throws('non-JSON rejected', () => parseBackup('not json'))
throws('wrong format rejected', () => parseBackup(JSON.stringify({ format: 'other' })))
throws('wrong version rejected', () =>
  parseBackup(JSON.stringify({ ...value, version: 99 })),
)
throws('missing plan rejected', () =>
  parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION })),
)
const badPlan = JSON.parse(text) as Record<string, unknown>
badPlan.plan = { version: 99, rows: [] }
throws('bad plan envelope rejected', () => parseBackup(JSON.stringify(badPlan)))
const badPaid = JSON.parse(text) as Record<string, unknown>
badPaid.paid = { version: 99, paid: {} }
throws('bad paid envelope rejected', () => parseBackup(JSON.stringify(badPaid)))

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
