import { readFile } from 'node:fs/promises'
import { test, expect } from '../fixtures'
import { VALID_TOKEN } from '../support/up-api'

test.describe('backup and restore', () => {
  test('exports the plan and paid history, without the token, and restores them', async ({
    app,
    page,
  }) => {
    await app.freezeToday('2026-11-05T02:00:00.000Z')
    await app.login()
    await app.expectDashboard()
    await app.cacheTransactions()

    await app.openPlan()
    await app.addExpense({
      name: 'Rent',
      amount: '400.00',
      frequency: 'WEEKLY',
      start: '2026-11-05',
    })
    await app.openWeek()

    await app.weekEntry('Rent').click()
    await page.getByRole('button', { name: 'Mark paid', exact: true }).click()
    const paidDialog = page.getByRole('dialog')
    await app.selectPaidAccount('Spending')
    await app.weekTransaction('Rent payment').click()
    await paidDialog.getByRole('button', { name: 'Mark paid' }).click()
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')

    await app.openBackup()
    const backupDialog = page.getByRole('dialog')
    const downloadPromise = page.waitForEvent('download')
    await backupDialog.getByRole('button', { name: 'Download backup' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('unofficial-up-backup-2026-11-05.json')

    const path = await download.path()
    expect(path).not.toBeNull()
    const json = await readFile(path as string, 'utf8')
    const backup = JSON.parse(json) as {
      format: string
      version: number
      plan: { rows: unknown[] }
      paid: { paid: Record<string, unknown> }
    }
    expect(backup.format).toBe('unofficial-up-backup')
    expect(backup.version).toBe(1)
    expect(backup.plan.rows).toHaveLength(1)
    expect(Object.keys(backup.paid.paid)).toHaveLength(1)
    expect(json).not.toContain(VALID_TOKEN)
    expect(json.toLowerCase()).not.toContain('"token"')
    expect(json).not.toContain('"description"')

    await backupDialog.getByRole('button', { name: 'Close dialog' }).click()

    // Simulate opening the app in a different browser: no local token, plan or
    // paid history, then sign back in with the same Up token.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await app.expectLogin()
    await app.login()
    await app.expectDashboard()
    await expect(page.getByText('Nothing due this week.', { exact: true })).toBeVisible()

    await app.openBackup()
    const importDialog = page.getByRole('dialog')
    await importDialog.locator('input[type=file]').setInputFiles(path as string)
    await expect(
      importDialog.getByText('1 recurring expense · 1 paid occurrence'),
    ).toBeVisible()

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      importDialog.getByRole('button', { name: 'Import backup' }).click(),
    ])

    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
    await expect(app.weekStat('paid')).toContainText('1 · $400.00')
    await expect(app.weekEntry('Rent')).toHaveCount(0)

    await app.openPlan()
    await expect(app.planRow('Rent')).toBeVisible()
  })
})
