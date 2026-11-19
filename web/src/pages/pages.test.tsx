import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import {
  budgetFor,
  category,
  failing,
  fakeServer,
  renderPlain,
  renderSignedIn,
  settings,
  status,
} from '../test/fake'
import { Budgets } from './Budgets'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

describe('app shell', () => {
  it('starts setup when nobody owns this install', async () => {
    const server = fakeServer(
      {},
      {
        '/api/status': () =>
          Response.json({ ...status, hasOwner: false, onboarded: false, setupCodeFrom: 'log' }),
        '/api/auth/setup-code': () => new Response(null, { status: 204 }),
        '/api/auth/setup': () =>
          Response.json({ owner: { email: 'a@b.co', name: null, onboarded: false } }),
      },
    )
    renderPlain(<App />)
    expect(
      await screen.findByRole('heading', { name: 'Enter your setup code' }),
    ).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Setup code'), 'K7QM-2XRA-9PVD')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'long enough password')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/auth/setup')?.body).toEqual({
        email: 'a@b.co',
        password: 'long enough password',
        setupCode: 'K7QM-2XRA-9PVD',
      }),
    )
  })

  it('asks to sign in when the session is gone', async () => {
    fakeServer(
      {},
      {
        '/api/status': () => Response.json(status),
        '/api/auth/me': () =>
          Response.json({ error: 'unauthorized', message: 'Sign in' }, { status: 401 }),
      },
    )
    renderPlain(<App />)
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('says why when the settings cannot be read, instead of loading forever', async () => {
    fakeServer(
      {},
      {
        '/api/status': () => Response.json(status),
        '/api/auth/me': () =>
          Response.json({ owner: { email: 'a@b.co', name: null, onboarded: true } }),
        '/api/actions/get_settings': failing('The database is not answering.', 500),
      },
    )
    renderPlain(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is not answering.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens Settings from its old Customize address, with Settings marked in the menu', async () => {
    fakeServer(
      { get_settings: () => settings, list_accounts: () => [], list_tokens: () => [] },
      {
        '/api/status': () => Response.json(status),
        '/api/auth/me': () =>
          Response.json({ owner: { email: 'a@b.co', name: null, onboarded: true } }),
      },
    )
    renderPlain(<App />, '/customize/banks')
    expect(await screen.findByRole('heading', { level: 2, name: 'Banks' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    const menus = screen.getAllByRole('navigation', { name: 'Main' })
    for (const menu of menus) {
      expect(within(menu).getByRole('link', { name: /Settings/ })).toHaveAttribute(
        'aria-current',
        'page',
      )
    }
  })
})

describe('budgets', () => {
  it('shows totals and each category with its status', async () => {
    fakeServer({
      get_budget: () => budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }]),
      list_categories: () => categories,
    })
    renderSignedIn(<Budgets />)
    expect(await screen.findByRole('heading', { name: 'Budgets' })).toBeInTheDocument()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    expect(screen.getByText('Over by $40')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Budgeted' })).toHaveTextContent('$800')
  })
})
