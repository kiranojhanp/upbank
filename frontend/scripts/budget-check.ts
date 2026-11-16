// Checks for src/budget.ts and src/planStore.ts. The fixture reproduces the
// Google Sheets tracker so the port cannot silently drift from the formulas.
import {
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  deriveRow,
  formatDueLabel,
  normalizeFrequency,
  parseAmountToCents,
  parseDateInput,
  parsePlanImport,
  planToCsv,
  summarisePlan,
  weeklySetAsideCents,
  type PlanRow,
} from '../src/budget'
import { sanitizePlan } from '../src/planStore'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}
function near(label: string, actual: number, expected: number, epsilon = 1e-6) {
  check(`${label} (${actual} ≈ ${expected})`, Math.abs(actual - expected) < epsilon)
}
function cents(label: string, actual: number, expected: number) {
  check(`${label} (${actual} = ${expected})`, actual === expected)
}

// ---------------------------------------------------------------------------
// Formula parity, on a fictional 14-bill plan
// ---------------------------------------------------------------------------
// These are synthetic values, not anyone's real bills: the repo and its test
// fixtures are public. They still cover all six frequencies, past/today/
// future start dates, and the rounding paths the sheet uses.
const TODAY = '2026-11-16'

const SHEET: PlanRow[] = [
  ['r1', 'Rent', 50000, 'WEEKLY', '2026-11-19'],
  ['r2', 'Electricity', 12000, 'WEEKLY', '2026-11-13'],
  ['r3', 'Internet', 9500, 'MONTHLY', '2026-11-27'],
  ['r4', 'Car registration', 85000, 'QUARTERLY', '2026-12-13'],
  ['r5', 'Car insurance', 14000, 'MONTHLY', '2026-11-27'],
  ['r6', 'Roadside assistance', 9000, 'MONTHLY', '2026-12-06'],
  ['r7', 'Health insurance', 22000, 'MONTHLY', '2026-11-16'],
  ['r8', 'Brokerage', 10000, 'WEEKLY', '2026-11-19'],
  ['r9', 'Pocket money', 6000, 'WEEKLY', '2026-11-19'],
  ['r10', 'Software subscription', 12000, 'ANNUALLY', '2027-06-21'],
  ['r11', 'Phone plan (A)', 60000, 'ANNUALLY', '2027-04-26'],
  ['r12', 'Phone plan (B)', 60000, 'ANNUALLY', '2027-10-20'],
  ['r13', 'Groceries', 25000, 'WEEKLY', '2026-11-18'],
  ['r14', 'Fuel', 9000, 'WEEKLY', '2026-11-17'],
].map(([id, name, amountCents, frequency, startDate]) => ({
  id: id as string,
  name: name as string,
  amountCents: amountCents as number,
  frequency: frequency as PlanRow['frequency'],
  startDate: startDate as string,
}))

const summary = summarisePlan(SHEET, TODAY)
cents('weekly lock-in target', summary.weeklyCents, 133654)
cents('fortnightly pay-split', summary.fortnightlyCents, 267308)
cents('one-off seed / catch-up', summary.catchUpCents, 265231)
cents('annual total', summary.annualCents, 6950000)

function row(name: string) {
  const found = summary.rows.find((entry) => entry.name === name)
  if (!found) throw new Error(`missing row ${name}`)
  return found
}

near('Rent weekly set-aside', row('Rent').weeklyCents, 50000)
near('Electricity next occurrence has zero weeks', row('Electricity').weeksUntilDue, 0)
check('weekly occurrence advances after today', row('Electricity').nextDueDate === '2026-11-20')
near('Internet weekly set-aside', row('Internet').weeklyCents, (9500 * 12) / 52)
cents('Internet weeks', row('Internet').weeksUntilDue, 1)
cents('Internet catch-up', row('Internet').catchUpCents, 7308)
cents('Car registration weeks', row('Car registration').weeksUntilDue, 3)
cents('Car registration catch-up', row('Car registration').catchUpCents, 65385)
cents('Health insurance is due today', row('Health insurance').daysUntilDue, 0)
cents('Health insurance catch-up is the full bill', row('Health insurance').catchUpCents, 22000)
cents('Software weeks', row('Software subscription').weeksUntilDue, 31)
cents('Software catch-up', row('Software subscription').catchUpCents, 4846)
cents('Phone plan (A) weeks', row('Phone plan (A)').weeksUntilDue, 23)
cents('Phone plan (A) catch-up', row('Phone plan (A)').catchUpCents, 33462)
cents('Phone plan (B) weeks', row('Phone plan (B)').weeksUntilDue, 48)
cents('Phone plan (B) catch-up', row('Phone plan (B)').catchUpCents, 4615)
cents('Fuel due tomorrow', row('Fuel').daysUntilDue, 1)

