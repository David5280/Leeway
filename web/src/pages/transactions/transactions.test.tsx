import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  account,
  budgetFor,
  category,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  transaction,
  type Handlers,
} from '../../test/fake'
import { Transactions } from '../Transactions'

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('dining out')
const categories = [groceries, dining]

const costco = transaction({
  id: 't1',
  date: '2026-11-17',
  name: 'COSTCO #12',
  merchantName: 'Costco',
  amountCents: 8450,
  categoryId: groceries.id,
  categorySource: 'rule',
})
const unfiled = transaction({ id: 't2', date: '2026-11-16', name: 'SWEET COW', amountCents: 900 })
const payroll = transaction({ id: 't3', date: '2026-11-16', name: 'Payroll', amountCents: -250000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The list as the server would answer it; "need a category" counts one. */
function serve(handlers: Handlers = {}, routes: Record<string, () => Response> = {}) {
  return fakeServer(
    {
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      list_rules: () => [],
      list_accounts: () => [
        account({ id: 'acct-2', name: 'Visa Card' }),
        account({ id: 'acct-1', name: 'everyday checking' }),
      ],
      list_transactions: (input) =>
        input.categoryId === 'uncategorized'
          ? { transactions: [unfiled], total: 1 }
          : { transactions: [costco, unfiled, payroll], total: 3 },
      ...handlers,
    },
    routes,
  )
}

/** Shows the address's query string, where the category and account filters live. */
function Address() {
  return <p>Address: {useLocation().search || 'none'}</p>
}

function renderTransactions(route = '/transactions') {
  return renderSignedIn(
    <Routes>
      <Route
        path="/transactions"
        element={
          <>
            <Transactions />
            <Address />
          </>
        }
      />
      <Route path="/transactions/import" element={<p>Import page</p>} />
    </Routes>,
    { route },
  )
}

/** What the full list was last asked for (the chip's count query aside). */
function lastList(server: ReturnType<typeof serve>) {
  return server
    .actions('list_transactions')
    .filter((input) => (input as { limit: number }).limit > 1)
    .at(-1) as Record<string, unknown>
}

describe('Transactions list', () => {
  it('lists rows under days, opens a row in its sheet, and closes it again', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Yesterday' })).toBeInTheDocument()
    expect(screen.getByText('+$2,500.00')).toHaveClass('money-in')

    await user.click(screen.getByRole('button', { name: /^Costco, spent \$84\.50/ }))
    const sheet = screen.getByRole('dialog', { name: 'Costco' })
    expect(within(sheet).getByText('Set by a rule')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks for everything in the period, including transactions left out of totals', async () => {
    const server = serve()
    renderTransactions()
    await screen.findByText('Costco')
    expect(lastList(server)).toEqual({ start: '2026-11-01', includeExcluded: true, limit: 100 })
  })

  it('shows placeholder rows while the list loads', async () => {
    serve({ get_budget: () => new Promise(() => {}) })
    renderTransactions()
    expect(await screen.findByRole('status', { name: 'Loading transactions' })).toBeInTheDocument()
  })

  it('says what went wrong and tries again', async () => {
    serve({}, { '/api/actions/list_transactions': failing('Database is down') })
    renderTransactions()
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Database is down')).toBeInTheDocument()
  })

  it('says when there are no transactions at all', async () => {
    serve({ list_transactions: () => ({ transactions: [], total: 0 }) })
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Dates: This period' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'All' }))
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument()
  })

  it('says nothing matches a filter, and clears every filter', async () => {
    const server = serve({ list_transactions: () => ({ transactions: [], total: 0 }) })
    renderTransactions(`/transactions?category=${groceries.id}&account=acct-1`)
    const user = userEvent.setup()
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Address: none')).toBeInTheDocument()
    await waitFor(() => expect(lastList(server)).toEqual({ includeExcluded: true, limit: 100 }))
  })

  it('offers more when there are more, up to the newest 500', async () => {
    const server = serve({
      list_transactions: () => ({ transactions: [costco, unfiled], total: 900 }),
    })
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    // The last day may be cut short, so its net waits until it is all loaded.
    const yesterday = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(yesterday).getByRole('heading')).toHaveTextContent(/^Yesterday$/)
    for (let shown = 100; shown < 500; shown += 100) {
      await user.click(screen.getByRole('button', { name: 'Show more' }))
    }
    expect(await screen.findByText(/Showing the newest 500/)).toBeInTheDocument()
    expect(lastList(server)).toMatchObject({ limit: 500 })
  })
})

describe('Transactions filters', () => {
  it('searches, starting again from the first page', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.type(screen.getByLabelText('Search transactions'), 'costco')
    await waitFor(() => expect(lastList(server)).toMatchObject({ search: 'costco', limit: 100 }))
  })

  it('picks a date range from its chip', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getByRole('button', { name: 'Dates: This period' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Last 30 days' }))
    expect(screen.getByRole('button', { name: 'Dates: Last 30 days' })).toBeInTheDocument()
    await waitFor(() => expect(lastList(server)).toMatchObject({ start: '2026-10-18' }))
  })

  it('filters by a category picked A to Z, and keeps it in the address', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getByRole('button', { name: 'Category: all' }))
    const picker = screen.getByRole('dialog', { name: 'Filter by category' })
    const names = within(picker)
      .getAllByRole('button', { name: /^(?!Close)/ })
      .map((button) => button.querySelector('.option-label')?.textContent)
    expect(names).toEqual(['All categories', 'Needs a category', 'dining out', 'Groceries'])

    await user.click(within(picker).getByRole('button', { name: 'Groceries' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(`Address: ?category=${groceries.id}`)).toBeInTheDocument()
    await waitFor(() => expect(lastList(server).categoryId).toBe(groceries.id))

    await user.click(screen.getByRole('button', { name: 'Category: Groceries' }))
    await user.click(screen.getByRole('button', { name: 'All categories' }))
    expect(screen.getByText('Address: none')).toBeInTheDocument()
  })

  it('closes the category filter without changing it', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Category: all' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Address: none')).toBeInTheDocument()
  })

  it('names the category filter for what still needs one', async () => {
    serve()
    renderTransactions('/transactions?category=uncategorized')
    expect(
      await screen.findByRole('button', { name: 'Category: Needs a category' }),
    ).toBeInTheDocument()
  })

  it('narrows to an account picked A to Z, until all accounts are picked again', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getByRole('button', { name: 'Account: all' }))
    const items = screen.getAllByRole('menuitemradio').map((item) => item.textContent)
    expect(items).toEqual(['All accounts', 'everyday checking', 'Visa Card'])
    await user.click(screen.getByRole('menuitemradio', { name: 'everyday checking' }))
    expect(screen.getByText('Address: ?account=acct-1')).toBeInTheDocument()
    await waitFor(() => expect(lastList(server).accountId).toBe('acct-1'))

    await user.click(screen.getByRole('button', { name: 'Account: everyday checking' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'All accounts' }))
    expect(screen.getByText('Address: none')).toBeInTheDocument()
  })

  it("names an account from another screen's link it cannot find plainly", async () => {
    serve({ list_accounts: () => [] })
    renderTransactions('/transactions?account=gone')
    expect(await screen.findByRole('button', { name: 'Account: One account' })).toBeInTheDocument()
  })

  it('shows only what needs a category while its chip is on, keeping the rest of the address', async () => {
    const server = serve()
    renderTransactions('/transactions?from=overview')
    const user = userEvent.setup()
    const chip = await screen.findByRole('button', { name: '1 need a category' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Address: ?from=overview&category=uncategorized')).toBeInTheDocument()
    await waitFor(() => expect(lastList(server).categoryId).toBe('uncategorized'))
    await user.click(chip)
    expect(screen.getByText('Address: ?from=overview')).toBeInTheDocument()
  })

  it('hides the need-a-category chip when everything has one', async () => {
    serve({
      list_transactions: (input) =>
        input.categoryId === 'uncategorized'
          ? { transactions: [], total: 0 }
          : { transactions: [costco], total: 1 },
    })
    renderTransactions()
    await screen.findByText('Costco')
    expect(screen.queryByRole('button', { name: /need a category/ })).not.toBeInTheDocument()
  })
})

