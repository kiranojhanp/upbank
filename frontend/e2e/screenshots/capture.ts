import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from '../fixtures'
import type { Page } from '@playwright/test'

/**
 * Captures the README screenshots with synthetic data only. Run from
 * `frontend/` with `npm run screenshots`; images land in `../docs/screenshots`.
 */
const SHOT_DIR = path.resolve(process.cwd(), '../docs/screenshots')

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  await page.screenshot({
    path: path.join(SHOT_DIR, name),
    animations: 'disabled',
    caret: 'hide',
  })
}

test('capture README screenshots with synthetic data', async ({ app, page }) => {
  test.setTimeout(120_000)
  await mkdir(SHOT_DIR, { recursive: true })

  await app.freezeToday('2026-11-05T02:00:00.000Z')
  await app.login()
  await app.expectDashboard()
  await app.cacheTransactions()

  await app.openPlan()
  const expenses = [
    { name: 'Rent', amount: '400.00', frequency: 'WEEKLY' as const, start: '2026-11-05' },
    { name: 'Fuel', amount: '120.00', frequency: 'WEEKLY' as const, start: '2026-11-05' },
    { name: 'Groceries', amount: '180.00', frequency: 'WEEKLY' as const, start: '2026-11-04' },
    { name: 'Gym', amount: '92.00', frequency: 'FORTNIGHTLY' as const, start: '2026-11-06' },
    { name: 'Internet', amount: '75.00', frequency: 'MONTHLY' as const, start: '2026-11-27' },
  ]
  for (const expense of expenses) await app.addExpense(expense)
  await app.dismissToasts()

  await app.openWeek()
  await app.weekEntry('Rent').click()
  await app.dismissToasts()
  await shot(page, 'week-due.png')

  await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await app.selectPaidAccount('Spending')
  await app.weekTransaction('Rent payment').click()
  await dialog.getByRole('button', { name: 'Mark paid' }).click()
  await app.dismissToasts()
  await shot(page, 'week-paid.png')

  await app.openPlan()
  await app.dismissToasts()
  await shot(page, 'plan.png')

  await app.openWeek()
  await app.weekEntry('Fuel').click()
  await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
  dialog = page.getByRole('dialog')
  await app.selectPaidAccount('Spending')
  await app.weekTransaction('Coffee').click()
  await shot(page, 'mark-paid.png')
  await dialog.getByRole('button', { name: 'Close dialog' }).click()

  await app.openSettings()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Week starts on').selectOption({ label: 'Monday' })
  await shot(page, 'settings.png')
  await dialog.getByRole('button', { name: 'Save settings' }).click()
  await app.dismissToasts()
  await shot(page, 'week-monday.png')

  await app.selectAccount('Spending')
  await app.expectTransaction('Coffee')
  await app.dismissToasts()
  await shot(page, 'accounts.png')

  await app.openWeek()
  await page.setViewportSize({ width: 390, height: 844 })
  await app.dismissToasts()
  await shot(page, 'week-mobile.png')
})