// Every frequency maps to the sheet's IFS exactly.
near('Weekly set-aside = amount', weeklySetAsideCents(7000, 'WEEKLY'), 7000)
near('Fortnightly set-aside = amount / 2', weeklySetAsideCents(7000, 'FORTNIGHTLY'), 3500)
near('Monthly set-aside = amount × 12 / 52', weeklySetAsideCents(8000, 'MONTHLY'), (8000 * 12) / 52)
near('Quarterly set-aside = amount × 4 / 52', weeklySetAsideCents(23815, 'QUARTERLY'), (23815 * 4) / 52)
near('Biannual set-aside = amount × 2 / 52', weeklySetAsideCents(1000, 'BIANNUALLY'), (1000 * 2) / 52)
near('Annual set-aside = amount / 52', weeklySetAsideCents(3600, 'ANNUALLY'), 3600 / 52)

// A far-away bill is fully covered, so catch-up clamps at zero.
const covered = deriveRow(
  { id: 'x', name: 'Covered', amountCents: 1200, frequency: 'WEEKLY', startDate: '2027-11-16' },
  TODAY,
)
cents('catch-up never goes below zero', covered.catchUpCents, 0)

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
check('ISO date parses', parseDateInput('2026-11-19') === '2026-11-19')
check('Australian date parses', parseDateInput('19/11/2026') === '2026-11-19')
check('dotted date parses', parseDateInput('19.11.2026') === '2026-11-19')
check('two-digit year parses', parseDateInput('19/11/26') === '2026-11-19')
check('month name parses', parseDateInput('19 Nov 2026') === '2026-11-19')
check('full month name parses', parseDateInput('19 November 2026') === '2026-11-19')
check('month-first parses', parseDateInput('Nov 19, 2026') === '2026-11-19')
check('dashed month name parses', parseDateInput('19-Nov-2026') === '2026-11-19')
check('impossible date rejected', parseDateInput('31/02/2026') === null)
check('nonsense date rejected', parseDateInput('next Tuesday') === null)

check('weekly occurrence advances after today', nextOccurrenceOnOrAfter('2026-11-13', 'WEEKLY', TODAY) === '2026-11-20')
check('fortnightly occurrence advances two weeks', nextOccurrenceOnOrAfter('2026-11-13', 'FORTNIGHTLY', TODAY) === '2026-11-27')
check('monthly clamps 31 Jan to 28 Feb', nextOccurrenceOnOrAfter('2026-01-31', 'MONTHLY', '2026-02-01') === '2026-02-28')
check('monthly clamps to leap day', nextOccurrenceOnOrAfter('2028-01-31', 'MONTHLY', '2028-02-01') === '2028-02-29')
check('monthly returns to 31 Mar from 31 Jan', nextOccurrenceOnOrAfter('2026-01-31', 'MONTHLY', '2026-03-01') === '2026-03-31')
check('quarterly rolls three months', nextOccurrenceOnOrAfter('2026-11-30', 'QUARTERLY', '2026-12-01') === '2027-02-28')
check('annual rolls a year', nextOccurrenceOnOrAfter('2026-11-16', 'ANNUALLY', '2026-11-17') === '2027-11-16')
check('next occurrence after a paid one', nextOccurrenceAfter('2026-11-16', 'WEEKLY', TODAY) === '2026-11-23')

