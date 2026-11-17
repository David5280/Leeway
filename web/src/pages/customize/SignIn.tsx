// Changing the password and signing out.

import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { auth } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { Section } from './Section'

export function SignInSection() {
  const client = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function change(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(false)
    try {
      await auth.changePassword({ currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setDone(true)
    } catch (caught) {
      setError(caught)
    }
  }

  async function signOut() {
    setError(null)
    try {
      await auth.logout()
    } catch (caught) {
      setError(caught)
      return
    }
    // Drop everything cached for this owner, then refetch so the app lands on sign-in.
    client.clear()
    await client.invalidateQueries()
  }

  return (
    <Section id="account" title="Sign-in">
      <form className="row wrap" onSubmit={change} aria-label="Change password">
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          aria-label="Current password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="New password, 10 or more characters"
          aria-label="New password"
          minLength={10}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button type="submit" className="btn">
          Change password
        </button>
      </form>
      {done && <p className="small good">Password changed. Other devices are signed out.</p>}
      <ErrorNote error={error} />
      <div>
        <button type="button" className="btn ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </Section>
  )
}
