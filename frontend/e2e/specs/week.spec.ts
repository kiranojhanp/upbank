import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

async function startWeek(app: AppPage, iso = '2026-11-05T02:00:00.000Z') {
  await app.freezeToday(iso)
  await app.login()
  await app.expectDashboard()
}

async function addWeeklyExpense(
  app: AppPage,
  name: string,
  amount: string,
  start = '2026-11-05',
) {
  await app.openPlan()
  await app.addExpense({ name, amount, frequency: 'WEEKLY', start })
}

test.describe('weekly recurring expenses', () => {
  test('validates and marks a weekly expense paid from local transactions', async ({
    app,
    page,
    api,
  }) => {
    await startWeek(app)
    await app.cacheTransactions()
    await addWeeklyExpense(app, 'Rent', '400.00')
    await app.openWeek()
    const beforePicker = api.transactionRequests.length

    await expect(app.weekEntry('Rent')).toBeVisible()
    await expect(app.weekStat('due')).toContainText('$400.00')
    await expect(app.weekStat('paid')).toContainText('0 · $0.00')
    await expect(page.getByRole('heading', { name: 'Rent' })).toBeVisible()
    await expect(
      page.locator('.week-figure').filter({ hasText: 'Next' }),
    ).toContainText('12 Nov 2026')

    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Mark Rent as paid' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeDisabled()

    await app.selectPaidAccount('Spending')
    await expect(app.weekTransaction('Salary')).toBeVisible()
    expect(api.transactionRequests.length).toBe(beforePicker)

    await app.weekTransaction('Salary').click()
    await expect(
      dialog.getByText('Credits cannot pay an expense. Choose a debit transaction.'),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeDisabled()

    await app.weekTransaction('Coffee').click()
    await expect(
      dialog.getByText(
        'Amounts do not match: the transaction is $5.50, but Rent is $400.00.',
      ),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeDisabled()

    await app.weekTransaction('Rent payment').click()
    await expect(dialog.getByText('Amount matches.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.week-entry-list')).toHaveCount(0)
    await expect(page.getByText(/All done for this week/)).toBeVisible()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekPaidEntry('Rent')).toBeVisible()
    await expect(page.locator('.week-paid-status')).toContainText('Paid this week')

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 11 – Tue 17 Nov 2026')
    await expect(app.weekEntry('Rent')).toBeVisible()
    await expect(app.weekPaidEntry('Rent')).toHaveCount(0)
    await expect(app.weekStat('due')).toContainText('$400.00')

    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekPaidEntry('Rent')).toBeVisible()
    await page.reload()
    await app.expectDashboard()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekEntry('Rent')).toHaveCount(0)
    await expect(app.weekPaidEntry('Rent')).toBeVisible()
  })

  test('only shows a monthly expense in its due week and hides it after payment', async ({
    app,
    page,
  }) => {
    await startWeek(app, '2026-11-26T02:00:00.000Z')
    await app.cacheTransactions()
    await app.openPlan()
    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      start: '2026-11-27',
    })
    await app.openWeek()

    await expect(app.weekEntry('Internet')).toBeVisible()
    await expect(
      page.locator('.week-figure').filter({ hasText: 'Next' }),
    ).toContainText('27 Dec 2026')

    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(page.getByText('Nothing due this week.', { exact: true })).toBeVisible()
    await expect(app.weekEntry('Internet')).toHaveCount(0)
    await page.getByRole('button', { name: 'This week' }).click()

    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await app.weekTransaction('Internet payment').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await expect(app.weekStat('paid')).toContainText('1 · $75.00')
    await expect(app.weekEntry('Internet')).toHaveCount(0)
    await expect(app.weekPaidEntry('Internet')).toBeVisible()

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(app.weekEntry('Internet')).toHaveCount(0)
    await expect(app.weekPaidEntry('Internet')).toHaveCount(0)
    await expect(page.getByText('Nothing due this week.', { exact: true })).toBeVisible()
  })

  test('does not let one transaction pay two expenses', async ({ app, page }) => {
    await startWeek(app)
    await app.cacheTransactions()
    await addWeeklyExpense(app, 'Rent', '400.00')
    await app.openPlan()
    await app.addExpense({
      name: 'Fuel',
      amount: '120.00',
      frequency: 'WEEKLY',
      start: '2026-11-05',
    })
    await app.openWeek()

    await app.weekEntry('Rent').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await app.weekTransaction('Rent payment').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await app.weekEntry('Fuel').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const secondDialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await expect(secondDialog.getByText('Used for Rent')).toBeVisible()
    await expect(app.weekTransaction('Rent payment')).toBeDisabled()

    await app.weekTransaction('Fuel payment').click()
    await secondDialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('2 · $520.00')
    await expect(page.getByText(/All done for this week/)).toBeVisible()
    await expect(app.weekPaidEntry('Rent')).toBeVisible()
    await expect(app.weekPaidEntry('Fuel')).toBeVisible()
  })

  test('navigates weeks without making transaction requests', async ({ app, page, api }) => {
    await startWeek(app)
    const before = api.transactionRequests.length

    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 28 Oct – Tue 3 Nov 2026')
    await page.getByRole('button', { name: 'Next week' }).click()
    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 11 – Tue 17 Nov 2026')
    await page.getByRole('button', { name: 'This week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')

    expect(api.transactionRequests.length).toBe(before)
  })

  test('loads an account once from Up when its local cache is empty', async ({
    app,
    page,
  }) => {
    await startWeek(app)
    await addWeeklyExpense(app, 'Rent', '400.00')
    await app.openWeek()

    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await expect(dialog.getByText('No cached transactions for this account.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeDisabled()

    await dialog.getByRole('button', { name: 'Load from Up' }).click()
    await expect(app.weekTransaction('Rent payment')).toBeVisible()
    await app.weekTransaction('Rent payment').click()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekPaidEntry('Rent')).toBeVisible()
  })

  test('works in a narrow viewport without horizontal overflow', async ({ app, page }) => {
    await startWeek(app)
    await app.cacheTransactions()
    await addWeeklyExpense(app, 'Rent', '400.00')
    await app.openWeek()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('#week-section')).toBeVisible()
    await expect(app.weekEntry('Rent')).toBeVisible()

    await app.weekEntry('Rent').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await app.weekTransaction('Rent payment').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekPaidEntry('Rent')).toBeVisible()

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(noOverflow).toBe(true)
  })
})
