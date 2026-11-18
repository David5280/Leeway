// The Banks section: listing linked banks, syncing, repairing a login and removing a bank.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../api/client'
import { failing, fakeServer, renderSignedIn, withBank } from '../../test/fake'
import { BanksSection } from './Banks'

// Plaid's window cannot open in jsdom; this stand-in opens at once and hands back a token.
vi.mock('react-plaid-link', () => ({
  usePlaidLink: (config: { onSuccess: (publicToken: string) => void }) => ({
    open: () => config.onSuccess('public-sandbox-token'),
    ready: true,
  }),
}))

afterEach(() => vi.unstubAllGlobals())

function connection(fields: Partial<Connection> & Pick<Connection, 'id'>): Connection {
  return {
    provider: 'plaid',
    institutionName: 'First Bank',
    status: 'active',
    lastSyncedAt: null,
    lastError: null,
    accountCount: 2,
    ...fields,
  }
}

describe('Banks', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  const connections = [
    connection({ id: 'conn-1', lastSyncedAt: fiveMinutesAgo }),
    connection({ id: 'conn-2', institutionName: 'Credit Union', status: 'needs_reauth' }),
    connection({ id: 'conn-3', institutionName: null, status: 'error', accountCount: 1 }),
    connection({
      id: 'conn-4',
      institutionName: 'Old Bank',
      status: 'error',
      lastError: 'The bank is not answering',
    }),
  ]

  function serve(list: Connection[] = connections) {
    return fakeServer({
      list_connections: () => list,
      sync_banks: () => [
        {
          connectionId: 'conn-1',
          institutionName: null,
          added: 2,
          modified: 1,
          removed: 0,
          error: null,
        },
        {
          connectionId: 'conn-2',
          institutionName: null,
          added: 1,
          modified: 0,
          removed: 0,
          error: null,
        },
      ],
      remove_connection: () => ({ deleted: true }),
      create_link_token: () => ({ linkToken: 'link-sandbox' }),
      bank_reconnected: () => ({ ok: true }),
    })
  }

  function rowOf(name: string) {
    return screen.getByText(name).closest('.list-row') as HTMLElement
  }

  it('explains how to set up bank keys and lists nothing when the server has none', () => {
    const server = fakeServer({})
    renderSignedIn(<BanksSection />)
    expect(screen.getByRole('region', { name: 'Banks' })).toHaveTextContent('PLAID_SECRET')
    expect(server.actions('list_connections')).toEqual([])
  })

  it('says Plaid lists only test banks while it is in Sandbox', async () => {
    serve()
    renderSignedIn(<BanksSection />, { status: withBank })
    expect(
      await screen.findByText('Plaid is in Sandbox, so it lists only test banks.'),
    ).toBeInTheDocument()
  })

  it('says nothing of Sandbox once Plaid reaches real banks', async () => {
    serve()
    const production = { provider: 'plaid', environment: 'production' }
    renderSignedIn(<BanksSection />, { status: { bank: production } })
    await screen.findByText('First Bank')
    expect(screen.queryByText(/Sandbox/)).not.toBeInTheDocument()
  })

  it('lists banks with their accounts, last sync and status', async () => {
    serve()
    renderSignedIn(<BanksSection />, { status: withBank })
    expect(await screen.findByText('First Bank')).toBeInTheDocument()
    expect(rowOf('First Bank')).toHaveTextContent('2 accounts, synced 5 min ago')
    expect(rowOf('First Bank')).toHaveTextContent('Connected')
    expect(rowOf('Bank')).toHaveTextContent('1 account, synced never')
    expect(rowOf('Bank')).toHaveTextContent('Sync failed')
    expect(rowOf('Old Bank')).toHaveTextContent('The bank is not answering')
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeInTheDocument()
  })

  it('asks to sign in again where a login expired, and repairs it', async () => {
    const server = serve()
    renderSignedIn(<BanksSection />, { status: withBank })
    await screen.findByText('Credit Union')
    const row = rowOf('Credit Union')
    expect(row).toHaveTextContent('Needs you to sign in again')
    expect(within(rowOf('First Bank')).queryByRole('button', { name: 'Fix login' })).toBeNull()
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Fix login' }))
    await waitFor(() =>
      expect(server.actions('bank_reconnected')).toEqual([{ connectionId: 'conn-2' }]),
    )
    expect(server.actions('create_link_token')).toEqual([{ connectionId: 'conn-2' }])
  })

  it('syncs now and reports what came in', async () => {
    const server = serve()
    renderSignedIn(<BanksSection />, { status: withBank })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText('3 new, 1 updated.')).toBeInTheDocument()
    expect(server.actions('sync_banks')).toEqual([{}])
  })

  it('shows why a sync failed', async () => {
    fakeServer(
      { list_connections: () => connections },
      { '/api/actions/sync_banks': failing('Plaid is unavailable', 502) },
    )
    renderSignedIn(<BanksSection />, { status: withBank })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Plaid is unavailable')
  })

  it('offers to connect the first bank, with nothing to sync yet', async () => {
    const server = serve([])
    renderSignedIn(<BanksSection />, { status: withBank })
    await waitFor(() => expect(server.actions('list_connections')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Connect a bank' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  })

  it('removes a bank only after asking, and Keep backs out', async () => {
    const server = serve()
    renderSignedIn(<BanksSection />, { status: withBank })
    const user = userEvent.setup()
    await screen.findByText('First Bank')
    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' }))
    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Keep' }))
    expect(server.actions('remove_connection')).toEqual([])
    expect(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' })).toBeInTheDocument()

    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' }))
    // Only the bank being removed asks; the others keep their plain Remove.
    expect(within(rowOf('First Bank')).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    await user.click(
      within(rowOf('Old Bank')).getByRole('button', { name: 'Remove and delete its data' }),
    )
    await waitFor(() => expect(server.actions('remove_connection')).toEqual([{ id: 'conn-4' }]))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove and delete its data' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows why removing failed and keeps asking', async () => {
    fakeServer(
      { list_connections: () => connections },
      { '/api/actions/remove_connection': failing('Could not reach the bank', 502) },
    )
    renderSignedIn(<BanksSection />, { status: withBank })
    const user = userEvent.setup()
    await screen.findByText('First Bank')
    await user.click(within(rowOf('First Bank')).getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove and delete its data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the bank')
    expect(screen.getByRole('button', { name: 'Remove and delete its data' })).toBeEnabled()
  })

  it('shows why banks could not load', async () => {
    fakeServer({}, { '/api/actions/list_connections': failing('Not allowed', 403) })
    renderSignedIn(<BanksSection />, { status: withBank })
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
  })
})
