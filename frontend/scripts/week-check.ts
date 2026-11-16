// Checks for src/week.ts and src/paidStore.ts: Wed–Tue ranges, occurrence
// generation from a start date, the due/paid summary and paid-record validation.
import type { PlanRow } from '../src/budget'
import {
  endOfWeek,
  formatWeekRange,
  nextDateAfterOccurrence,
  occurrenceInWeek,
  startOfWeek,
  summariseWeek,
  weekDayCells,
  weekRelativeLabel,
} from '../src/week'
import { paidKey, sanitizePaidFile, type PaidMap } from '../src/paidStore'

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
// Occurrences from a start date
// ---------------------------------------------------------------------------
function expense(
  id: string,
  name: string,
  amountCents: number,
  frequency: PlanRow['frequency'],
  startDate: string,
): PlanRow {
  return { id, name, amountCents, frequency, startDate }
}

const weekly = expense('e1', 'Rent', 40000, 'WEEKLY', '2026-11-05')
equal('weekly fits its start week', occurrenceInWeek(weekly, '2026-11-04', '2026-11-10'), '2026-11-05')
equal('weekly moves to the next week', occurrenceInWeek(weekly, '2026-11-11', '2026-11-17'), '2026-11-12')
equal('weekly is absent before it starts', occurrenceInWeek(weekly, '2026-10-28', '2026-11-03'), null)
equal('next weekly occurrence', nextDateAfterOccurrence(weekly, '2026-11-05'), '2026-11-12')

const laterWeekly = expense('e2', 'Fuel', 12000, 'WEEKLY', '2026-11-19')
equal('future weekly appears in its week', occurrenceInWeek(laterWeekly, '2026-11-18', '2026-11-24'), '2026-11-19')
equal('future weekly absent earlier', occurrenceInWeek(laterWeekly, '2026-11-11', '2026-11-17'), null)

const fortnightly = expense('e3', 'Cleaner', 9000, 'FORTNIGHTLY', '2026-11-04')
equal('fortnightly first occurrence', occurrenceInWeek(fortnightly, '2026-11-04', '2026-11-10'), '2026-11-04')
equal('fortnightly skips a week', occurrenceInWeek(fortnightly, '2026-11-11', '2026-11-17'), null)
equal('fortnightly returns', occurrenceInWeek(fortnightly, '2026-11-18', '2026-11-24'), '2026-11-18')

const monthly = expense('e4', 'Internet', 7500, 'MONTHLY', '2026-01-31')
equal('monthly clamps in February', occurrenceInWeek(monthly, '2026-02-25', '2026-03-03'), '2026-02-28')
equal('monthly returns to the 31st', occurrenceInWeek(monthly, '2026-03-25', '2026-03-31'), '2026-03-31')
equal('monthly next date', nextDateAfterOccurrence(monthly, '2026-02-28'), '2026-03-31')

const quarterly = expense('e5', 'Registration', 85000, 'QUARTERLY', '2026-11-30')
equal('quarterly first occurrence', occurrenceInWeek(quarterly, '2026-11-25', '2026-12-01'), '2026-11-30')
equal('quarterly not next week', occurrenceInWeek(quarterly, '2026-12-02', '2026-12-08'), null)

const annual = expense('e6', 'Software', 12000, 'ANNUALLY', '2027-06-21')
equal('annual occurrence week', occurrenceInWeek(annual, '2027-06-16', '2027-06-22'), '2027-06-21')
equal('annual absent this year', occurrenceInWeek(annual, '2026-11-11', '2026-11-17'), null)

// ---------------------------------------------------------------------------
// Due / paid summary
// ---------------------------------------------------------------------------
const plan: PlanRow[] = [
  expense('rent', 'Rent', 40000, 'WEEKLY', '2026-11-04'),
  expense('internet', 'Internet', 7500, 'MONTHLY', '2026-11-05'),
  expense('gym', 'Gym', 3000, 'MONTHLY', '2026-11-20'),
]
const paid: PaidMap = {
  [paidKey('internet', '2026-11-05')]: {
    expenseId: 'internet',
    date: '2026-11-05',
    transactionId: 'tx-internet',
    paidAt: 1_700_000_000_000,
  },
}

const summary = summariseWeek(plan, paid, '2026-11-04', '2026-11-10')
equal('two occurrences this week', summary.occurrences.length, 2)
equal('one due', summary.due.length, 1)
equal('one paid', summary.paid.length, 1)
equal('due total', summary.dueCents, 40000)
equal('paid total', summary.paidCents, 7500)
equal('weekly set-aside reference', summary.weeklySetAsideCents, 42423)
equal('due occurrence is Rent', summary.due[0]?.expense.id, 'rent')
equal('paid occurrence keeps its transaction', summary.paid[0]?.transactionId, 'tx-internet')
equal('gym is not in this week', summary.occurrences.some((o) => o.expense.id === 'gym'), false)

const unpaid = summariseWeek(plan, {}, '2026-11-04', '2026-11-10')
equal('no paid means both due', unpaid.due.length, 2)
equal('no paid total', unpaid.paidCents, 0)
equal('all due total', unpaid.dueCents, 47500)

const nextWeek = summariseWeek(plan, paid, '2026-11-11', '2026-11-17')
equal('weekly rent appears again next week', nextWeek.occurrences.some((o) => o.expense.id === 'rent'), true)
equal('next week rent is unpaid', nextWeek.due.some((o) => o.expense.id === 'rent'), true)
equal('internet is not due next week', nextWeek.occurrences.some((o) => o.expense.id === 'internet'), false)

// ---------------------------------------------------------------------------
// Paid record validation
// ---------------------------------------------------------------------------
const file = sanitizePaidFile({
  version: 1,
  paid: {
    'rent:2026-11-04': {
      expenseId: 'rent',
      date: '2026-11-04',
      transactionId: 'tx-rent',
      paidAt: 1000,
    },
    'internet:2026-11-05': {
      expenseId: 'internet',
      date: '2026-11-05',
      transactionId: 'tx-internet',
      paidAt: 2000,
    },
    'bad-date': {
      expenseId: 'bad',
      date: '2026-02-31',
      transactionId: 'tx-bad',
      paidAt: 3000,
    },
    'missing:2026-11-05': {
      expenseId: 'missing',
      date: '2026-11-05',
      transactionId: 'bad tx',
      paidAt: 4000,
    },
    'mismatch:2026-11-05': {
      expenseId: 'other',
      date: '2026-11-05',
      transactionId: 'tx-mismatch',
      paidAt: 5000,
    },
    'zero-time:2026-11-05': {
      expenseId: 'zero',
      date: '2026-11-05',
      transactionId: 'tx-zero',
      paidAt: 0,
    },
  },
})
check('valid paid file survives', file !== null)
equal('valid paid rows kept', Object.keys(file ?? {}).length, 2)
check('paid transaction id is kept', file?.['rent:2026-11-04'].transactionId === 'tx-rent')
check('wrong paid version is rejected', sanitizePaidFile({ version: 2, paid: {} }) === null)
check('non-object paid file is rejected', sanitizePaidFile('nope') === null)
check('paid key format', paidKey('rent', '2026-11-04') === 'rent:2026-11-04')

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
