import { test, expect } from '../fixtures'

test.describe('settings', () => {
  test('changes and persists the week start day', async ({ app, page }) => {
    await app.freezeToday('2026-11-05T02:00:00.000Z')
    await app.login()
    await app.expectDashboard()

    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
    await expect(refresh).toBeVisible()
    await expect
      .poll(() => refresh.getAttribute('data-tooltip'))
      .toMatch(/^Refresh · (last synced|not synced yet)/)

    await app.openSettings()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Week starts on').selectOption({ label: 'Monday' })
    await expect(dialog.getByText('Mon 2 – Sun 8 Nov 2026')).toBeVisible()
    await app.saveSettings()

    await expect(page.locator('#week-title')).toContainText('Mon 2 – Sun 8 Nov 2026')
    await expect(page.locator('.week-day').first()).toContainText('Mon')

    await page.reload()
    await app.expectDashboard()
    await expect(page.locator('#week-title')).toContainText('Mon 2 – Sun 8 Nov 2026')

    await app.openSettings()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Week starts on').selectOption({ label: 'Sunday' })
    await app.saveSettings()
    await expect(page.locator('#week-title')).toContainText('Sun 1 – Sat 7 Nov 2026')

    await app.openSettings()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Reset to Wednesday' }).click()
    await app.saveSettings()
    await expect(page.locator('#week-title')).toContainText('Wed 4 – Tue 10 Nov 2026')
  })
})
