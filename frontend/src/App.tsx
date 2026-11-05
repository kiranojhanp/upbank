import { DbProvider, useLiveQuery } from '@tanstack/react-db'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionExpiredError, api } from './api'
import { Dashboard } from './components/Dashboard'
import { Login } from './components/Login'
import { accountsDescriptor, createSessionClient, type SessionClient } from './db'
import { openLocalCache } from './persistence'
import { useOnlineStatus } from './useOnlineStatus'

// Mirrors the transaction fallback in Dashboard: if a cache is present but the
// collection never becomes ready, fetch rather than hang on "Loading".
const READY_FALLBACK_MS = 1500

type BootState =
  | { phase: 'booting' }
  | { phase: 'signed-out'; error: string | null }
  | { phase: 'ready'; client: SessionClient }

export default function App() {
  const [boot, setBoot] = useState<BootState>({ phase: 'booting' })
  const clientRef = useRef<SessionClient | null>(null)
  const bootRequest = useRef<Promise<void> | null>(null)

  // A fresh store per session. The cache is scoped to the uid the server
  // reports, so two Up accounts on one browser never share rows.
  const activate = useCallback(async (uid: string) => {
    const cache = await openLocalCache(uid)
    const client = createSessionClient(uid, cache)
    clientRef.current = client
    setBoot({ phase: 'ready', client })
  }, [])

  // Boot probe. It runs before any collection is materialised, so restored
  // rows can never render for a signed-out browser. StrictMode's second mount
  // reuses the same request instead of opening a second database.
  useEffect(() => {
    if (bootRequest.current) return
    bootRequest.current = (async () => {
      try {
        const session = await api.session()
        await activate(session.uid)
      } catch {
        setBoot({ phase: 'signed-out', error: null })
      }
    })()
  }, [activate])

  const endSession = useCallback(
    async (message: string | null, { wipe }: { wipe: boolean }) => {
      const client = clientRef.current
      clientRef.current = null
      setBoot({ phase: 'signed-out', error: message })
      if (!client) return
      // Let React unmount the dashboard before SQLite stops serving reads.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await client.dispose({ wipe })
    },
    [],
  )

  const handleSignedIn = useCallback(
    async (uid: string) => {
      await activate(uid)
    },
    [activate],
  )

  if (boot.phase === 'booting') {
    return (
      <div className="boot-screen">
        <p className="loading-text">Loading…</p>
      </div>
    )
  }

  if (boot.phase === 'signed-out') {
    return <Login initialError={boot.error} onSuccess={handleSignedIn} />
  }

  return (
    <DbProvider client={boot.client.db}>
      <Authenticated
        client={boot.client}
        onExpired={() =>
          void endSession('Your session has expired. Please log in again.', { wipe: false })
        }
        onUnavailable={() =>
          void endSession('Could not reach the server. Please try again.', { wipe: false })
        }
        onSignOut={() => void endSession(null, { wipe: true })}
      />
    </DbProvider>
  )
}

interface AuthenticatedProps {
  client: SessionClient
  onExpired: () => void
  onUnavailable: () => void
  onSignOut: () => void
}

function Authenticated({ client, onExpired, onUnavailable, onSignOut }: AuthenticatedProps) {
  const online = useOnlineStatus()
  const accountsCollection = useMemo(
    () => client.db.collection(accountsDescriptor),
    [client],
  )

  // The accounts collection doubles as the first authenticated request.
  const { data: accounts, status } = useLiveQuery({
    query: (q) => q.from({ accounts: accountsCollection }),
  })
  const hasAccounts = (accounts?.length ?? 0) > 0

  useEffect(
    () =>
      client.onError((error) => {
        if (error instanceof SessionExpiredError) onExpired()
      }),
    [client, onExpired],
  )

  useEffect(() => {
    if (status === 'error' && !hasAccounts) onUnavailable()
  }, [status, hasAccounts, onUnavailable])

  // Restored rows can arrive while the collection still reports loading, so
  // render on data rather than status alone.
  const pending = (status === 'loading' || status === 'idle') && !hasAccounts
  const failed = status === 'error' && !hasAccounts

  const kicked = useRef(false)
  useEffect(() => {
    if (!pending || !online || kicked.current) return
    const timer = window.setTimeout(() => {
      kicked.current = true
      void accountsCollection.utils.refetch().catch(() => {})
    }, READY_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [pending, online, accountsCollection])

  if (pending || failed) {
    return (
      <div className="boot-screen">
        <p className="loading-text">Loading…</p>
      </div>
    )
  }

  return <Dashboard uid={client.uid} onSessionExpired={onExpired} onSignOut={onSignOut} />
}
