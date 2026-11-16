// Checks for src/week.ts and src/weekStore.ts: Wed–Tue week maths, the
// plan-seeded entries, attachment summaries and stored-week validation.
import {
  deriveWeekEntries,
  endOfWeek,
  formatWeekRange,
  startOfWeek,
  summariseWeek,
  weekDayCells,
  weekRelativeLabel,
  type WeekEntry,
  type WeekTransaction,
} from '../src/week'
import { sanitizeWeekStore } from '../src/weekStore'
import type { PlanRow } from '../src/budget'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}
function equal(label: string, actual: unknown, expected: unknown) {
  check(`${label} (${String(actual)} = ${String(expected)})`, actual === expected)
}

// ---------------------------------------------------------------------------
// Wednesday → Tuesday
// ---------------------------------------------------------------------------
equal('Wednesday starts its own week', startOfWeek('2026-11-04'), '2026-11-04')
equal('Thursday belongs to Wednesday', startOfWeek('2026-11-05'), '2026-11-04')
equal('Tuesday belongs to the prior Wednesday', startOfWeek('2026-11-10'), '2026-11-04')
equal('next Wednesday starts a new week', startOfWeek('2026-11-11'), '2026-11-11')
equal('Monday belongs to the prior Wednesday', startOfWeek('2026-11-16'), '2026-11-11')
equal('week ends on Tuesday', endOfWeek('2026-11-04'), '2026-11-10')
equal('same-month range', formatWeekRange('2026-11-04'), 'Wed 4 – Tue 10 Nov 2026')
equal('cross-month range', formatWeekRange('2026-10-28'), 'Wed 28 Oct – Tue 3 Nov 2026')
equal('cross-year range', formatWeekRange('2026-12-30'), 'Wed 30 Dec – Tue 5 Jan 2027')

const days = weekDayCells('2026-11-04', '2026-11-05')
equal('seven day cells', days.length, 7)
equal('first day is Wednesday', days[0].weekday, 'Wed')
equal('last day is Tuesday', days[6].weekday, 'Tue')
equal('today flag', days[1].isToday, true)
equal('other days are not today', days[0].isToday, false)

equal('current relative label', weekRelativeLabel('2026-11-04', '2026-11-05'), 'This week')
equal('next relative label', weekRelativeLabel('2026-11-11', '2026-11-05'), 'Next week')
equal('last relative label', weekRelativeLabel('2026-10-28', '2026-11-05'), 'Last week')

// ---------------------------------------------------------------------------
// Plan → week entries
// ---------------------------------------------------------------------------
const PLAN: PlanRow[] = [
  { id: 'r1', name: 'Rent', amountCents: 40000, frequency: 'WEEKLY', nextDueDate: '2026-11-19' },
  {
    id: 'r2',
    name: 'Internet',
    amountCents: 7500,
    frequency: 'MONTHLY',
    nextDueDate: '2026-11-27',
  },
  {
    id: 'r3',
    name: 'Software',
    amountCents: 12000,
    frequency: 'ANNUALLY',
    nextDueDate: '2027-06-21',
  },
]

const derived = deriveWeekEntries(PLAN, '2026-11-04')
equal('one entry per plan row', derived.length, 3)
equal('weekly entry keeps the amount', derived[0].budgetCents, 40000)
equal('monthly entry uses the weekly set-aside', derived[1].budgetCents, 1731)
equal('annual entry uses the weekly set-aside', derived[2].budgetCents, 231)
equal('derived id is stable', derived[0].id, 'week:2026-11-04:plan:r1')
equal('derived id tracks the week', deriveWeekEntries(PLAN, '2026-11-11')[0].id, 'week:2026-11-11:plan:r1')
equal('source plan id is kept', derived[1].sourcePlanId, 'r2')

