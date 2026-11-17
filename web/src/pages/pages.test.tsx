import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import {
  budgetFor,
  category,
  fakeServer,
  renderPlain,
  renderSignedIn,
  settings,
  status,
  transaction,
} from '../test/fake'
import { Budgets } from './Budgets'
import { Customize } from './Customize'
import { moveWidget } from './Overview'
import { starterRows } from './Setup'
import { groupByDay, Transactions } from './Transactions'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

describe('helpers', () => {
  it('groups transactions by day, newest first', () => {
    const txs = [
      transaction({ id: 'a', date: '2026-11-17', name: 'A' }),
      transaction({ id: 'b', date: '2026-11-17', name: 'B' }),
      transaction({ id: 'c', date: '2026-11-15', name: 'C' }),
    ]
    expect(groupByDay(txs).map(([day, items]) => [day, items.length])).toEqual([
      ['2026-11-17', 2],
      ['2026-11-15', 1],
    ])
  })

  it('moves dashboard widgets and stops at the ends', () => {
    const widgets = settings.dashboard.widgets
    expect(
      moveWidget(widgets, 0, 1)
        .slice(0, 2)
        .map((w) => w.type),
    ).toEqual(['glance', 'leeway'])
    expect(moveWidget(widgets, 0, -1)).toBe(widgets)
  })

  it('fills starter budgets from spending, keeping the owner edits', () => {
    const rows = starterRows(
      [
        { ...groceries, budgetCents: 60000 },
        { ...dining, budgetCents: 30000 },
      ],
      [{ name: 'Groceries', averageMonthlyCents: 41234, suggestedMonthlyCents: 42000 }],
      { 'Dining out': { include: false } },
    )
    expect(rows.map((r) => [r.category.name, r.amount, r.include, r.averageCents])).toEqual([
      ['Groceries', '420', true, 41234],
      ['Dining out', '300', false, null],
    ])
  })
})

describe('app shell', () => {
  it('starts setup when nobody owns this install', async () => {
    const server = fakeServer(
      {},
      {
        '/api/status': () => Response.json({ ...status, hasOwner: false, onboarded: false }),
        '/api/auth/setup': () =>
          Response.json({ owner: { email: 'a@b.co', name: null, onboarded: false } }),
      },
    )
    renderPlain(<App />)
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText(/Password/), 'long enough password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/api/auth/setup')?.body).toEqual({
        email: 'a@b.co',
        password: 'long enough password',
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
})

describe('transactions', () => {
  const txs = [
    transaction({
      id: 't1',
      date: '2026-11-17',
      name: 'COSTCO #12',
      merchantName: 'Costco',
      amountCents: 8450,
      categoryId: groceries.id,
      categorySource: 'rule',
    }),
    transaction({ id: 't2', date: '2026-11-16', name: 'SWEET COW', amountCents: 900 }),
    transaction({ id: 't3', date: '2026-11-16', name: 'Payroll', amountCents: -250000 }),
  ]

  function serve() {
    return fakeServer({
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_rules: () => [],
      list_transactions: (input) =>
        input.categoryId === 'uncategorized'
          ? { transactions: [txs[1]], total: 2 }
          : { transactions: txs, total: txs.length },
      update_transaction: (input) => ({ ...txs[1], ...input }),
      preview_rule: () => ({
        matchCount: 3,
        examples: [txs[0]],
        wouldMove: 2,
        movingFrom: [{ categoryId: null, count: 2 }],
      }),
    })
  }

  it('lists transactions by day with where each category came from', async () => {
    serve()
    renderSignedIn(<Transactions />)
    expect(await screen.findByText('Costco')).toBeInTheDocument()
    expect(screen.getByText('Tue, Nov 17')).toBeInTheDocument()
    expect(screen.getByText('Mon, Nov 16')).toBeInTheDocument()
    expect(screen.getByText('+$2,500.00')).toBeInTheDocument()
    expect(screen.getByText('by a rule')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 need a category' })).toBeInTheDocument()
  })

  it('files a transaction by hand', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const select = await screen.findByLabelText('Category for SWEET COW')
    await userEvent.setup().selectOptions(select, dining.id)
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([{ id: 't2', categoryId: dining.id }]),
    )
  })

  it('previews a rule made from a transaction before saving it', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getAllByRole('button', { name: 'Make a rule' })[0]!)
    const form = screen.getByRole('form', { name: 'New rule' })
    expect(within(form).getByLabelText('Text to match')).toHaveValue('Costco')
    expect(await within(form).findByText('3')).toBeInTheDocument()
    expect(form).toHaveTextContent('2 would move to Groceries from uncategorized')
    expect(server.actions('preview_rule')[0]).toMatchObject({
      pattern: 'Costco',
      categoryId: groceries.id,
    })
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

describe('customize', () => {
  it('saves a theme change and shows it right away', async () => {
    const server = fakeServer({
      update_settings: (patch) => ({
        ...settings,
        appearance: { ...settings.appearance, ...(patch.appearance as object) },
      }),
      list_accounts: () => [],
      list_tokens: () => [],
    })
    renderSignedIn(<Customize />)
    const user = userEvent.setup()
    const look = screen.getByRole('region', { name: 'Look' })
    await user.click(within(look).getByRole('button', { name: /Harbor/ }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ appearance: { theme: 'harbor' } }]),
    )
    expect(within(look).getByRole('button', { name: /Harbor/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('explains how to add bank keys when the server has none', () => {
    fakeServer({ list_accounts: () => [], list_tokens: () => [] })
    renderSignedIn(<Customize />)
    expect(screen.getByRole('region', { name: 'Banks' })).toHaveTextContent('PLAID_CLIENT_ID')
    expect(screen.getByRole('region', { name: 'AI assistant' })).toHaveTextContent(
      'https://leeway.example.com/mcp',
    )
  })
})
