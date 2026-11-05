// Smoke tests for the offline-first cache decisions. Node has neither OPFS nor
// Web Workers, so the cache must degrade to null and let the store stay in
// memory. A fake localStorage also lets us exercise the "don't fetch when a
// cached copy exists" rule without a browser.
import { DbClient } from '@tanstack/react-db'
import { shouldFetchOnMount } from '../src/db'
import { readEnvelope, writeEnvelope, writeLastSynced, readLastSynced } from '../src/envelopeStore'
import { openLocalCache, SCHEMA_VERSION } from '../src/persistence'

let ok = true
function check(label: string, condition: boolean) {
  ok = ok && condition
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
}

class FakeStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
}

async function main() {
  console.log('schema version        :', SCHEMA_VERSION)

  const cache = await openLocalCache('smoke-user')
  check('no OPFS in node -> null', cache === null)
  check('repeat call stable', (await openLocalCache('smoke-user')) === null)

  Object.defineProperty(globalThis, 'localStorage', {
    value: new FakeStorage(),
    configurable: true,
    writable: true,
  })

  const noCacheClient = new DbClient({})
  check('no persistence -> always fetch', shouldFetchOnMount(noCacheClient, 'accounts'))

  const client = new DbClient({ persistence: {}, uid: 'user-a' })
  check('no stored envelope -> fetch', shouldFetchOnMount(client, 'accounts'))

  writeEnvelope('user-a', 'accounts', {
    rows: 0,
    nextPage: null,
    categoryMap: {},
    syncedAt: 1,
  })
  check('empty stored rows -> fetch', shouldFetchOnMount(client, 'accounts'))

  writeEnvelope('user-a', 'accounts', {
    rows: 3,
    nextPage: null,
    categoryMap: {},
    syncedAt: 2,
  })
  check('warm cache -> no fetch', shouldFetchOnMount(client, 'accounts') === false)

  const other = new DbClient({ persistence: {}, uid: 'user-b' })
  check('another user still fetches', shouldFetchOnMount(other, 'accounts'))

  writeLastSynced('user-a', 1234)
  check('last synced round-trips', readLastSynced('user-a') === 1234)

  const stored = readEnvelope('user-a', 'transactions:acct:all')
  check('missing envelope -> null', stored === null)

  console.log('\nRESULT:', ok ? 'ALL PASS' : 'FAILURES')
  if (!ok) process.exit(1)
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
