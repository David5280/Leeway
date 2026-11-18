// Step 2: the owner's sign-in, which creates the account and signs them in.

import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../../../../server/src/lib/passwordRules'
import { ApiError, auth } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { Frame, Nav } from './Frame'

/** How many more characters the password needs, as a hint under the field. */
export function passwordHint(password: string): string {
  const missing = MIN_PASSWORD_LENGTH - password.length
  if (missing <= 0) return 'Long enough.'
  if (missing === MIN_PASSWORD_LENGTH) {
    return `At least ${MIN_PASSWORD_LENGTH} characters. A few random words work well.`
  }
  return `${missing} more ${missing === 1 ? 'character' : 'characters'} to go.`
}

export function AccountStep({
  setupCode,
  onBack,
  onCodeRejected,
}: {
  setupCode: string
  onBack: () => void
  /** Sends the owner back to the code step, as when Leeway restarted and made a new code. */
  onCodeRejected: (error: ApiError) => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Said here in a sentence, rather than by the browser's own bubble.
    const problem = passwordProblem(password)
    if (problem) {
      setError(new Error(`${problem}.`))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.setup({ email, password, name: name.trim() || undefined, setupCode })
      await client.invalidateQueries()
    } catch (caught) {
      // 403 is the server refusing the code itself; anything else is about this step.
      if (caught instanceof ApiError && caught.status === 403) {
        onCodeRejected(caught)
        return
      }
      setError(caught)
      setBusy(false)
    }
  }

  return (
    <Frame step={2}>
      <form className="stack" onSubmit={submit}>
        <h1>Create your sign-in</h1>
        <p className="muted">
          You will sign in to Leeway with this email and password. It is the only account this
          Leeway will ever have, and your data stays in your own database.
        </p>
        <label className="field">
          Your name (optional)
          <input
            className="input"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
        {/* A div, not a label around it all, so the field's name stays just "Password". */}
        <div className="field">
          <label htmlFor="new-password">Password</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span
            id="password-hint"
            className={`small ${passwordProblem(password) ? 'muted' : 'good'}`}
          >
            {passwordHint(password)}
          </span>
        </div>
        <ErrorNote error={error} />
        <Nav onBack={onBack} next="Create my account" busy={busy} busyLabel="Creating" />
      </form>
    </Frame>
  )
}
