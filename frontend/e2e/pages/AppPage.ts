import { expect, type Download, type Locator, type Page } from '@playwright/test'
import { VALID_TOKEN } from '../support/up-api'

/** Thin page object for the app shell and transaction workflow. */
export class AppPage {
  readonly page: Page
  readonly tokenInput: Locator

  constructor(page: Page) {
    this.page = page
    this.tokenInput = page.getByPlaceholder('Personal Access Token')
  }

  async goto(path = '/'): Promise<void> {
    await this.page.goto(path)
  }

  async login(token = VALID_TOKEN): Promise<void> {
    await this.tokenInput.fill(token)
    await this.page.getByRole('button', { name: 'Sign in to Up' }).click()
  }

  async expectLogin(): Promise<void> {
    await expect(this.tokenInput).toBeVisible()
    await expect(this.page.getByRole('button', { name: 'Sign in to Up' })).toBeVisible()
  }

  accountCard(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(name) })
  }

  async expectDashboard(): Promise<void> {
    await expect(this.accountCard('Spending')).toBeVisible()
    await expect(this.accountCard('Joint')).toBeVisible()
  }

  async selectAccount(name = 'Spending'): Promise<void> {
    await this.accountCard(name).click()
    await expect(this.page.getByRole('heading', { name })).toBeVisible()
  }

  transaction(description: string): Locator {
    return this.page.getByText(description, { exact: true })
  }

  async expectTransaction(description: string): Promise<void> {
    await expect(this.transaction(description)).toBeVisible()
  }

  async openTransaction(description: string): Promise<void> {
    await this.transaction(description).click()
  }

  detailPanel(): Locator {
    return this.page.locator('.slide-out-panel.open')
  }

  async expectDetailPanel(text: string): Promise<void> {
    await expect(this.detailPanel()).toBeVisible()
    await expect(this.detailPanel()).toContainText(text)
  }

  async closeDetailPanel(): Promise<void> {
    await this.page.mouse.click(8, 8)
    await expect(this.detailPanel()).toHaveCount(0)
  }

  async loadMore(): Promise<void> {
    await this.page.getByRole('button', { name: 'Load more' }).click()
  }

  async refresh(): Promise<void> {
    await this.page.getByRole('button', { name: 'Refresh' }).click()
    await expect(this.page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  }

  async signOut(): Promise<void> {
    await this.page.getByRole('button', { name: 'Sign out' }).click()
  }

  async setStatusFilter(value: 'HELD' | 'SETTLED' | ''): Promise<void> {
    await this.page.getByRole('combobox').selectOption(value)
  }

  async applyFilter(): Promise<void> {
    await this.page.getByRole('button', { name: 'Filter' }).click()
  }

  async clearFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Clear', exact: true }).click()
  }

  async setDateRange(from: string, until: string): Promise<void> {
    await this.page.getByTitle('From date').fill(from)
    await this.page.getByTitle('To date').fill(until)
  }

  async exportCsv(): Promise<Download> {
    const download = this.page.waitForEvent('download')
    await this.page.getByRole('button', { name: 'Export CSV' }).click()
    return download
  }

  async expectOfflineNote(): Promise<void> {
    await expect(
      this.page.getByText('Offline — showing saved transactions.'),
    ).toBeVisible()
  }

  cspMeta(): Locator {
    return this.page.locator('meta[http-equiv="Content-Security-Policy"]')
  }

  async storedToken(): Promise<string | null> {
    return this.page.evaluate(() => localStorage.getItem('up:token'))
  }

  async storedMetadataKeys(): Promise<string[]> {
    return this.page.evaluate(() => {
      const keys: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key?.startsWith('up:envelope:') || key?.startsWith('up:synced:')) {
          keys.push(key)
        }
      }
      return keys
    })
  }

  async waitForTokenCleared(): Promise<void> {
    await expect.poll(() => this.storedToken()).toBeNull()
    await expect.poll(() => this.storedMetadataKeys()).toEqual([])
  }

  async waitForServiceWorker(): Promise<void> {
    await this.page.evaluate(() => navigator.serviceWorker.ready)
    const controlled = await this.page.evaluate(() =>
      Boolean(navigator.serviceWorker.controller),
    )
    if (!controlled) {
      await this.page.reload()
      await this.expectDashboard()
      await expect
        .poll(() => this.page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
        .toBe(true)
    }
  }

  async waitForOfflineData(): Promise<void> {
    await expect
      .poll(
        () =>
          this.page.evaluate(async () => {
            const root = await navigator.storage.getDirectory()
            for await (const [name] of root.entries()) {
              if (name.startsWith('up-cache-')) return true
            }
            return false
          }),
        { timeout: 15_000 },
      )
      .toBe(true)

    await expect
      .poll(
        () =>
          this.page.evaluate(() => {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index)
              if (key?.startsWith('up:envelope:') && !key.endsWith(':accounts')) return true
            }
            return false
          }),
        { timeout: 15_000 },
      )
      .toBe(true)
  }
}