// ---------------------------------------------------------------------------
// Attachments and totals
// ---------------------------------------------------------------------------
const entries: WeekEntry[] = [
  { id: 'g', name: 'Groceries', budgetCents: 10000 },
  { id: 'rent', name: 'Rent', budgetCents: 40000 },
]
const links = { t1: 'g', t2: 'g', t3: 'missing' }
const transactions: WeekTransaction[] = [
  {
    id: 't1',
    description: 'Coffee',
    createdAt: '2026-11-05T08:00:00Z',
    amountCents: 550,
    accountName: 'Spending',
    status: 'SETTLED',
  },
  {
    id: 't2',
    description: 'Weekly shop',
    createdAt: '2026-11-04T09:00:00Z',
    amountCents: 4210,
    accountName: 'Spending',
    status: 'SETTLED',
  },
  {
    id: 't3',
    description: 'Pending coffee',
    createdAt: '2026-11-06T09:00:00Z',
    amountCents: 600,
    accountName: 'Spending',
    status: 'HELD',
  },
  {
    id: 't4',
    description: 'Fuel',
    createdAt: '2026-11-03T09:00:00Z',
    amountCents: 1000,
    accountName: 'Spending',
    status: 'SETTLED',
  },
]

const summary = summariseWeek(entries, links, transactions)
equal('planned total', summary.plannedCents, 50000)
equal('spent total', summary.spentCents, 6360)
equal('left total', summary.leftCents, 43640)
equal('unassigned count', summary.unassignedCount, 2)
equal('unassigned total', summary.unassignedCents, 1600)
equal('transaction count', summary.transactionCount, 4)
equal('groceries attached count', summary.entries[0].attached.length, 2)
equal('groceries spent', summary.entries[0].spentCents, 4760)
equal('groceries remaining', summary.entries[0].remainingCents, 5240)
equal('groceries linked count', summary.entries[0].linkedCount, 2)
equal('rent spent', summary.entries[1].spentCents, 0)
equal('rent remains', summary.entries[1].remainingCents, 40000)
equal('missing-entry links are unassigned', summary.unassignedCount, 2)

const unknown = summariseWeek(entries, links, null)
equal('unknown spend is null', unknown.spentCents, null)
equal('unknown left is null', unknown.leftCents, null)
equal('unknown entry spend is null', unknown.entries[0].spentCents, null)
equal('links still count without details', unknown.entries[0].linkedCount, 2)

check(
  'overspend gives a negative remaining',
  summariseWeek(
    [{ id: 'x', name: 'Tiny', budgetCents: 100 }],
    { t1: 'x' },
    [transactions[0]],
  ).entries[0].remainingCents === -450,
)

// ---------------------------------------------------------------------------
// Stored week validation
// ---------------------------------------------------------------------------
const stored = sanitizeWeekStore({
  version: 1,
  weeks: {
    '2026-11-04': {
      entries: [
        {
          id: 'week:2026-11-04:plan:r1',
          name: ' Rent ',
          budgetCents: 40000,
          sourcePlanId: 'r1',
        },
        { id: 'g', name: 'Groceries', budgetCents: 10000 },
        { id: 'bad-name', name: '', budgetCents: 1 },
        { id: 'bad-budget', name: 'x', budgetCents: -1 },
        { id: 'bad-budget-fraction', name: 'x', budgetCents: 1.5 },
      ],
      links: { t1: 'g', t2: 'missing', '': 'g' },
      updatedAt: 123,
    },
    'not-a-date': {
      entries: [],
      links: {},
      updatedAt: 0,
    },
  },
})
check('valid store survives', stored !== null)
equal('valid weeks kept only', Object.keys(stored ?? {}).length, 1)
equal('valid entries kept only', stored?.['2026-11-04'].entries.length, 2)
equal('entry name is trimmed', stored?.['2026-11-04'].entries[0].name, 'Rent')
check(
  'derived id with colons is accepted',
  stored?.['2026-11-04'].entries[0].id === 'week:2026-11-04:plan:r1',
)
equal('links to missing entries are dropped', Object.keys(stored?.['2026-11-04'].links ?? {}).length, 1)
check('link to the surviving entry is kept', stored?.['2026-11-04'].links.t1 === 'g')
check('wrong version is rejected', sanitizeWeekStore({ version: 2, weeks: {} }) === null)
check('non-object is rejected', sanitizeWeekStore('nope') === null)
check('missing weeks is rejected', sanitizeWeekStore({ version: 1 }) === null)

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
