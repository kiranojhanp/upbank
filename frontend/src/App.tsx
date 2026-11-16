import { DbProvider, useLiveQuery } from '@tanstack/react-db'
import { QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionExpiredError, api } from './api'
import {
  TOKEN_STORAGE_KEY,
  clearToken,
  isFreshlyVerified,
  loadToken,
  markVerified,
  uidForToken,
} from './auth'
import { Dashboard } from './components/Dashboard'
import { Login } from './components/Login'
import { accountsDescriptor, createSessionClient, type SessionClient } from './db'
import { forgetUserData, openLocalCache } from './persistence'
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

  // A fresh store per session. The cache is scoped to the uid derived from the
  // token, so two Up accounts on one machine never share rows.
  const activate = useCallback(async (uid: string) => {
    const cache = await openLocalCache(uid)
    const client = createSessionClient(uid, cache)
    clientRef.current = client
    setBoot({ phase: 'ready', client })
  }, [])

  const endSession = useCallback(async (message: string | null, { wipe }: { wipe: boolean }) => {
    const client = clientRef.current
    clientRef.current = null
    setBoot({ phase: 'signed-out', error: message })
    if (!client) return
    // Let React unmount the dashboard before SQLite stops serving reads.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await client.dispose({ wipe })
  }, [])

  // Another tab signing in, signing out, or switching tokens must not leave
  // this tab holding an in-memory credential and an open cache. A reload tears
  // the whole session down and boots from whatever token is stored now.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== TOKEN_STORAGE_KEY) return
      window.location.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Boot from the locally stored token. There is no server session to ask, so
  // a token renders immediately (from cache) and is only re-checked against Up
  // once per verify window. A revoked token signs out before it can render
  // cached rows; an unreachable Up still boots offline.
  useEffect(() => {
    if (bootRequest.current) return
    bootRequest.current = (async () => {
      const token = loadToken()
      if (!token) {
        setBoot({ phase: 'signed-out', error: null })
        return
      }

      try {
        const uid = await uidForToken(token)

        if (!isFreshlyVerified()) {
          const status = await api.checkToken()
          if (status === 'invalid') {
            // The token is dead, so its rows can never be used again. Remove
            // both the credential and the cache instead of leaving banking
            // data on the device for a session that cannot be authenticated.
            clearToken()
            await forgetUserData(uid)
            setBoot({
              phase: 'signed-out',
              error: 'Your session has expired. Please log in again.',
            })
            return
          }
          if (status === 'valid') markVerified()
        }

        await activate(uid)
      } catch {
        setBoot({ phase: 'signed-out', error: null })
      }
    })()
  }, [activate])

  const handleSignedIn = useCallback(
    async (uid: string) => {
      await activate(uid)
    },
    [activate],
  )

  const handleExpired = useCallback(() => {
    // A 401/403 means the token is no longer valid. Clear it and wipe the
    // cache so a reload cannot restore the dashboard offline.
    clearToken()
    void endSession('Your session has expired. Please log in again.', { wipe: true })
  }, [endSession])

  const handleSignOut = useCallback(() => {
    clearToken()
    void endSession(null, { wipe: true })
  }, [endSession])

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
    <QueryClientProvider client={boot.client.queryClient}>
      <DbProvider client={boot.client.db}>
        <Authenticated client={boot.client} onExpired={handleExpired} onSignOut={handleSignOut} />
      </DbProvider>
    </QueryClientProvider>
  )
}

interface AuthenticatedProps {
  client: SessionClient
  onExpired: () => void
  onSignOut: () => void
}

function Authenticated({ client, onExpired, onSignOut }: AuthenticatedProps) {
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

  if (pending) {
    return (
      <div className="boot-screen">
        <p className="loading-text">Loading…</p>
      </div>
    )
  }

  if (failed) {
    // Do not bounce to the login screen: the token is still valid and the
    // cache may be usable, so a network failure must not look like a sign-out
    // (or leave the user thinking the device is locked when it is not).
    return (
      <div className="boot-screen">
        <p className="login-error">Could not reach Up. Check your connection and try again.</p>
        <button
          type="button"
          className="login-btn"
          onClick={async () => {
            try {
              await accountsCollection.utils.refetch()
            } catch {
              // The error state already explains the failure.
            }
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <Dashboard
      uid={client.uid}
      cacheAvailable={Boolean(client.cache)}
      onSessionExpired={onExpired}
      onSignOut={onSignOut}
    />
  )
}
