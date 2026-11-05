import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '../api'
import { UpLogo } from './UpLogo'

interface LoginProps {
  initialError?: string | null
  onSuccess: (uid: string) => Promise<void> | void
}

export function Login({ initialError, onSuccess }: LoginProps) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.body.classList.add('login-page')
    return () => document.body.classList.remove('login-page')
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = token.trim()

    if (!value) {
      setError('Access token is required')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { uid } = await api.login(value)
      await onSuccess(uid)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="login-grain" />
      <div className="login-glow" />

      <div className="login-box">
        <div className="login-header">
          <div className="login-logo-mark">
            <UpLogo />
          </div>
          <div className="login-titles">
            <span className="login-title">
              Unofficial <em>Up</em>
            </span>
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="password"
            name="accessToken"
            placeholder="Personal Access Token"
            required
            className="token-input"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={loading}
          />
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in to Up'}
          </button>
        </form>
      </div>
    </>
  )
}
