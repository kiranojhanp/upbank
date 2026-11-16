import { test, expect } from '../fixtures'

test.describe('resilience and responsive layout', () => {
  test('shows an empty state for an account with no transactions', async ({ app, page }) => {
    await app.login()
    await app.expectDashboard()

    await app.selectAccount('Joint')

    await expect(page.getByText('No transactions found.')).toBeVisible()
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('opens accounts from the mobile drawer', async ({ app, page }) => {
      await app.login()
      await app.expectDashboard()

      await page.getByRole('button', { name: 'Open menu' }).click()
      await app.selectAccount()
      await app.expectTransaction('Coffee')
    })
  })
})
