// Reconnecting a bank that is already connected, through Plaid's update mode.

import { useState } from 'react'
import { call } from '../../api/client'
import { useActionMutation } from '../../api/hooks'
import { ErrorNote } from '../ui'
import { PlaidWindow } from './PlaidWindow'

/**
 * Opens Plaid's window for a login Leeway already has: to sign in again when
 * it broke, or, with `chooseAccounts`, to share accounts left out before.
 * Plaid keeps the same Item, so this never uses another of its connections,
 * and the bank keeps its history here.
 */
export function ReconnectButton({
  connectionId,
  chooseAccounts = false,
  label = 'Reconnect',
  className = 'btn small',
  onDone,
}: {
  connectionId: string
  chooseAccounts?: boolean
  label?: string
  className?: string
  onDone?: () => void
}) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [starting, setStarting] = useState(false)
  const repaired = useActionMutation('bank_reconnected')
  const busy = starting || token !== null || repaired.isPending

  async function start() {
    setError(null)
    setStarting(true)
    try {
      const input = chooseAccounts ? { connectionId, chooseAccounts } : { connectionId }
      setToken((await call('create_link_token', input)).linkToken)
    } catch (caught) {
      setError(caught)
    } finally {
      setStarting(false)
    }
  }

  async function finish() {
    setToken(null)
    try {
      await repaired.mutateAsync({ connectionId })
      onDone?.()
    } catch (caught) {
      setError(caught)
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void start()}>
        {repaired.isPending ? 'Pulling in your accounts' : label}
      </button>
      {token && (
        <PlaidWindow token={token} onSuccess={() => void finish()} onExit={() => setToken(null)} />
      )}
      <ErrorNote error={error} />
    </>
  )
}
