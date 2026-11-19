// Sign-in for the owner.

import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { auth } from '../api/client'
import { AUTH_LOGO_SIZE, ErrorNote, Logo } from '../components/ui'

export function Login() {
  const client = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.login({ email, password })
      await client.invalidateQueries()
    } catch (caught) {
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth">
      <form className="card stack" onSubmit={submit} aria-label="Sign in">
        <div className="brand">
          <Logo size={AUTH_LOGO_SIZE} />
          leeway
        </div>
        <h1>Welcome back</h1>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote error={error} />
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>
        <p className="small muted">
          Forgot your password? Whoever runs this server can reset it with{' '}
          <code className="num">npm run reset-password</code>.
        </p>
      </form>
    </main>
  )
}
