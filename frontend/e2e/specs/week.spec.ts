import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

async function startWeek(app: AppPage, iso = '2026-11-05T02:00:00.000Z') {
  await app.freezeToday(iso)
  await app.login()
  await app.expectDashboard()
}

test.describe('weekly recurring expenses', () => {
  test('marks a weekly expense paid with a transaction and reappears next week', async ({
    app,
    page,
  }) => {
    await startWeek(app)
    await app.openPlan()
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-05',
    })
    await app.openWeek()

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
    await expect(app.weekTransaction('Coffee')).toBeVisible()
    await expect(app.weekTransaction('Weekly shop')).toBeVisible()
    await expect(dialog.getByText('Salary')).toHaveCount(0)

    await app.weekTransaction('Coffee').click()
    await expect(dialog.getByRole('button', { name: 'Mark paid' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.week-entry-list')).toHaveCount(0)
    await expect(page.getByText(/All done for this week/)).toBeVisible()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekStat('due')).toContainText('$0.00')

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(page.locator('#week-title')).toContainText('Wed 11 – Tue 17 Nov 2026')
    await expect(app.weekEntry('Rent')).toBeVisible()
    await expect(app.weekStat('due')).toContainText('$400.00')

    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await page.reload()
    await app.expectDashboard()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekEntry('Rent')).toHaveCount(0)
  })

  test('only shows a monthly expense in its due week and hides it after payment', async ({
    app,
    page,
  }) => {
    await startWeek(app, '2026-11-26T02:00:00.000Z')
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
    await app.weekTransaction('Internet payment').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await expect(app.weekStat('paid')).toContainText('1 · $75.00')
    await expect(app.weekEntry('Internet')).toHaveCount(0)

    await page.getByRole('button', { name: 'Next week' }).click()
    await expect(app.weekEntry('Internet')).toHaveCount(0)
    await expect(page.getByText('Nothing due this week.', { exact: true })).toBeVisible()
  })

  test('does not let one transaction pay two expenses', async ({ app, page }) => {
    await startWeek(app)
    await app.openPlan()
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-05',
    })
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
    await app.weekTransaction('Coffee').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()

    await app.weekEntry('Fuel').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const secondDialog = page.getByRole('dialog')
    await expect(secondDialog.getByText('Used for Rent')).toBeVisible()
    await expect(app.weekTransaction('Coffee')).toBeDisabled()

    await app.weekTransaction('Weekly shop').click()
    await secondDialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('2 · $520.00')
    await expect(page.getByText(/All done for this week/)).toBeVisible()
  })

  test('navigates previous, next and back to this week', async ({ app, page }) => {
    await startWeek(app)

    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
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
    await startWeek(app)
    await app.openPlan()
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-05',
    })
    await app.openWeek()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('#week-section')).toBeVisible()
    await expect(app.weekEntry('Rent')).toBeVisible()

    await app.weekEntry('Rent').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await app.weekTransaction('Coffee').click()
    await dialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')

    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )
    expect(noOverflow).toBe(true)
  })
})
