// Smoke test for the local-only row mirror in src/db.ts. Transactions are
// fetched by useInfiniteQuery; this collection only stores rows for offline
// rendering, so the test covers insert/delete, live ordering and teardown.
import {
  DbClient,
  collectionOptions,
  createLiveQueryCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const ids = (collection) => collection.toArray.map((row) => row.id).join(',') || '(empty)'

const db = new DbClient({})
const id = 'transactions:acct:filter'
const descriptor = collectionOptions(id, () =>
  localOnlyCollectionOptions({ id, getKey: (transaction) => transaction.id }),
)

const collection = db.collection(descriptor)
await collection.preload()

await collection.insert([
  { id: 't2', attributes: { createdAt: '2026-11-01T10:00:00Z' } },
  { id: 't1', attributes: { createdAt: '2026-11-03T10:00:00Z' } },
]).when('settled')

const live = createLiveQueryCollection((query) =>
  query.from({ tx: collection }).orderBy(({ tx }) => tx.attributes.createdAt, 'desc'),
)
await live.preload()

console.log('1. inserted order -> desc             :', ids(live))

await collection.insert([
  { id: 't0', attributes: { createdAt: '2026-10-01T10:00:00Z' } },
]).when('settled')
await sleep(30)
console.log('2. after appending page 2             :', ids(live))

// A refetch replaces the page sequence, so rows no longer in it are deleted.
await collection.delete(['t2']).when('settled')
await sleep(30)
console.log('3. after deleting a stale row          :', ids(live), '| collection size', collection.size)

const keys = Array.from(collection.keys())
await collection.delete(keys).when('settled')
await sleep(30)
console.log('4. after clearing rows                 :', ids(live), '| collection size', collection.size)

live.cleanup()
console.log('5. live query cleaned up               :', true)

process.exit(0)
