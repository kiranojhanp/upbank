import { test, expect } from '../fixtures'
import { VALID_TOKEN } from '../support/up-api'

test.describe('authentication', () => {
  test('signs in with a valid token and keeps it out of the DOM', async ({ app, page }) => {
    await app.login()

    await app.expectDashboard()
    expect(await app.storedToken()).toBe(VALID_TOKEN)
    await expect(page.locator('body')).not.toContainText(VALID_TOKEN)
  })

  test('restores the session after a reload', async ({ app, page }) => {
    await app.login()
    await app.expectDashboard()

    await page.reload()

    await app.expectDashboard()
    expect(await app.storedToken()).toBe(VALID_TOKEN)
  })

  test('rejects an invalid token without storing it', async ({ app, api, page }) => {
    api.rejectAllPings = true

    await app.login('pat-wrong')

    await expect(
      page.getByText('Invalid access token. Please check and try again.'),
    ).toBeVisible()
    await app.expectLogin()
    expect(await app.storedToken()).toBeNull()
  })

  test('rejects whitespace before making a network request', async ({ app, api, page }) => {
    await app.login('pat with spaces')

    await expect(
      page.getByText('Access token must not contain spaces or line breaks'),
    ).toBeVisible()
    await app.expectLogin()
    expect(
      api.requests.filter((url) => url.pathname === '/api/v1/util/ping'),
    ).toHaveLength(0)
  })

  test('sign out clears the token and cached metadata', async ({ app }) => {
    await app.login()
    await app.expectDashboard()
    await app.selectAccount()
    await app.expectTransaction('Coffee')
    await app.waitForOfflineData()

    await app.signOut()

    await app.expectLogin()
    await app.waitForTokenCleared()
  })
})
