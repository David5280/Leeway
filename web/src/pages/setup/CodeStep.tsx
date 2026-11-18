// Step 1: the setup code, checked on its own before anything else is asked.

import { useState, type FormEvent } from 'react'
import { auth, type Status } from '../../api/client'
import { ErrorNote } from '../../components/ui'
import { Frame, Nav } from './Frame'
import { WhereIsTheCode } from './WhereIsTheCode'

export function CodeStep({
  status,
  code,
  onChange,
  onNext,
  rejected,
}: {
  status: Status
  code: string
  onChange: (code: string) => void
  onNext: () => void
  /** Why the code was turned down on a later step, as when Leeway restarted with a new one. */
  rejected?: unknown
}) {
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.checkSetupCode(code)
      onNext()
    } catch (caught) {
      setError(caught)
      setBusy(false)
    }
  }

  return (
    <Frame step={1}>
      <form className="stack" onSubmit={submit}>
        <h1>Enter your setup code</h1>
        <p className="muted">
          This Leeway is brand new. The setup code proves it is yours, so nobody else who finds its
          address can claim it. You need it only this once.
        </p>
        {/* The code proves whoever makes the account runs this server (see lib/setupCode.ts). */}
        <label className="field">
          Setup code
          <input
            className="input num"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            aria-describedby="setup-code-help"
            value={code}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <WhereIsTheCode
          id="setup-code-help"
          platform={status.platform}
          from={status.setupCodeFrom ?? 'log'}
        />
        <ErrorNote error={error ?? rejected} />
        <Nav next="Continue" busy={busy} busyLabel="Checking" />
      </form>
    </Frame>
  )
}
