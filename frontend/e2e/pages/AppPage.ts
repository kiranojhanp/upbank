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

  async dismissToasts(): Promise<void> {
    const toasts = this.page.locator('#toast-container .toast')
    for (let guard = 0; guard < 10 && (await toasts.count()) > 0; guard += 1) {
      await toasts.first().click({ force: true })
    }
  }

  async openWeek(): Promise<void> {
    await this.page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(this.page.locator('#week-section')).toBeVisible()
  }

  async openBackup(): Promise<void> {
    await this.page.getByRole('button', { name: 'Backup data', exact: true }).click()
    const dialog = this.page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'Backup & restore', exact: true }),
    ).toBeVisible()
  }

  async openPlan(): Promise<void> {
    await this.page.getByRole('button', { name: 'Week', exact: true }).click()
    await this.page.getByRole('button', { name: 'Recurring expenses', exact: true }).click()
    await expect(this.page.getByRole('heading', { name: 'Recurring expenses', exact: true })).toBeVisible()
  }

  weekEntry(name: string): Locator {
    return this.page.locator('.week-entry').filter({ hasText: name })
  }

  /** Open the Spending account once so its transactions are in the local cache. */
  async cacheTransactions(accountName = 'Spending'): Promise<void> {
    await this.selectAccount(accountName)
    await this.expectTransaction('Coffee')
    await this.waitForOfflineData()
    await this.openWeek()
  }

  async selectPaidAccount(name = 'Spending'): Promise<void> {
    const dialog = this.page.getByRole('dialog')
    await dialog.getByLabel('Up account').selectOption({ label: name })
  }

  weekStat(stat: 'due' | 'paid' | 'setaside'): Locator {
    return this.page.locator(`[data-week-stat="${stat}"]`)
  }

  weekTransaction(description: string): Locator {
    const escaped = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return this.page.locator('.week-tx-button').filter({
      has: this.page.locator('.week-tx-desc', {
        hasText: new RegExp(`^${escaped}$`),
      }),
    })
  }

  /** Pin the browser clock so weeks-until-due is deterministic. */
  async freezeToday(iso = '2026-11-16T02:00:00.000Z'): Promise<void> {
    await this.page.clock.setFixedTime(new Date(iso))
  }

  planStat(stat: 'weekly' | 'seed' | 'fortnightly' | 'annual'): Locator {
    return this.page.locator(`[data-stat="${stat}"]`)
  }

  planRow(name: string): Locator {
    return this.page.locator('.plan-expense-row').filter({ hasText: name })
  }

  async addExpense(expense: {
    name: string
    amount: string
    frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUALLY' | 'ANNUALLY'
    start: string
  }): Promise<void> {
    await this.page.getByRole('button', { name: 'Add expense', exact: true }).click()
    const dialog = this.page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Expense name').fill(expense.name)
    await dialog.getByLabel('Billed amount').fill(expense.amount)
    await dialog.getByLabel('Frequency').selectOption(expense.frequency)
    await dialog.getByLabel('Start date').fill(expense.start)
    await dialog.getByRole('button', { name: 'Add expense' }).click()
    await expect(dialog).toHaveCount(0)
  }

  async importPlan(text: string, mode?: 'append' | 'replace'): Promise<void> {
    await this.page.getByRole('button', { name: 'Import', exact: true }).click()
    const dialog = this.page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Paste expenses').fill(text)
    if (mode === 'append') await dialog.getByLabel('Add to plan').check()
    if (mode === 'replace') await dialog.getByLabel('Replace plan').check()
    await dialog.getByRole('button', { name: /^Import \d+ expense/ }).click()
    await expect(dialog).toHaveCount(0)
  }

  async exportPlanCsv(): Promise<Download> {
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
