import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

const HEADER = 'Expense Name\tBilled Amount ($)\tFrequency\tNext Due Date'

async function openWeek(app: AppPage) {
  await app.freezeToday('2026-11-05T02:00:00.000Z')
  await app.login()
  await app.expectDashboard()
  await expect(app.page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
}

test.describe('weekly budget', () => {
  test('starts a Wednesday-to-Tuesday week and attaches a transaction', async ({
    app,
    page,
  }) => {
    await openWeek(app)

    await expect(page.getByText('No budget entries for this week.')).toBeVisible()
    await app.addWeekEntry({ name: 'Groceries', amount: '100.00' })

    await expect(app.weekEntry('Groceries')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Groceries' })).toBeVisible()
    await expect(app.weekTransaction('Coffee')).toBeVisible()
    await expect(app.weekTransaction('Weekly shop')).toBeVisible()
    await expect(page.getByText('Salary')).toHaveCount(0)

    await app.weekTransaction('Coffee').click()

    await expect(page.locator('.week-tx.is-attached').filter({ hasText: 'Coffee' })).toBeVisible()
    await expect(app.weekEntry('Groceries')).toContainText('$94.50 left')
    await expect(app.weekStat('left')).toContainText('$46.40')
    await expect(app.weekStat('unassigned')).toContainText('2 · $48.10')

    await page.reload()
    await app.expectDashboard()

    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
    await expect(app.weekEntry('Groceries')).toContainText('$94.50 left')
    await expect(page.locator('.week-tx.is-attached').filter({ hasText: 'Coffee' })).toBeVisible()
  })

  test('seeds entries from the set-aside plan and can move an attachment', async ({
    app,
    page,
  }) => {
    await openWeek(app)
    await app.openPlan()
    await app.importPlan(
      [
        HEADER,
        'Rent\t400.00\tWeekly\t2026-11-19',
        'Groceries\t100.00\tWeekly\t2026-11-05',
        'Internet\t75.00\tMonthly\t2026-11-27',
      ].join('\n'),
    )
    await app.openWeek()
    await app.dismissToasts()

    await expect(app.weekEntry('Rent')).toContainText('$400.00 planned')
    await expect(app.weekEntry('Groceries')).toContainText('$100.00 planned')
    await expect(app.weekEntry('Internet')).toContainText('$17.31 planned')
    await expect(page.getByRole('heading', { name: 'Rent' })).toBeVisible()

    await app.weekTransaction('Coffee').click()
    await expect(app.weekEntry('Rent')).toContainText('1 tx · $5.50')

    await app.weekEntry('Groceries').click()
    await expect(page.getByRole('heading', { name: 'Groceries' })).toBeVisible()
    await expect(app.weekTransaction('Coffee')).toContainText('Rent')
    await app.weekTransaction('Coffee').click()

    await expect(app.weekEntry('Groceries')).toContainText('1 tx · $5.50')
    await expect(app.weekEntry('Rent')).toContainText('Nothing attached')
    await expect(app.weekStat('planned')).toContainText('$517.31')
    await expect(app.weekStat('left')).toContainText('$463.71')
  })

  test('edits an entry, shows overspend and deletes it with its attachments', async ({
    app,
    page,
  }) => {
    await openWeek(app)
    await app.addWeekEntry({ name: 'Groceries', amount: '100.00' })
    await app.weekTransaction('Coffee').click()
    await expect(app.weekEntry('Groceries')).toContainText('$94.50 left')

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Planned for this week').fill('5.00')
    await dialog.getByRole('button', { name: 'Save changes' }).click()

    await expect(app.weekEntry('Groceries')).toContainText('$0.50 over')
    await expect(app.weekStat('left')).toContainText('-$48.60')

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete entry' }).click()
    await expect(dialog.getByText('1 attached transaction will be unassigned.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Yes, delete' }).click()

    await expect(page.getByText('No budget entries for this week.')).toBeVisible()
    await expect(app.weekStat('unassigned')).toContainText('3 · $53.60')
    await expect(app.weekStat('left')).toContainText('-$53.60')
  })

  test('navigates previous, next and back to this week', async ({ app, page }) => {
    await openWeek(app)

    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 28 Oct – Tue 3 Nov 2026')

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 11 – Tue 17 Nov 2026')

    await page.getByRole('button', { name: 'This week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
  })

  test('works in a narrow viewport without horizontal overflow', async ({ app, page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWeek(app)

    await expect(page.locator('#week-section')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Set-aside plan', exact: true })).toBeVisible()

    await app.addWeekEntry({ name: 'Groceries', amount: '100.00' })
    await app.weekEntry('Groceries').click()
    await app.weekTransaction('Coffee').click()
    await expect(page.locator('.week-tx.is-attached').filter({ hasText: 'Coffee' })).toBeVisible()

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(noOverflow).toBe(true)
  })
})
