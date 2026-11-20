// A stand-in for Plaid's window in tests. Plaid's window is a third-party
// script that cannot run in jsdom, and no test may reach Plaid, so the
// component tests mock react-plaid-link with this and play the window's part.

import { act } from '@testing-library/react'
import type {
  PlaidLinkOnExitMetadata,
  PlaidLinkOnSuccessMetadata,
  PlaidLinkOptions,
} from 'react-plaid-link'
import { vi } from 'vitest'

/** What the mocked hook was last given, and whether it was asked to open. */
export const plaid = {
  open: vi.fn(),
  options: null as PlaidLinkOptions | null,
}

/** The mock for react-plaid-link: `vi.mock('react-plaid-link', () => plaidLinkMock)`. */
export const plaidLinkMock = {
  usePlaidLink: (options: PlaidLinkOptions) => {
    plaid.options = options
    return { open: plaid.open, ready: true }
  },
}

export function resetPlaid() {
  plaid.open.mockClear()
  plaid.options = null
}

/** What Plaid's window reports for a login at a bank, with the accounts picked. */
export function windowMetadata(
  institution: { id: string; name: string } | null,
  accounts: { name: string; mask: string | null }[] = [],
): PlaidLinkOnSuccessMetadata {
  return {
    institution: institution && { institution_id: institution.id, name: institution.name },
    accounts: accounts.map((account, index) => ({
      id: `account-${index}`,
      type: 'depository',
      subtype: 'checking',
      verification_status: null,
      class_type: null,
      ...account,
    })),
    link_session_id: 'session',
  }
}

/** The owner finishes in Plaid's window. */
export function plaidSucceeds(
  publicToken: string | null,
  metadata: PlaidLinkOnSuccessMetadata = windowMetadata(null),
) {
  // Plaid's types say a token always comes; in practice it can be missing.
  act(() => plaid.options!.onSuccess(publicToken as string, metadata))
}

/** The owner closes Plaid's window without finishing. */
export function plaidExits() {
  const metadata: PlaidLinkOnExitMetadata = {
    institution: null,
    status: null,
    link_session_id: 'session',
    request_id: 'request',
  }
  act(() => plaid.options!.onExit!(null, metadata))
}
