import { test, expect } from '../fixtures'

test.describe('offline and service worker', () => {
  test('restores cached accounts and transactions, then anchors load-more', async ({
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

    await context.setOffline(false)
    await expect(page.getByRole('button', { name: 'Load more' })).toBeEnabled()
    await app.loadMore()
    await app.expectTransaction('Older coffee')

    await expect.poll(() => api.anchorRequests.length).toBeGreaterThan(0)
    expect(api.anchorRequests.at(-1)?.searchParams.get('filter[until]')).toBe(
      '2026-11-02T09:00:00Z',
    )
  })
})
