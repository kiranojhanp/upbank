// Throwaway smoke test for the TanStack DB wiring used by src/db.ts.
// Runs the real packages against a fake API, no React required.
import { DbClient, collectionOptions, createLiveQueryCollection } from '@tanstack/react-db'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ids = (collection) => collection.toArray.map((row) => row.id).join(',') || '(empty)'

const pages = {
  1: {
    transactions: [
      { id: 't2', attributes: { createdAt: '2026-11-01T10:00:00Z' } },
      { id: 't1', attributes: { createdAt: '2026-11-03T10:00:00Z' } },
    ],
    nextPage: 'cursor-2',
    categoryMap: { c1: 'Groceries' },
  },
  2: {
    transactions: [
      { id: 't0', attributes: { createdAt: '2026-10-01T10:00:00Z' } },
    ],
    nextPage: null,
  },
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
})
const db = new DbClient({ queryClient })

const id = 'transactions:acct:filter'
const descriptor = collectionOptions(id, (client) =>
  queryCollectionOptions({
    id,
    queryKey: ['transactions', 'acct'],
    queryClient: client.requireDependency('queryClient'),
    queryFn: async () => pages[1],
    select: (data) => data.transactions,
    getKey: (transaction) => transaction.id,
  }),
)

const collection = db.collection(descriptor)
await collection.preload()

const live = createLiveQueryCollection((q) =>
  q.from({ tx: collection }).orderBy(({ tx }) => tx.attributes.createdAt, 'desc'),
)
await live.preload()

console.log('1. server order t2,t1 -> orderBy desc:', ids(live))

// Page 2, appended the way "Load more" does it.
await collection.utils.writeUpsert(pages[2].transactions)
await sleep(30)
console.log('2. after writeUpsert (oldest last)    :', ids(live))

// A refetch must replace the whole collection with page 1 again, which is why
// the UI resets its cursor when the envelope changes.
await collection.utils.refetch()
await sleep(50)
console.log('3. after refetch (pages reset)        :', ids(live))
console.log('   envelope nextPage                  :', queryClient.getQueryData(['transactions', 'acct']).nextPage)

// Wipe path.
const keys = Array.from(collection.keys())
await collection.utils.writeDelete(keys)
await sleep(30)
console.log('4. after writeDelete                  :', ids(live), '| collection size', collection.size)

live.cleanup()
await queryClient.cancelQueries()
queryClient.clear()
await sleep(30)
console.log('5. after clear, cache                 :', queryClient.getQueryData(['transactions', 'acct']))
console.log('   collection rows                    :', collection.size)

process.exit(0)
