import { readFile } from 'node:fs/promises'
import { test, expect } from '../fixtures'
import type { AppPage } from '../pages/AppPage'

async function openSpending(app: AppPage): Promise<void> {
  await app.login()
  await app.expectDashboard()
  await app.selectAccount()
  await app.expectTransaction('Coffee')
}

test.describe('transactions', () => {
  test('renders accounts, balances and transactions', async ({ app, page }) => {
    await app.login()
    await app.expectDashboard()

    await expect(page.getByText('1,234.56')).toBeVisible()
    await app.selectAccount()
    await app.expectTransaction('Coffee')
    await app.expectTransaction('Weekly shop')
    await expect(page.getByText('Eating out').first()).toBeVisible()
  })

  test('loads page 2 with an opaque cursor', async ({ app, api }) => {
    await openSpending(app)

    await app.loadMore()

    await app.expectTransaction('Older coffee')
    await expect(app.page.getByRole('button', { name: 'Load more' })).toHaveCount(0)
    expect(
      api.transactionRequests.some((url) => url.searchParams.get('page[after]') === 'cursor-2'),
    ).toBe(true)
  })

  test('manual refresh keeps loaded pages', async ({ app, api }) => {
    await openSpending(app)
    await app.loadMore()
    await app.expectTransaction('Older coffee')
    const before = api.accountsRequests

    await app.refresh()

    await app.expectTransaction('Older coffee')
    expect(api.accountsRequests).toBeGreaterThan(before)
    expect(
      api.transactionRequests.filter((url) => url.searchParams.get('page[after]') === 'cursor-2')
        .length,
    ).toBeGreaterThan(1)
  })

  test('filters by status and clears back to all', async ({ app, api }) => {
    await openSpending(app)

    await app.setStatusFilter('HELD')
    await app.applyFilter()

    await app.expectTransaction('Pending coffee')
    await expect(app.transaction('Coffee')).toHaveCount(0)
    expect(api.transactionRequests.at(-1)?.searchParams.get('filter[status]')).toBe('HELD')

    await app.clearFilters()
    await app.expectTransaction('Coffee')
  })

  test('sends the selected date range to Up', async ({ app, api }) => {
    await openSpending(app)

    await app.setDateRange('2026-11-01', '2026-11-30')
    await app.applyFilter()

    await expect
      .poll(() => api.transactionRequests.at(-1)?.searchParams.get('filter[since]'))
      .toBe('2026-11-01')
    expect(api.transactionRequests.at(-1)?.searchParams.get('filter[until]')).toBe(
      '2026-11-30',
    )
  })

  test('opens and closes the transaction detail panel', async ({ app }) => {
    await openSpending(app)

    await app.openTransaction('Coffee')

    await app.expectDetailPanel('Morning coffee')
    await app.expectDetailPanel('Eating out')
    await app.expectDetailPanel('Holiday')
    await app.expectDetailPanel('Paid on')
    await app.closeDetailPanel()
  })

  test('exports a CSV with escaped formulas and a safe filename', async ({ app }) => {
    await openSpending(app)

    const download = await app.exportCsv()
    expect(download.suggestedFilename()).toBe('Spending-transactions.csv')
    const path = await download.path()
    expect(path).toBeTruthy()
    const csv = await readFile(path!, 'utf8')

    expect(csv.startsWith('Date,Settled At,Status,Description,Amount,Currency')).toBe(true)
    expect(csv).toContain('Coffee')
    expect(csv).toContain('Older coffee')
    expect(csv).toContain("'=SUM(A1)")
    expect(csv).toContain('\r\n')
  })

  test('shows a toast when balances cannot be refreshed', async ({ app, api, page }) => {
    await openSpending(app)
    api.failAccounts = true

    await app.page.getByRole('button', { name: 'Refresh' }).click()

    await expect(page.getByText('Refresh failed')).toBeVisible()
    await app.expectTransaction('Coffee')
  })

  test('shows an inline error when the next page fails', async ({ app, api, page }) => {
    await openSpending(app)
    api.failNextPage = true

    await app.loadMore()

    await expect(page.getByText('Could not load more transactions')).toBeVisible()
    await expect(page.getByText('Could not load the next page.')).toBeVisible()
    await expect(app.transaction('Older coffee')).toHaveCount(0)
  })
})
