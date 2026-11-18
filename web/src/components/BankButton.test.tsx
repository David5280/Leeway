// The bank button: opening Plaid, linking or repairing a login, and saying
// what went wrong; and the note shown when the server has no bank keys.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlaidLinkOnExitMetadata, PlaidLinkOptions } from 'react-plaid-link'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../test/fake'
import { BankButton, BankKeysMissing } from './BankButton'

// Plaid's window is a third-party script; the fake hands back whatever the button gave it.
const plaid = vi.hoisted(() => ({ open: vi.fn(), options: null as PlaidLinkOptions | null }))

vi.mock('react-plaid-link', () => ({
  usePlaidLink: (options: PlaidLinkOptions) => {
    plaid.options = options
    return { open: plaid.open, ready: true }
  },
}))

afterEach(() => vi.unstubAllGlobals())

describe('BankButton', () => {
  const connectionId = '5f0c2a8e-1b7d-4c5e-9a3f-2d6b8e4c1a70'
  const synced = {
    connectionId,
    institutionName: 'Chase',
    added: 12,
    modified: 0,
    removed: 0,
    error: null,
  }

  beforeEach(() => {
    plaid.open.mockClear()
    plaid.options = null
  })

  function plaidSucceeds(publicToken: string | null) {
    const metadata = { institution: null, accounts: [], link_session_id: 'session' }
    act(() => plaid.options!.onSuccess(publicToken, metadata))
  }

  function plaidExits() {
    const metadata: PlaidLinkOnExitMetadata = {
      institution: null,
      status: null,
      link_session_id: 'session',
      request_id: 'request',
    }
    act(() => plaid.options!.onExit!(null, metadata))
  }

  it('connects a bank with the token Plaid hands back', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => synced,
    })
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await userEvent.setup().click(button)

    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
    expect(plaid.options?.token).toBe('link-token-1')
    expect(server.actions('create_link_token')).toEqual([{}])
    // The button waits while Plaid's window is open.
    expect(button).toBeDisabled()

    plaidSucceeds('public-abc')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('link_bank')).toEqual([{ publicToken: 'public-abc' }])
    expect(server.actions('bank_reconnected')).toEqual([])
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it is pulling in accounts while the bank is saved', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'link-token-1' }),
      link_bank: () => synced,
    })
    const release = holdRequest('/api/actions/link_bank')
    renderSignedIn(<BankButton />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('button', { name: 'Pulling in your accounts' })).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('repairs a bank login instead of linking a new bank', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'repair-token' }),
      bank_reconnected: () => synced,
    })
    const onDone = vi.fn()
    renderSignedIn(<BankButton connectionId={connectionId} label="Log in again" onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Log in again' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([{ connectionId }])
    expect(plaid.options?.token).toBe('repair-token')

    plaidSucceeds('public-abc')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('bank_reconnected')).toEqual([{ connectionId }])
    expect(server.actions('link_bank')).toEqual([])
  })

  it('does nothing more when the window is closed without linking', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidExits()
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    expect(button).toBeEnabled()
    expect(server.actions('link_bank')).toEqual([])
    expect(onDone).not.toHaveBeenCalled()

    // Trying again asks for a fresh token.
    await user.click(button)
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(2))
    expect(server.actions('create_link_token')).toHaveLength(2)
  })

  it('ignores a success that carries no public token', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    renderSignedIn(<BankButton />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    plaidSucceeds(null)
    await act(() => Promise.resolve())
    expect(server.actions('link_bank')).toEqual([])
    // The window is done, so the button is free to try again.
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('is busy while it fetches a token', async () => {
    fakeServer({ create_link_token: () => ({ linkToken: 'link-token-1' }) })
    const release = holdRequest('/api/actions/create_link_token')
    renderSignedIn(<BankButton />)
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await userEvent.setup().click(button)
    expect(button).toBeDisabled()
    expect(plaid.open).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
  })

  it('shows why it could not start, and clears that on a new try', async () => {
    let tries = 0
    fakeServer(
      {},
      {
        '/api/actions/create_link_token': () =>
          ++tries === 1
            ? Response.json(
                { error: 'bank_not_configured', message: 'Bank sync is not set up.' },
                { status: 400 },
              )
            : Response.json({ result: { linkToken: 'link-token-2' } }),
      },
    )
    renderSignedIn(<BankButton />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Connect a bank' })
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('Bank sync is not set up.')
    expect(button).toBeEnabled()
    expect(plaid.open).not.toHaveBeenCalled()

    await user.click(button)
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why linking failed and does not report it done', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'link-token-1' }) },
      { '/api/actions/link_bank': failing('The bank did not answer.', 502) },
    )
    const onDone = vi.fn()
    renderSignedIn(<BankButton onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect a bank' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('alert')).toHaveTextContent('The bank did not answer.')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeEnabled()
  })

  it('explains which keys to set when the server has none', () => {
    render(<BankKeysMissing />)
    expect(screen.getByText('Bank sync is not set up on this server yet.')).toBeInTheDocument()
    expect(screen.getByText('PLAID_CLIENT_ID')).toBeInTheDocument()
    expect(screen.getByText('PLAID_SECRET')).toBeInTheDocument()
  })
})
