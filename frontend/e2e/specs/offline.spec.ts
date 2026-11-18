import { test, expect } from '../fixtures'

test.describe('offline and service worker', () => {
  test('restores cached data, revalidates online, then loads the next page', async ({
    app,
    api,
    page,
    context,
  }) => {
    await app.login()
    await app.expectDashboard()
    await app.waitForServiceWorker()

    await app.selectAccount()
    await app.expectTransaction('Coffee')
    await app.waitForOfflineData()

    await context.setOffline(true)
    await page.reload()

    await app.expectDashboard()
    await app.selectAccount()
    await app.expectTransaction('Coffee')
    await app.expectOfflineNote()

    const beforeReconnect = api.transactionRequests.length
    await context.setOffline(false)
    // Reconnect revalidates the restored page; a fresh cursor is then safe.
    await expect.poll(() => api.transactionRequests.length).toBeGreaterThan(beforeReconnect)
    await expect(page.getByRole('button', { name: 'Load more' })).toBeEnabled()
    await app.loadMore()
    await app.expectTransaction('Older coffee')

    expect(
      api.transactionRequests.some(
        (url) => url.searchParams.get('page[after]') === 'cursor-2',
      ),
    ).toBe(true)
  })
})
