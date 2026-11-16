import { test, expect } from '../fixtures'
import { VALID_TOKEN } from '../support/up-api'

test.describe('security invariants', () => {
  test('ships a strict CSP and never renders the token', async ({ app, page }) => {
    await app.login()
    await app.expectDashboard()

    const csp = await app.cspMeta().getAttribute('content')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain("script-src-attr 'none'")
    expect(csp).toContain("connect-src 'self' https://api.up.com.au")
    expect(csp).toContain("object-src 'none'")
    const scriptDirective = (csp ?? '')
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('script-src '))
    expect(scriptDirective).toBeTruthy()
    expect(scriptDirective).not.toContain("'unsafe-inline'")
    await expect(page.locator('body')).not.toContainText(VALID_TOKEN)
  })

  test('only talks to the app origin and the Up API', async ({ app, page }) => {
    const appOrigin = new URL(page.url()).origin
    const allowed = new Set([appOrigin, 'https://api.up.com.au'])
    const external = new Set<string>()
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      if (!allowed.has(url.origin)) external.add(url.origin)
    })

    await app.login()
    await app.expectDashboard()
    await app.selectAccount()
    await app.expectTransaction('Coffee')

    const resourceOrigins = await page.evaluate(() =>
      [
        ...new Set(
          performance
            .getEntriesByType('resource')
            .map((entry) => new URL(entry.name).origin)
            .filter((origin) => origin.startsWith('http')),
        ),
      ],
    )
    expect(resourceOrigins.filter((origin) => !allowed.has(origin))).toEqual([])
    expect([...external]).toEqual([])
  })

  test('a 401 clears the token and cached metadata', async ({ app, api }) => {
    await app.login()
    await app.expectDashboard()
    await app.selectAccount()
    await app.expectTransaction('Coffee')
    await app.waitForOfflineData()

    api.unauthorized = true
    await app.page.getByRole('button', { name: 'Refresh' }).click()

    await app.expectLogin()
    await app.waitForTokenCleared()
  })
})
