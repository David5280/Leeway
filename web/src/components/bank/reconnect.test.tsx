// Reconnecting a bank Leeway already has: Plaid's update mode, which repairs a
// login or shares more accounts without a new Plaid login.

import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../../test/fake'
import { plaid, plaidExits, plaidSucceeds, resetPlaid } from '../../test/plaid'
import { ReconnectButton } from './ReconnectButton'

vi.mock('react-plaid-link', async () => (await import('../../test/plaid')).plaidLinkMock)

afterEach(() => vi.unstubAllGlobals())
beforeEach(resetPlaid)

const connectionId = '5f0c2a8e-1b7d-4c5e-9a3f-2d6b8e4c1a70'
const synced = {
  connectionId,
  institutionName: 'Chase',
  added: 12,
  modified: 0,
  removed: 0,
  error: null,
}

describe('ReconnectButton', () => {
  it('repairs a login in update mode, and never links a new bank', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'repair-token' }),
      bank_reconnected: () => synced,
    })
    const onDone = vi.fn()
    renderSignedIn(
      <ReconnectButton connectionId={connectionId} label="Fix login" onDone={onDone} />,
    )
    const button = screen.getByRole('button', { name: 'Fix login' })
    await userEvent.setup().click(button)

    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(1))
    expect(server.actions('create_link_token')).toEqual([{ connectionId }])
    expect(plaid.options?.token).toBe('repair-token')
    // The button waits while Plaid's window is open.
    expect(button).toBeDisabled()

    plaidSucceeds('public-abc')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(server.actions('bank_reconnected')).toEqual([{ connectionId }])
    expect(server.actions('link_bank')).toEqual([])
    expect(screen.getByRole('button', { name: 'Fix login' })).toBeEnabled()
  })

  it('asks Plaid to let the owner choose accounts when reconnecting a healthy bank', async () => {
    const server = fakeServer({
      create_link_token: () => ({ linkToken: 'update-token' }),
      bank_reconnected: () => synced,
    })
    renderSignedIn(<ReconnectButton connectionId={connectionId} chooseAccounts />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(server.actions('create_link_token')).toEqual([{ connectionId, chooseAccounts: true }])
  })

  it('says it is pulling in accounts while it catches up', async () => {
    fakeServer({
      create_link_token: () => ({ linkToken: 'repair-token' }),
      bank_reconnected: () => synced,
    })
    const release = holdRequest('/api/actions/bank_reconnected')
    renderSignedIn(<ReconnectButton connectionId={connectionId} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('button', { name: 'Pulling in your accounts' })).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeEnabled()
  })

  it('does nothing more when the window is closed, and a new try asks for a fresh token', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'repair-token' }) })
    const onDone = vi.fn()
    renderSignedIn(<ReconnectButton connectionId={connectionId} onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidExits()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
    expect(server.actions('bank_reconnected')).toEqual([])
    expect(onDone).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalledTimes(2))
    expect(server.actions('create_link_token')).toHaveLength(2)
  })

  it('treats a finish with no public token like closing the window', async () => {
    const server = fakeServer({ create_link_token: () => ({ linkToken: 'repair-token' }) })
    renderSignedIn(<ReconnectButton connectionId={connectionId} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    plaidSucceeds(null)
    await act(() => Promise.resolve())
    expect(server.actions('bank_reconnected')).toEqual([])
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
  })

  it('shows why it could not start, and clears that on a new try', async () => {
    let tries = 0
    fakeServer(
      {},
      {
        '/api/actions/create_link_token': () =>
          ++tries === 1
            ? Response.json(
                { error: 'not_configured', message: 'Bank sync is not set up.' },
                { status: 503 },
              )
            : Response.json({ result: { linkToken: 'repair-token' } }),
      },
    )
    renderSignedIn(<ReconnectButton connectionId={connectionId} />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Reconnect' })
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('Bank sync is not set up.')
    expect(button).toBeEnabled()

    await user.click(button)
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows why catching up failed and does not report it done', async () => {
    fakeServer(
      { create_link_token: () => ({ linkToken: 'repair-token' }) },
      { '/api/actions/bank_reconnected': failing('The bank did not answer.', 502) },
    )
    const onDone = vi.fn()
    renderSignedIn(<ReconnectButton connectionId={connectionId} onDone={onDone} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(plaid.open).toHaveBeenCalled())

    plaidSucceeds('public-abc')
    expect(await screen.findByRole('alert')).toHaveTextContent('The bank did not answer.')
    expect(onDone).not.toHaveBeenCalled()
  })
})
