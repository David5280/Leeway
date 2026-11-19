// An account the bank no longer shares: shown with when it was last read,
// shared again through Plaid's update mode, or removed with its history after
// a confirm.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { account, failing, fakeServer, renderSignedIn } from '../../test/fake'
import { plaid, plaidSucceeds, resetPlaid } from '../../test/plaid'
import { isCounted, isShared, unsharedLabel } from '../../lib/accounts'
import { UnsharedAccount } from './UnsharedAccount'

vi.mock('react-plaid-link', async () => (await import('../../test/plaid')).plaidLinkMock)

afterEach(() => vi.unstubAllGlobals())
beforeEach(resetPlaid)

const savings = account({
  id: 'acct-savings',
  name: 'Chase Savings',
  connectionId: 'conn-chase',
  institutionName: 'Chase',
  mask: '2222',
  balanceCents: 900000,
  balanceUpdatedAt: '2026-11-03T15:00:00Z',
  unsharedAt: '2026-11-04T15:00:00Z',
})

describe('UnsharedAccount', () => {
  it('says the bank no longer shares it, when it was last read and what it held', () => {
    fakeServer({})
    renderSignedIn(<UnsharedAccount account={savings} />)
    const row = screen.getByRole('group', { name: 'Chase Savings' })
    expect(within(row).getByText('No longer shared from Chase')).toBeInTheDocument()
    expect(row).toHaveTextContent(/Last updated Nov 3(, 2026)?, holding \$9,000\.00/)
    expect(row).toHaveTextContent('··2222')
  })

  it('says what a card owed, and falls back to when it stopped being shared', () => {
    fakeServer({})
    const card = {
      ...savings,
      name: 'Old card',
      type: 'credit' as const,
      mask: null,
      balanceUpdatedAt: null,
      institutionName: null,
    }
    renderSignedIn(<UnsharedAccount account={card} />)
    const row = screen.getByRole('group', { name: 'Old card' })
    expect(row).toHaveTextContent('No longer shared from its bank')
    expect(row).toHaveTextContent(/Last updated Nov 4(, 2026)?, owing \$9,000\.00/)
  })

  it('leaves out the amount when the bank never sent one', () => {
    fakeServer({})
    renderSignedIn(<UnsharedAccount account={{ ...savings, balanceCents: null }} />)
    expect(screen.getByRole('group', { name: 'Chase Savings' })).not.toHaveTextContent('holding')
  })

  it('shares it again through Plaid, letting the owner tick it', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'update-token' }),
      bank_reconnected: () => ({
        connectionId: 'conn-chase',
        institutionName: 'Chase',
        added: 1,
        modified: 0,
        removed: 0,
        error: null,
      }),
    })
    renderSignedIn(<UnsharedAccount account={savings} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Share it again' }))

    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([
      { connectionId: 'conn-chase', chooseAccounts: true },
    ])
    plaidSucceeds('public-again')
    await waitFor(() =>
      expect(server.actions('bank_reconnected')).toEqual([{ connectionId: 'conn-chase' }]),
    )
    expect(server.actions('link_bank')).toEqual([])
  })

  it('asks before removing it with its history, and keeps it on Keep it', async () => {
    const server = fakeServer({ delete_account: () => ({ deleted: true }) })
    const user = userEvent.setup()
    renderSignedIn(<UnsharedAccount account={savings} />)

    await user.click(screen.getByRole('button', { name: 'Remove this account and its history' }))
    expect(
      screen.getByText(
        'This deletes Chase Savings and all its transactions from Leeway. It cannot be undone.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share it again' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: 'Share it again' })).toBeInTheDocument()
    expect(server.actions('delete_account')).toEqual([])
  })

  it('removes it on Remove for good', async () => {
    const server = fakeServer({ delete_account: () => ({ deleted: true }) })
    const user = userEvent.setup()
    renderSignedIn(<UnsharedAccount account={savings} />)
    await user.click(screen.getByRole('button', { name: 'Remove this account and its history' }))
    await user.click(screen.getByRole('button', { name: 'Remove for good' }))
    await waitFor(() => expect(server.actions('delete_account')).toEqual([{ id: 'acct-savings' }]))
  })

  it('shows why a removal failed', async () => {
    fakeServer({}, { '/api/actions/delete_account': failing('Account not found', 404) })
    const user = userEvent.setup()
    renderSignedIn(<UnsharedAccount account={savings} />)
    await user.click(screen.getByRole('button', { name: 'Remove this account and its history' }))
    await user.click(screen.getByRole('button', { name: 'Remove for good' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Account not found')
  })
})

describe('shared and counted accounts', () => {
  it('counts an account only while shown and shared', () => {
    expect(isShared(savings)).toBe(false)
    expect(isCounted(savings)).toBe(false)
    expect(isCounted({ ...savings, unsharedAt: null })).toBe(true)
    expect(isCounted({ ...savings, unsharedAt: null, hidden: true })).toBe(false)
    expect(unsharedLabel(savings)).toBe('No longer shared from Chase')
  })
})
