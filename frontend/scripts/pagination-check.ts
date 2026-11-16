// Checks for src/pagination.ts. The anchor path is what prevents a restored
// cursor from skipping or repeating transactions after an offline period.
import {
  dedupeTransactions,
  nextTransactionsPageParam,
  oldestCreatedAt,
  type TransactionsPage,
} from '../src/pagination'
import type { Transaction } from '../src/types'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}

const tx = (id: string, createdAt: string) =>
  ({ id, attributes: { createdAt } }) as unknown as Transaction

const restored: TransactionsPage = {
  transactions: [tx('t1', '2026-01-02T00:00:00Z'), tx('t2', '2026-01-01T00:00:00Z')],
  nextPage: 'stale-cursor',
  restored: true,
  oldestCreatedAt: '2026-01-01T00:00:00Z',
}

const fresh: TransactionsPage = {
  transactions: [tx('t3', '2025-12-31T00:00:00Z')],
  nextPage: 'fresh-cursor',
}

check(
  'restored cache anchors to oldest timestamp',
  JSON.stringify(nextTransactionsPageParam(restored)) ===
    JSON.stringify({ until: '2026-01-01T00:00:00Z' }),
)
check(
  'restored without timestamp falls back to cursor',
  JSON.stringify(
    nextTransactionsPageParam({ ...restored, oldestCreatedAt: null }),
  ) === JSON.stringify({ cursor: 'stale-cursor' }),
)
check(
  'fresh page follows its cursor',
  JSON.stringify(nextTransactionsPageParam(fresh)) ===
    JSON.stringify({ cursor: 'fresh-cursor' }),
)
check(
  'exhausted page has no next param',
  nextTransactionsPageParam({ ...fresh, nextPage: null }) === undefined,
)
check(
  'restored exhausted cache has no next param',
  nextTransactionsPageParam({ ...restored, nextPage: null }) === undefined,
)

const deduped = dedupeTransactions([restored, { ...fresh, transactions: [tx('t2', '2026-01-01T00:00:00Z'), tx('t3', '2025-12-31T00:00:00Z')] }])
check('anchored boundary deduplicated', deduped.map((t) => t.id).join(',') === 't1,t2,t3')
check(
  'oldest timestamp computed',
  oldestCreatedAt([tx('a', '2026-02-01T00:00:00Z'), tx('b', '2025-12-01T00:00:00Z')]) ===
    '2025-12-01T00:00:00Z',
)

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