describe('Transactions add, import and rules', () => {
  it('adds money received by hand from the + menu, in a sheet', async () => {
    const server = serve({
      list_accounts: () => [account({ id: 'acct', name: 'Checking' })],
      create_transaction: (input) => ({ ...unfiled, ...input }),
    })
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getByRole('button', { name: 'Add or import' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add by hand' }))
    const form = within(screen.getByRole('dialog', { name: 'Add a transaction' })).getByRole('form')
    await user.type(within(form).getByLabelText('Description'), 'Sold a chair')
    await user.type(within(form).getByLabelText('Amount'), '40')
    await user.click(within(form).getByRole('button', { name: 'Received' }))
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('create_transaction')).toMatchObject([
        { accountId: 'acct', name: 'Sold a chair', amountCents: -4000, categoryId: null },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adds spending on another account and day, with a category, once accounts are known', async () => {
    const server = serve({
      list_accounts: () => [
        account({ id: 'acct', name: 'Checking' }),
        account({ id: 'cash', name: 'Wallet' }),
      ],
      create_transaction: (input) => ({ ...unfiled, ...input }),
    })
    const release = holdRequest('/api/actions/list_accounts')
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add or import' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add by hand' }))
    const form = within(screen.getByRole('dialog', { name: 'Add a transaction' })).getByRole('form')
    await user.type(within(form).getByLabelText('Description'), 'Farmers market')
    // With no account to put it on yet, Enter adds nothing.
    await user.type(within(form).getByLabelText('Amount'), '18{Enter}')
    expect(server.actions('create_transaction')).toEqual([])

    release()
    await within(form).findByRole('option', { name: 'Wallet' })
    await user.selectOptions(within(form).getByLabelText('Account'), 'Wallet')
    const date = within(form).getByLabelText('Date')
    await user.clear(date)
    await user.type(date, '2026-11-15')
    await user.selectOptions(within(form).getByLabelText('Category'), 'Groceries')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('create_transaction')).toMatchObject([
        {
          accountId: 'cash',
          date: '2026-11-15',
          name: 'Farmers market',
          amountCents: 1800,
          categoryId: groceries.id,
        },
      ]),
    )
  })

  it('asks for an account before adding by hand when there is none', async () => {
    serve({ list_accounts: () => [] })
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add or import' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add by hand' }))
    expect(await screen.findByText(/Add an account first/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes to importing a file from the + menu', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add or import' }))
    await user.click(screen.getByRole('menuitem', { name: 'Import a file' }))
    expect(await screen.findByText('Import page')).toBeInTheDocument()
  })

  it('starts a blank rule from the rules list, in a sheet', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    const rules = await screen.findByRole('region', { name: 'Rules' })
    await user.click(within(rules).getByRole('button', { name: '+ New rule' }))
    const sheet = screen.getByRole('dialog', { name: 'New rule' })
    expect(within(sheet).getByLabelText('Text to match')).toHaveValue('')
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.actions('create_rule')).toEqual([])
  })

  it('closes the add sheet without adding', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add or import' }))
    await user.click(screen.getByRole('menuitem', { name: 'Add by hand' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the rule sheet from its close button', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    const rules = await screen.findByRole('region', { name: 'Rules' })
    await user.click(within(rules).getByRole('button', { name: '+ New rule' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the other side of a transfer from its sheet', async () => {
    const out = transaction({
      id: 'out',
      date: '2026-11-17',
      name: 'TRANSFER TO SAV',
      displayName: 'Checking to Savings',
      amountCents: 50000,
      transfer: { id: 'in', accountId: 'savings', accountName: 'Savings', date: '2026-11-17' },
    })
    const arrival = transaction({
      ...out,
      id: 'in',
      amountCents: -50000,
      accountId: 'savings',
      accountName: 'Savings',
      transfer: { id: 'out', accountId: 'acct', accountName: 'Checking', date: '2026-11-17' },
    })
    serve({
      list_transactions: (input) => ({
        transactions: input.accountId === 'savings' ? [arrival] : [out],
        total: 1,
      }),
    })
    renderTransactions()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^Checking to Savings/ }))
    const other = await screen.findByRole('button', { name: /Open the other side: Savings/ })
    await waitFor(() => expect(other).toBeEnabled())
    await user.click(other)
    expect(await screen.findByText('Moved from')).toBeInTheDocument()
  })
})