check('overdue label', formatDueLabel('2026-11-13', TODAY) === '3 days overdue')
check('today label', formatDueLabel(TODAY, TODAY) === 'due today')
check('tomorrow label', formatDueLabel('2026-11-17', TODAY) === 'due tomorrow')
check('weeks label', formatDueLabel('2026-12-13', TODAY) === 'in 4 weeks')

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
cents('plain amount', parseAmountToCents('70'), 7000)
cents('dollars and cents', parseAmountToCents('70.00'), 7000)
cents('currency symbol', parseAmountToCents('$70.00'), 7000)
cents('thousands separators', parseAmountToCents('$1,234.56'), 123456)
cents('AUD suffix', parseAmountToCents('70.00 AUD'), 7000)
cents('three decimals round', parseAmountToCents('1.005'), 101)
cents('leading dot', parseAmountToCents('.5'), 50)
check('empty amount rejected', parseAmountToCents('') === null)
check('negative amount rejected', parseAmountToCents('-5.00') === null)
check('words rejected', parseAmountToCents('seventy') === null)
check('over the cap rejected', parseAmountToCents('999999999999') === null)

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
const HEADER =
  'Expense Name\tBilled Amount ($)\tFrequency\tStart Date\tWeekly Set-Aside ($)'
const TSV = [
  HEADER,
  'Rent\t$400.00\tWeekly\t2026-11-19\t0\t$400.00\t$400.00',
  'Internet\t$75.00\tMonthly\t27/11/2026\t1\t$17.31\t$57.69',
  'Software\t120.00\tAnnually\t2027-06-21\t31\t2.31\t48.46',
].join('\n')

const imported = parsePlanImport(TSV)
check('sheet header detected', imported.hasHeader)
cents('three rows imported', imported.rows.length, 3)
cents('imported amount', imported.rows[0].amountCents, 40000)
check('imported frequency', imported.rows[1].frequency === 'MONTHLY')
check('imported Australian date', imported.rows[1].startDate === '2026-11-27')
check('no import issues', imported.issues.length === 0)

const LEGACY = parsePlanImport(
  'Expense Name\tBilled Amount ($)\tFrequency\tNext Due Date\nRent\t400\tWeekly\t2026-11-19',
)
check('legacy next-due header is accepted', LEGACY.rows[0]?.startDate === '2026-11-19')

const PREAMBLE = [
  'WEEKLY LOCK-IN TARGET\tTOTAL ONE-OFF SEED / CATCH-UP\tFORTNIGHTLY PAY-SPLIT\tANNUAL TOTAL',
  '$1,336.54\t$2,652.31\t$2,673.08\t$69,500.00',
  'Weekly transfer to bills account\tImmediate top-up to prevent shortfall\tFortnightly pay-cycle split\tTotal baseline yearly commitments',
  '',
  HEADER,
  'Groceries\t250\tWeekly\t2026-11-18',
].join('\n')
const fromPreamble = parsePlanImport(PREAMBLE)
check('header found below the headline rows', fromPreamble.hasHeader)
cents('one row imported below the headline', fromPreamble.rows.length, 1)
check('preamble row does not become an expense', fromPreamble.rows[0]?.name === 'Groceries')

const HEADERLESS = ['Rent\t400\tWeekly\t2026-11-19', 'Health insurance\t220\tMonthly\t2026-11-16'].join(
  '\n',
)
const headerless = parsePlanImport(HEADERLESS)
check('headerless rows use sheet column order', !headerless.hasHeader)
cents('headerless rows imported', headerless.rows.length, 2)
check('headerless date parsed', headerless.rows[1].startDate === '2026-11-16')

const COMMA = ['Name,Amount,Frequency,Due', '"Home, rent share",$400.00,Weekly,2026-11-19'].join(
  '\n',
)
const comma = parsePlanImport(COMMA)
cents('comma CSV row imported', comma.rows.length, 1)
check('quoted comma in name preserved', comma.rows[0]?.name === 'Home, rent share')

const BAD = [
  HEADER,
  '\t10\tWeekly\t2026-11-19',
  'No amount\t\tWeekly\t2026-11-19',
  'Bad amount\tabc\tWeekly\t2026-11-19',
  'Bad frequency\t10\tSometimes\t2026-11-19',
  'Bad date\t10\tWeekly\t2026-02-31',
  'Good row\t10\tFortnightly\t2026-11-19',
].join('\n')
const bad = parsePlanImport(BAD)
cents('only the valid row survives', bad.rows.length, 1)
cents('five rows reported as issues', bad.issues.length, 5)

