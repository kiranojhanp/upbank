import { readFile } from 'node:fs/promises'
import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

const HEADER = 'Expense Name\tBilled Amount ($)\tFrequency\tStart Date'

async function openPlan(app: AppPage): Promise<void> {
  await app.login()
  await app.expectDashboard()
  await app.freezeToday()
  await app.openPlan()
}

test.describe('recurring expenses', () => {
  test('adds a monthly expense with a start date and survives a reload', async ({
    app,
    page,
  }) => {
    await openPlan(app)
    await expect(page.getByText('No recurring expenses yet')).toBeVisible()

    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      start: '2026-11-27',
    })

    await expect(app.planStat('weekly')).toContainText('$17.31')
    await expect(app.planStat('seed')).toContainText('$57.69')
    await expect(app.planStat('fortnightly')).toContainText('$34.62')
    await expect(app.planStat('annual')).toContainText('$900.00')

    const row = app.planRow('Internet')
    await expect(row).toContainText('$75.00')
    await expect(row).toContainText('Monthly')
    await expect(row).toContainText('27 Nov 2026')
    await expect(row).toContainText('$17.31')

    await page.reload()
    await app.expectDashboard()
    await app.openPlan()

    await expect(app.planRow('Internet')).toBeVisible()
    await expect(app.planStat('weekly')).toContainText('$17.31')
  })

  test('edits an expense and deletes it with an inline confirmation', async ({ app, page }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      start: '2026-11-27',
    })

    await app.planRow('Internet').getByRole('button', { name: 'Edit Internet' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Billed amount').fill('160.00')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(app.planRow('Internet')).toContainText('$160.00')
    await expect(app.planStat('weekly')).toContainText('$36.92')
    await expect(app.planStat('seed')).toContainText('$123.08')

    await app.planRow('Internet').getByRole('button', { name: 'Edit Internet' }).click()
    await dialog.getByRole('button', { name: 'Delete expense' }).click()
    await dialog.getByRole('button', { name: 'Yes, delete' }).click()

    await expect(page.getByText('No recurring expenses yet')).toBeVisible()
    await expect(page.locator('[data-stat="weekly"]')).toHaveCount(0)
  })

  test('imports pasted rows, reports bad rows, and appends or replaces', async ({
    app,
    page,
  }) => {
    const text = [
      HEADER,
      'Rent\t400.00\tWeekly\t2026-11-19',
      'Internet\t$75.00\tMonthly\t27/11/2026',
      'Bad row\t10.00\tSometimes\t2026-11-20',
    ].join('\n')

    await openPlan(app)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Paste expenses').fill(text)

    await expect(dialog.getByText('2 expenses ready, 1 row skipped.')).toBeVisible()
    await expect(
      dialog.getByText('Row 4: "Bad row" has an unknown frequency (Sometimes)'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Import 2 expenses' }).click()

    await expect(page.locator('.plan-expense-row')).toHaveCount(2)
    await expect(app.planStat('weekly')).toContainText('$417.31')
    await expect(app.planStat('seed')).toContainText('$457.69')
    await expect(app.planStat('annual')).toContainText('$21,700.00')
    await expect(app.planRow('Rent')).toContainText('$400.00')

    await app.importPlan(
      [HEADER, 'Fuel\t120.00\tWeekly\t2026-11-17'].join('\n'),
      'append',
    )
    await expect(page.locator('.plan-expense-row')).toHaveCount(3)

    await app.importPlan(
      [HEADER, 'Groceries\t180.00\tWeekly\t2026-11-18'].join('\n'),
      'replace',
    )
    await expect(page.locator('.plan-expense-row')).toHaveCount(1)
    await expect(app.planStat('weekly')).toContainText('$180.00')
    await expect(app.planStat('annual')).toContainText('$9,360.00')
  })

  test('selects all and bulk deletes recurring expenses', async ({ app, page }) => {
    await openPlan(app)
    await app.importPlan(
      [
        HEADER,
        'Rent\t400.00\tWeekly\t2026-11-19',
        'Internet\t75.00\tMonthly\t2026-11-27',
        'Fuel\t120.00\tWeekly\t2026-11-17',
      ].join('\n'),
    )
    await app.dismissToasts()

    await page.getByRole('checkbox', { name: 'Select all recurring expenses' }).check()
    await expect(page.getByText('3 expenses selected')).toBeVisible()
    await page.getByRole('button', { name: 'Delete selected' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Delete 3 expenses?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete selected' }).click()

    await expect(page.getByText('No recurring expenses yet')).toBeVisible()
    await expect(page.locator('.plan-expense-row')).toHaveCount(0)
  })

  test('exports a CSV with start dates and weekly set-asides', async ({ app }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-19',
    })
    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      start: '2026-11-27',
    })

    const download = await app.exportPlanCsv()
    expect(download.suggestedFilename()).toBe('recurring-expenses-2026-11-16.csv')
    const path = await download.path()
    expect(path).not.toBeNull()
    const csv = await readFile(path as string, 'utf8')

    expect(csv.split('\r\n')[0]).toBe(
      'Expense Name,Billed Amount ($),Frequency,Start Date,Weekly Set-Aside ($)',
    )
    expect(csv).toContain('Rent,400.00,Weekly,2026-11-19,400.00')
    expect(csv).toContain('Internet,75.00,Monthly,2026-11-27,17.31')
  })

  test('deletes the whole plan after confirmation', async ({ app, page }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-19',
    })

    await page.getByRole('button', { name: 'Delete plan' }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText(
        'This removes this expense and its paid history from this browser.',
      ),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete plan' }).click()

    await expect(page.getByText('No recurring expenses yet')).toBeVisible()
    await page.reload()
    await app.expectDashboard()
    await app.openPlan()
    await expect(page.getByText('No recurring expenses yet')).toBeVisible()
  })

  test('keeps the plan across sign out and back in', async ({ app }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-19',
    })

    await app.signOut()
    await app.expectLogin()
    await app.login()
    await app.expectDashboard()
    await app.openPlan()

    await expect(app.planRow('Rent')).toBeVisible()
  })

  test('opens recurring expenses from the week view on mobile', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await app.login()
    await app.expectDashboard()

    await expect(page.locator('#week-section')).toBeVisible()
    await page.getByRole('button', { name: 'Recurring expenses', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Recurring expenses', exact: true })).toBeVisible()
  })
})
