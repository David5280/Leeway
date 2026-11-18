import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { App } from '../App'
import {
  account,
  budgetFor,
  category,
  failing,
  fakeServer,
  renderPlain,
  renderSignedIn,
  settings,
  status,
  transaction,
} from '../test/fake'
import { Budgets } from './Budgets'
import { Customize } from './Customize'
import { Transactions } from './Transactions'

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

describe('transactions filters and editing', () => {
  const costco = transaction({
    id: 't1',
    date: '2026-11-17',
    name: 'COSTCO #12',
    merchantName: 'Costco',
    amountCents: 8450,
    categoryId: groceries.id,
    categorySource: 'manual',
    bankCategory: 'FOOD_AND_DRINK_GROCERIES',
  })
  const cash = transaction({
    id: 't2',
    date: '2026-11-16',
    name: 'Farmers market',
    manual: true,
    source: 'manual',
  })

  function serve(list: Record<string, unknown> = {}) {
    return fakeServer({
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_rules: () => [],
      list_accounts: () => [{ id: 'acct', name: 'Checking' }],
      list_transactions: () => ({ transactions: [costco, cash], total: 2, ...list }),
      update_transaction: (input) => ({ ...costco, ...input }),
      delete_transaction: () => null,
      create_transaction: (input) => ({ ...cash, ...input }),
    })
  }

  it('filters by the category in the address, so other screens can link to it', async () => {
    const server = serve()
    renderSignedIn(<Transactions />, { route: '/transactions?category=uncategorized' })
    await screen.findByText('Costco')
    expect(
      server.actions('list_transactions').filter((input) => {
        const { categoryId, limit } = input as { categoryId?: string; limit: number }
        return categoryId === 'uncategorized' && limit > 1
      }),
    ).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: '2 need a category' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it("narrows to one account from that account's page, until the chip is cleared", async () => {
    const server = fakeServer({
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_accounts: () => [account({ id: 'acct-1', name: 'Everyday' })],
      list_transactions: () => ({ transactions: [], total: 0 }),
    })
    renderSignedIn(<Transactions />, { route: '/transactions?account=acct-1' })
    const chip = await screen.findByRole('button', { name: 'Everyday' })
    await waitFor(() =>
      expect(server.actions('list_transactions')).toContainEqual(
        expect.objectContaining({ accountId: 'acct-1' }),
      ),
    )
    await userEvent.click(chip)
    expect(screen.queryByRole('button', { name: 'Everyday' })).not.toBeInTheDocument()
    expect(server.actions('list_transactions').at(-1)).not.toHaveProperty('accountId')
  })

  it('names a linked account it cannot find plainly', async () => {
    fakeServer({
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_accounts: () => [],
      list_transactions: () => ({ transactions: [], total: 0 }),
    })
    renderSignedIn(<Transactions />, { route: '/transactions?account=gone' })
    expect(await screen.findByRole('button', { name: 'One account' })).toBeInTheDocument()
  })

  it('searches and widens the date range', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getByRole('button', { name: 'All' }))
    await user.type(screen.getByLabelText('Search transactions'), 'costco')
    await waitFor(() =>
      expect(server.actions('list_transactions').at(-1)).toEqual({ search: 'costco', limit: 100 }),
    )
  })

  it('says nothing matches when a filter finds nothing', async () => {
    serve({ transactions: [], total: 0 })
    renderSignedIn(<Transactions />)
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument()
  })

  it('offers more when there are more, up to the newest 500', async () => {
    const server = serve({ total: 900 })
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await screen.findByText('Costco')
    for (let shown = 100; shown < 500; shown += 100) {
      await user.click(screen.getByRole('button', { name: 'Show more' }))
    }
    expect(await screen.findByText(/Showing the newest 500/)).toBeInTheDocument()
    expect(server.actions('list_transactions').at(-1)).toMatchObject({ limit: 500 })
  })

  it('opens a transaction to add a note, leave it out, or hand it back to rules', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Costco/ }))
    expect(screen.getByText('Your bank calls this food and drink groceries.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Note'), 'Party food')
    await user.tab()
    await user.click(screen.getByRole('switch', { name: 'Leave out of totals' }))
    await user.click(screen.getByRole('button', { name: 'Let rules decide again' }))
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([
        { id: 't1', note: 'Party food' },
        { id: 't1', excluded: true },
        { id: 't1', categoryId: null },
      ]),
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('deletes only transactions added by hand', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Farmers market/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(server.actions('delete_transaction')).toEqual([{ id: 't2' }]))
  })

  it('says which transactions were imported from a file, and links to importing more', async () => {
    const imported = transaction({
      id: 't3',
      date: '2026-11-15',
      name: 'Old rent',
      manual: true,
      source: 'import',
    })
    serve({ transactions: [imported, cash], total: 2 })
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    expect(screen.getByRole('link', { name: 'Import a file' })).toHaveAttribute(
      'href',
      '/transactions/import',
    )
    await user.click(await screen.findByRole('button', { name: /Old rent/ }))
    expect(screen.getByText('Imported from a file.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Farmers market/ }))
    expect(screen.queryByText('Imported from a file.')).not.toBeInTheDocument()
  })

  it('adds money received by hand as money in', async () => {
    const server = serve()
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add by hand' }))
    const form = screen.getByRole('form', { name: 'Add a transaction' })
    await user.clear(within(form).getByLabelText('Date'))
    await user.type(within(form).getByLabelText('Date'), '2026-11-15')
    await user.type(within(form).getByLabelText('Description'), 'Sold a chair')
    await user.type(within(form).getByLabelText('Amount'), '40')
    await user.click(within(form).getByRole('button', { name: 'Received' }))
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('create_transaction')).toEqual([
        {
          accountId: 'acct',
          date: '2026-11-15',
          name: 'Sold a chair',
          amountCents: -4000,
          categoryId: null,
        },
      ]),
    )
    expect(screen.queryByRole('form', { name: 'Add a transaction' })).not.toBeInTheDocument()
  })

  it('asks for an account before adding by hand when there is none', async () => {
    fakeServer({
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_rules: () => [],
      list_accounts: () => [],
      list_transactions: () => ({ transactions: [], total: 0 }),
    })
    renderSignedIn(<Transactions />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add by hand' }))
    expect(await screen.findByText(/Add an account first/)).toBeInTheDocument()
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

  it('scrolls to the section a link named, like accounts from the end of setup', () => {
    fakeServer({ list_accounts: () => [], list_tokens: () => [] })
    const scrolled: string[] = []
    // jsdom has no layout, so record which element was asked to scroll into view.
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.id)
    }
    onTestFinished(() => {
      HTMLElement.prototype.scrollIntoView = original
    })
    renderSignedIn(<Customize />, { route: '/customize#accounts' })
    expect(scrolled).toEqual(['accounts'])
  })
})
