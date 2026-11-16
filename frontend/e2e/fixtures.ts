import { test as base } from '@playwright/test'
import { AppPage } from './pages/AppPage'
import { MockUpApi } from './support/up-api'

interface AppFixtures {
  api: MockUpApi
  app: AppPage
}

/**
 * Every test gets a fresh API mock, browser context (so OPFS/localStorage are
 * isolated), and the app opened on the login screen.
 */
export const test = base.extend<AppFixtures>({
  api: async ({ page }, use) => {
    const api = new MockUpApi()
    await api.install(page)
    await use(api)
  },
  app: async ({ page, api: _api }, use) => {
    const app = new AppPage(page)
    await app.goto()
    await use(app)
  },
})

export { expect } from '@playwright/test'
