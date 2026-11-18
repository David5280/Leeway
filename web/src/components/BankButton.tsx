// Connecting or repairing a bank through Plaid's own window.

import { useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { call } from '../api/client'
import { useActionMutation } from '../api/hooks'
import { ErrorNote } from './ui'

/** Opens Plaid's window as soon as it has loaded, and reports how it went. */
function PlaidWindow({
  token,
  onSuccess,
  onExit,
}: {
  token: string
  onSuccess: (publicToken: string) => void
  onExit: () => void
}) {
  const { open, ready } = usePlaidLink({
    token,
    // Plaid can finish without a token; treat that like closing the window so the button frees up.
    onSuccess: (publicToken) => (publicToken ? onSuccess(publicToken) : onExit()),
    onExit: () => onExit(),
  })
  useEffect(() => {
    if (ready) open()
  }, [ready, open])
  return null
}

/**
 * Connects a bank, or repairs one whose login expired (pass connectionId).
 * The bank window comes from Plaid; Leeway only sees the token it hands back.
 */
export function BankButton({
  connectionId,
  label = 'Connect a bank',
  className = 'btn primary',
  onDone,
}: {
  connectionId?: string
  label?: string
  className?: string
  onDone?: () => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [starting, setStarting] = useState(false)
  const link = useActionMutation('link_bank')
  const repaired = useActionMutation('bank_reconnected')
  const busy = starting || token !== null || link.isPending || repaired.isPending

  async function start() {
    setError(null)
    setStarting(true)
    try {
      setToken((await call('create_link_token', { connectionId })).linkToken)
    } catch (caught) {
      setError(caught)
    } finally {
      setStarting(false)
    }
  }

  async function finish(publicToken: string) {
    setToken(null)
    try {
      if (connectionId) await repaired.mutateAsync({ connectionId })
      else await link.mutateAsync({ publicToken })
      onDone?.()
    } catch (caught) {
      setError(caught)
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void start()}>
        {link.isPending || repaired.isPending ? 'Pulling in your accounts' : label}
      </button>
      {token && (
        <PlaidWindow
          token={token}
          onSuccess={(t) => void finish(t)}
          onExit={() => setToken(null)}
        />
      )}
      <ErrorNote error={error} />
    </>
  )
}