check('BOM stripped', parsePlanImport(`\uFEFF${HEADERLESS}`).rows.length === 2)

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
const csv = planToCsv(summary.rows)
const csvLines = csv.trimEnd().split('\r\n')
check('CSV has the recurring columns', csvLines[0].startsWith('Expense Name,Billed Amount ($),Frequency,Start Date'))
cents('CSV has one header plus every row', csvLines.length, SHEET.length + 1)
check('CSV leaves a plain name unquoted', csvLines[1].includes('"Rent"') === false)
check('CSV has the annual commitment row', csvLines.some((line) => line.startsWith('Fuel,')))
const guarded = planToCsv([
  deriveRow(
    {
      id: 'x',
      name: '=HYPERLINK("https://evil.example")',
      amountCents: 100,
      frequency: 'WEEKLY',
      startDate: '2026-11-19',
    },
    TODAY,
  ),
])
check('CSV neutralises a formula name', guarded.split('\r\n')[1].startsWith(`"'=`))

const roundTrip = parsePlanImport(planToCsv(summary.rows))
cents('export re-imports every row', roundTrip.rows.length, SHEET.length)
check('export round-trip has no issues', roundTrip.issues.length === 0)
cents(
  'export round-trip keeps an annual amount',
  roundTrip.rows.find((row) => row.name === 'Software subscription')?.amountCents ?? 0,
  12000,
)

// ---------------------------------------------------------------------------
// Stored plan validation
// ---------------------------------------------------------------------------
const stored = sanitizePlan({
  version: 1,
  rows: [
    { id: 'abc', name: ' Rent ', amountCents: 7000, frequency: 'WEEKLY', startDate: '2026-11-19' },
    { id: 'abc', name: 'Duplicate id', amountCents: 1, frequency: 'WEEKLY', startDate: '2026-11-19' },
    { id: 'bad-name', name: '', amountCents: 1, frequency: 'WEEKLY', startDate: '2026-11-19' },
    { id: 'bad-frequency', name: 'x', amountCents: 1, frequency: 'SOMETIMES', startDate: '2026-11-19' },
    { id: 'bad-amount', name: 'x', amountCents: -1, frequency: 'WEEKLY', startDate: '2026-11-19' },
    { id: 'bad-date', name: 'x', amountCents: 1, frequency: 'WEEKLY', startDate: '2026-02-31' },
    { id: 'ok-2', name: 'Fuel', amountCents: 15000, frequency: 'WEEKLY', startDate: '2026-11-17' },
  ],
})
check('stored plan keeps valid rows only', stored?.length === 2)
check('stored name is trimmed', stored?.[0].name === 'Rent')
const padded = sanitizePlan({
  version: 1,
  rows: [
    { id: 'padded', name: 'Rent', amountCents: 40000, frequency: 'WEEKLY', startDate: ' 2026-11-19 ' },
  ],
})
check('padded start date is normalised', padded?.[0].startDate === '2026-11-19')
const legacyStored = sanitizePlan({
  version: 1,
  rows: [
    { id: 'legacy', name: 'Rent', amountCents: 40000, frequency: 'WEEKLY', nextDueDate: '2026-11-19' },
  ],
})
check('legacy stored due date migrates to start date', legacyStored?.[0].startDate === '2026-11-19')
check('wrong schema version is rejected', sanitizePlan({ version: 2, rows: [] }) === null)
check('non-object is rejected', sanitizePlan('nope') === null)

check('frequency alias: yearly', normalizeFrequency('Yearly') === 'ANNUALLY')
check('frequency alias: fortnight', normalizeFrequency('fortnight') === 'FORTNIGHTLY')
check('frequency alias: half-yearly', normalizeFrequency('half-yearly') === 'BIANNUALLY')
check('unknown frequency is null', normalizeFrequency('sometimes') === null)

console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
if (!ok) process.exit(1)
