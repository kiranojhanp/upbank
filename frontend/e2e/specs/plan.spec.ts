import { readFile } from 'node:fs/promises'
import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

const HEADER = 'Expense Name\tBilled Amount ($)\tFrequency\tNext Due Date'

async function openPlan(app: AppPage): Promise<void> {
  await app.login()
  await app.expectDashboard()
  await app.freezeToday()
  await app.openPlan()
}

test.describe('set-aside plan', () => {
  test('turns a monthly bill into the sheet numbers and survives a reload', async ({
    app,
    page,
  }) => {
    await openPlan(app)
    await expect(page.getByText('No expenses yet')).toBeVisible()

    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      due: '2026-11-27',
    })

    await expect(app.planStat('weekly')).toContainText('$17.31')
    await expect(app.planStat('seed')).toContainText('$57.69')
    await expect(app.planStat('fortnightly')).toContainText('$34.62')
    await expect(app.planStat('annual')).toContainText('$900.00')

    const row = app.planRow('Internet')
    await expect(row).toContainText('$75.00')
    await expect(row).toContainText('Monthly')
    await expect(row).toContainText('27 Nov 2026')
    await expect(row).toContainText('in 11 days')
    await expect(row).toContainText('$17.31')
    await expect(row).toContainText('$57.69')

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
      due: '2026-11-27',
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

    await expect(page.getByText('No expenses yet')).toBeVisible()
    await expect(page.locator('[data-stat="weekly"]')).toHaveCount(0)
  })

  test('imports pasted sheet rows, reports bad rows, and appends or replaces', async ({
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

    await expect(page.locator('.plan-table tbody tr')).toHaveCount(2)
    await expect(app.planStat('weekly')).toContainText('$417.31')
    await expect(app.planStat('seed')).toContainText('$457.69')
    await expect(app.planStat('annual')).toContainText('$21,700.00')
    await expect(app.planRow('Rent')).toContainText('$400.00')

    await app.importPlan(
      [HEADER, 'Fuel\t120.00\tWeekly\t2026-11-17'].join('\n'),
      'append',
    )
    await expect(page.locator('.plan-table tbody tr')).toHaveCount(3)

    await app.importPlan(
      [HEADER, 'Groceries\t180.00\tWeekly\t2026-11-18'].join('\n'),
      'replace',
    )
    await expect(page.locator('.plan-table tbody tr')).toHaveCount(1)
    await expect(app.planStat('weekly')).toContainText('$180.00')
    await expect(app.planStat('annual')).toContainText('$9,360.00')
  })

  test('marks a weekly bill paid and rolls the due date forward', async ({ app, page }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Electricity',
      amount: '40.00',
      frequency: 'WEEKLY',
      due: '2026-11-16',
    })

    await expect(app.planStat('seed')).toContainText('$40.00')

    await app.planRow('Electricity').getByRole('button', {
      name: 'Mark Electricity as paid',
    }).click()

    await expect(app.planRow('Electricity')).toContainText('23 Nov 2026')
    await expect(app.planRow('Electricity')).toContainText('in 7 days')
    await expect(app.planStat('seed')).toContainText('$0.00')
    await expect(page.getByText('Marked paid')).toBeVisible()
  })

  test('exports a CSV with the sheet columns and computed values', async ({ app }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      due: '2026-11-19',
    })
    await app.addExpense({
      name: 'Internet',
      amount: '75.00',
      frequency: 'MONTHLY',
      due: '2026-11-27',
    })

    const download = await app.exportPlanCsv()
    expect(download.suggestedFilename()).toBe('set-aside-plan-2026-11-16.csv')
    const path = await download.path()
    expect(path).not.toBeNull()
    const csv = await readFile(path as string, 'utf8')

    expect(csv.split('\r\n')[0]).toBe(
      'Expense Name,Billed Amount ($),Frequency,Next Due Date,Weeks Until Due,Weekly Set-Aside ($),One-Off Catch-Up Needed ($)',
    )
    expect(csv).toContain('Rent,400.00,Weekly,2026-11-19,0,400.00,400.00')
    expect(csv).toContain('Internet,75.00,Monthly,2026-11-27,1,17.31,57.69')
  })

  test('deletes the whole plan after confirmation', async ({ app, page }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      due: '2026-11-19',
    })

    await page.getByRole('button', { name: 'Delete plan' }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByText('This removes all 1 expense from this browser.'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete plan' }).click()

    await expect(page.getByText('No expenses yet')).toBeVisible()
    await page.reload()
    await app.expectDashboard()
    await app.openPlan()
    await expect(page.getByText('No expenses yet')).toBeVisible()
  })

  test('keeps the plan across sign out and back in', async ({ app }) => {
    await openPlan(app)
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      due: '2026-11-19',
    })

    await app.signOut()
    await app.expectLogin()
    await app.login()
    await app.expectDashboard()
    await app.openPlan()

    await expect(app.planRow('Rent')).toBeVisible()
  })

  test('opens the set-aside plan from the week view on mobile', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await app.login()
    await app.expectDashboard()

    await expect(page.locator('#week-section')).toBeVisible()
    await page.getByRole('button', { name: 'Set-aside plan', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Set-aside plan' })).toBeVisible()
  })
})
