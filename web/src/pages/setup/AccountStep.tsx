// Step 1: making the owner's account, which also signs them in.

import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { auth } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { Frame, Nav } from './Frame'

export function AccountStep() {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.setup({ email, password, name: name.trim() || undefined })
      await client.invalidateQueries()
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  return (
    <Frame step={1}>
      <form className="stack" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">
          This copy of Leeway is yours. Your bank data stays in your own database, and nobody else
          can sign in.
        </p>
        <label className="field">
          Name
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
        <label className="field">
          Password, at least 10 characters
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <ErrorNote error={error} />
        <Nav next="Continue" busy={busy} />
      </form>
    </Frame>
  )
}
