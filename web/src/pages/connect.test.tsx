// The consent screen an assistant sends the owner to when it asks to connect.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn, type Handlers } from '../test/fake'
import { Connect, ConnectProblem, navigate, PROBLEMS } from './Connect'

const claude = {
  id: 'req-1',
  appName: 'Claude',
  appHost: 'claude.ai',
  redirectsTo: 'claude.ai',
  local: false,
  requestedScope: 'write',
}

const BACK = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'

let go: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  go = vi.spyOn(navigate, 'to').mockImplementation(() => {})
})
afterEach(() => go.mockRestore())

function open(request: unknown, extra: Handlers = {}, routes = {}) {
  const server = fakeServer(
    {
      get_connect_request: () => request,
      answer_connect_request: () => ({ redirectTo: BACK }),
      ...extra,
    },
    routes,
  )
  renderSignedIn(
    <Routes>
      <Route path="/connect" element={<ConnectProblem />} />
      <Route path="/connect/:id" element={<Connect />} />
    </Routes>,
    { route: '/connect/req-1' },
  )
  return server
}

describe('Connect', () => {
  it('says who is asking and lets the owner give full access', async () => {
    const server = open(claude)
    expect(
      await screen.findByRole('heading', { name: 'Connect Claude to Leeway?' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Asked by/)).toHaveTextContent(
      'Asked by claude.ai. Approving sends you back to claude.ai.',
    )
    expect(screen.getByRole('button', { name: 'Look and change budgets' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/never move money/)).toBeInTheDocument()
    expect(screen.queryByText(/an app on this computer/)).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith(BACK))
    expect(server.actions('get_connect_request')).toEqual([{ id: 'req-1' }])
    expect(server.actions('answer_connect_request')).toEqual([
      { id: 'req-1', approve: true, scope: 'write' },
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Taking you back to Claude')
  })

  it('lets the owner give less than the app asked for', async () => {
    const server = open(claude)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Look only' }))
    expect(screen.getByText(/It can read your accounts/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(server.actions('answer_connect_request')).toEqual([
        { id: 'req-1', approve: true, scope: 'read' },
      ]),
    )
  })

  it('offers no choice when the app only asked to look', async () => {
    const server = open({ ...claude, requestedScope: 'read' })
    expect(await screen.findByText('Claude asks only to look at your budgets and spending.'))
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(server.actions('answer_connect_request')).toEqual([
        { id: 'req-1', approve: true, scope: 'read' },
      ]),
    )
  })

  it('warns when the app runs on this computer', async () => {
    open({ ...claude, appName: 'Claude Code', redirectsTo: 'an app on this computer', local: true })
    expect(await screen.findByText(/This gives access to an app on this computer/)).toBeVisible()
  })

  it('sends a denial back to the app', async () => {
    const server = open(claude)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith(BACK))
    expect(server.actions('answer_connect_request')).toEqual([
      { id: 'req-1', approve: false, scope: 'write' },
    ])
  })

  it('explains an expired or answered request', async () => {
    open(
      null,
      {},
      {
        '/api/actions/get_connect_request': failing(
          'This sign-in request has expired or was already answered. Start connecting again from your assistant.',
          404,
        ),
      },
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'has expired or was already answered',
    )
    expect(screen.getByRole('link', { name: 'Go to Leeway' })).toHaveAttribute('href', '/')
  })

  it('shows why answering failed and stays put', async () => {
    open(claude, {}, { '/api/actions/answer_connect_request': failing('Try again', 500) })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again')
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })
})

describe('ConnectProblem', () => {
  function show(query: string) {
    fakeServer({})
    renderSignedIn(
      <Routes>
        <Route path="/connect" element={<ConnectProblem />} />
      </Routes>,
      { route: `/connect${query}` },
    )
    return screen.getByRole('alert')
  }

  it('explains each problem the server can report', () => {
    for (const [code, sentence] of Object.entries(PROBLEMS)) {
      expect(show(`?problem=${code}`)).toHaveTextContent(sentence)
      document.body.innerHTML = ''
    }
  })

  it('never shows text from the link itself', () => {
    expect(show('?problem=Send%20your%20password%20to%20evil.example')).toHaveTextContent(
      'Something went wrong while connecting, so nothing was shared.',
    )
    expect(screen.queryByText(/evil/)).not.toBeInTheDocument()
  })

  it('handles a missing problem code', () => {
    expect(show('')).toHaveTextContent('Something went wrong while connecting')
  })

  it.each(['constructor', 'toString', '__proto__'])(
    'treats the built-in object name %s as an unknown code',
    (code) => {
      expect(show(`?problem=${code}`)).toHaveTextContent(
        'Something went wrong while connecting, so nothing was shared.',
      )
    },
  )
})
