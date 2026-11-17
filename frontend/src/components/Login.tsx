import { useEffect, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { ApiError, api } from '../api'
import { MAX_TOKEN_LENGTH, tokenInputError } from '../security'
import { UpLogo } from './UpLogo'

interface LoginProps {
  initialError?: string | null
  onSuccess: (uid: string) => Promise<void> | void
}

export function Login({ initialError, onSuccess }: LoginProps) {
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [loading, setLoading] = useState(false)

  const form = useForm({
    defaultValues: { accessToken: '' },
    validators: {
      onSubmit: ({ value }) => tokenInputError(value.accessToken.trim()),
    },
    onSubmit: async ({ value }) => {
      setLoading(true)
      setError(null)
      try {
        const { uid } = await api.login(value.accessToken.trim())
        // Do not keep the secret in component state after it has been stored.
        form.reset()
        await onSuccess(uid)
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not sign in')
      } finally {
        setLoading(false)
      }
    },
  })

  useEffect(() => {
    document.body.classList.add('login-page')
    return () => document.body.classList.remove('login-page')
  }, [])

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

        <form
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
          className="login-form"
        >
          <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
            {(submitError) =>
              error || submitError ? (
                <div className="login-error">{error ?? String(submitError)}</div>
              ) : null
            }
          </form.Subscribe>

          {/* Do not let a password manager offer the Up account password here:
              the app needs a personal access token, not a login. */}
          <form.Field name="accessToken">
            {(field) => (
              <input
                type="password"
                name={field.name}
                placeholder="Personal Access Token"
                required
                className="token-input"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={MAX_TOKEN_LENGTH}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  setError(null)
                  field.handleChange(event.target.value)
                }}
                disabled={loading}
              />
            )}
          </form.Field>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in to Up'}
          </button>
        </form>
      </div>
    </>
  )
}
