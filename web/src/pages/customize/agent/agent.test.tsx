// The AI assistant section: connecting Claude, connected apps and keys.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../../../test/fake'
import { AgentSection } from '../Agent'
import { nextKeyName } from './AgentKeys'

describe('AI assistant', () => {
  const tokens = [
    {
      id: 'tok-1',
      name: 'Claude',
      scope: 'read',
      createdAt: '2026-11-01T00:00:00Z',
      lastUsedAt: null,
    },
    {
      id: 'tok-2',
      name: 'Coach',
      scope: 'write',
      createdAt: '2026-11-02T12:00:00Z',
      lastUsedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
  ]
  const apps = [
    {
      id: '6f7c1d2e-0000-4000-8000-000000000001',
      name: 'Claude',
      host: 'claude.ai',
      scope: 'write',
      connectedAt: '2026-11-10T12:00:00Z',
      lastUsedAt: null,
    },
  ]

  function serve(connected: unknown[] = apps) {
    let n = 0
    return fakeServer({
      list_tokens: () => tokens,
      list_connected_apps: () => connected,
      disconnect_app: () => ({ disconnected: true }),
      create_token: (input) => ({
        id: `tok-new-${++n}`,
        name: input.name,
        scope: input.scope,
        createdAt: '2026-11-17T00:00:00Z',
        lastUsedAt: null,
        token: `lw_secret_${n}`,
      }),
      delete_token: () => ({ deleted: true }),
    })
  }

  function agent() {
    return screen.getByRole('region', { name: 'AI assistant' })
  }

  it('gives the connector address from the public URL, ready to copy', () => {
    serve()
    renderSignedIn(<AgentSection />)
    expect(screen.getByLabelText('Connector address')).toHaveTextContent(
      'https://leeway.example.com/mcp',
    )
    expect(agent()).toHaveTextContent('ask for a money check-in')
    expect(agent()).not.toHaveTextContent('public https address')
  })

  it('falls back to this page address, and warns that Claude needs https', () => {
    serve()
    renderSignedIn(<AgentSection />, { status: { publicUrl: null } })
    expect(screen.getByLabelText('Connector address')).toHaveTextContent(
      `${window.location.origin}/mcp`,
    )
    expect(agent()).toHaveTextContent('can only reach Leeway at a public https address')
  })

  it('walks through connecting Claude and Claude Code', () => {
    serve()
    renderSignedIn(<AgentSection />)
    expect(agent()).toHaveTextContent('open Customize, then Connectors')
    expect(agent()).toHaveTextContent('Add custom connector')
    expect(screen.getByLabelText('Claude Code command')).toHaveTextContent(
      'claude mcp add --transport http leeway https://leeway.example.com/mcp',
    )
  })

  it('copies the connector address', async () => {
    serve()
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderSignedIn(<AgentSection />)
    const field = screen.getByLabelText('Connector address').parentElement as HTMLElement
    await user.click(within(field).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('https://leeway.example.com/mcp')
    expect(within(field).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('lists connected apps and disconnects one', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    const row = (await within(agent()).findByText('(claude.ai)')).closest('.list-row')
    expect(row).toHaveTextContent('Can look and change, connected Nov 10, last used never')
    await userEvent
      .setup()
      .click(within(row as HTMLElement).getByRole('button', { name: 'Disconnect Claude' }))
    await waitFor(() => expect(server.actions('disconnect_app')).toEqual([{ id: apps[0]!.id }]))
  })

  it('says when nothing is connected yet', async () => {
    serve([])
    renderSignedIn(<AgentSection />)
    expect(await within(agent()).findByText(/Nothing connected yet/)).toBeInTheDocument()
  })

  it('lists keys with what each can do, when it was made and last used', async () => {
    serve()
    renderSignedIn(<AgentSection />)
    expect(await within(agent()).findByText('Coach')).toBeInTheDocument()
    expect(agent()).toHaveTextContent('Can look, made Nov 1, last used never')
    expect(agent()).toHaveTextContent('Can look and change, made Nov 2, last used 2 h ago')
  })

  it('creates a read-only key with a fresh default name and shows it once', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    expect(within(agent()).queryByText(/shown only once/)).not.toBeInTheDocument()
    await within(agent()).findByText('Coach')
    await userEvent.setup().click(within(agent()).getByRole('button', { name: 'Create a key' }))
    await waitFor(() =>
      expect(server.actions('create_token')).toEqual([{ name: 'Key 1', scope: 'read' }]),
    )
    expect(await screen.findByLabelText('New key')).toHaveTextContent('lw_secret_1')
    expect(agent()).toHaveTextContent('Your new key "Key 1", shown only once')
  })

  it('creates a named key that can change budgets', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    const user = userEvent.setup()
    const name = within(agent()).getByRole('textbox', { name: 'Key name' })
    await user.clear(name)
    await user.type(name, 'Budget coach')
    await user.selectOptions(
      within(agent()).getByRole('combobox', { name: 'What the key can do' }),
      'write',
    )
    await user.click(within(agent()).getByRole('button', { name: 'Create a key' }))
    await waitFor(() =>
      expect(server.actions('create_token')).toEqual([{ name: 'Budget coach', scope: 'write' }]),
    )
    expect(await screen.findByLabelText('New key')).toHaveTextContent('lw_secret_1')
  })

  it('needs a key name', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    const user = userEvent.setup()
    await user.clear(within(agent()).getByRole('textbox', { name: 'Key name' }))
    await user.click(within(agent()).getByRole('button', { name: 'Create a key' }))
    expect(server.actions('create_token')).toEqual([])
  })

  it('revokes a key with a clearly labeled button', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    await within(agent()).findByText('Coach')
    await userEvent.setup().click(within(agent()).getByRole('button', { name: 'Revoke Coach' }))
    await waitFor(() => expect(server.actions('delete_token')).toEqual([{ id: 'tok-2' }]))
  })

  it('shows why creating a key failed', async () => {
    fakeServer(
      { list_tokens: () => [], list_connected_apps: () => [] },
      { '/api/actions/create_token': failing('Too many keys') },
    )
    renderSignedIn(<AgentSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create a key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many keys')
    expect(screen.queryByText(/shown only once/)).not.toBeInTheDocument()
  })

  it('shows why revoking failed', async () => {
    fakeServer(
      { list_tokens: () => tokens, list_connected_apps: () => [] },
      { '/api/actions/delete_token': failing('Gone', 404) },
    )
    renderSignedIn(<AgentSection />)
    await userEvent
      .setup()
      .click(await within(agent()).findByRole('button', { name: 'Revoke Claude' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Gone')
  })

  it('shows why disconnecting failed', async () => {
    fakeServer(
      { list_tokens: () => [], list_connected_apps: () => apps },
      { '/api/actions/disconnect_app': failing('Connected app not found', 404) },
    )
    renderSignedIn(<AgentSection />)
    await userEvent
      .setup()
      .click(await within(agent()).findByRole('button', { name: 'Disconnect Claude' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connected app not found')
  })
})

describe('nextKeyName', () => {
  it('suggests the first free "Key N"', () => {
    expect(nextKeyName([])).toBe('Key 1')
    expect(nextKeyName(['AI assistant'])).toBe('Key 1')
    expect(nextKeyName(['Key 1', 'Key 2'])).toBe('Key 3')
    expect(nextKeyName(['Key 2', 'Claude'])).toBe('Key 1')
    expect(nextKeyName(['Key 1', 'Key 3'])).toBe('Key 2')
  })
})
