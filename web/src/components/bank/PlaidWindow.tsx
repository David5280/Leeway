// Plaid's own bank login window, opened as soon as it has loaded.

import { useEffect } from 'react'
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link'

/**
 * Opens Plaid's window for a link token and reports how it went. Leeway only
 * sees what the window hands back: a public token and which bank and accounts
 * were picked, never the login itself.
 */
export function PlaidWindow({
  token,
  onSuccess,
  onExit,
}: {
  token: string
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void
  onExit: () => void
}) {
  const { open, ready } = usePlaidLink({
    token,
    // Plaid can finish without a token; treat that like closing the window so the button frees up.
    onSuccess: (publicToken, metadata) =>
      publicToken ? onSuccess(publicToken, metadata) : onExit(),
    onExit: () => onExit(),
  })
  useEffect(() => {
    if (ready) open()
  }, [ready, open])
  return null
}
