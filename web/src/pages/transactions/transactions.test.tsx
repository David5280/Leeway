import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category, fakeServer, renderSignedIn, transaction } from '../../test/fake'
import { Transactions } from '../Transactions'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000 })
const categories = [groceries]

const costco = transaction({
  id: 't1',
  date: '2026-11-17',
  name: 'COSTCO #12',
  merchantName: 'Costco',
  categoryId: groceries.id,
})
const unfiled = transaction({ id: 't2', date: '2026-11-16', name: 'SWEET COW' })

function serve() {
  return fakeServer({
    get_budget: () => budgetFor(categories, []),
    list_categories: () => categories,
    list_rules: () => [],
    list_transactions: (input) =>
      input.categoryId === 'uncategorized'
        ? { transactions: [unfiled], total: 1 }
        : { transactions: [costco, unfiled], total: 2 },
  })
}

/** Shows the address's query string, where the category filter lives. */
function Address() {
  return <p>Address: {useLocation().search || 'none'}</p>
}

function renderTransactions(route = '/transactions') {
  return renderSignedIn(
    <>
      <Transactions />
      <Address />
    </>,
    { route },
  )
}

/** The category ids the full list was asked for, newest last (the chip's count query aside). */
function listedCategories(server: ReturnType<typeof serve>) {
  return server
    .actions('list_transactions')
    .filter((input) => (input as { limit: number }).limit > 1)
    .map((input) => (input as { categoryId?: string }).categoryId)
}

describe('transactions category filter', () => {
  it('filters by a category picked from the list, and keeps it in the address', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.selectOptions(screen.getByLabelText('Category filter'), groceries.id)
    expect(screen.getByText(`Address: ?category=${groceries.id}`)).toBeInTheDocument()
    await waitFor(() => expect(listedCategories(server).at(-1)).toBe(groceries.id))

    await user.selectOptions(screen.getByLabelText('Category filter'), 'All categories')
    expect(screen.getByText('Address: none')).toBeInTheDocument()
    await waitFor(() => expect(listedCategories(server).at(-1)).toBeUndefined())
  })

  it('shows only what needs a category while the chip is on, and everything once it is off', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    const chip = await screen.findByRole('button', { name: '1 need a category' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Address: ?category=uncategorized')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Costco')).not.toBeInTheDocument())
    expect(listedCategories(server).at(-1)).toBe('uncategorized')

    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText('Costco')).toBeInTheDocument()
  })

  it('keeps other parts of the address when the filter changes', async () => {
    serve()
    renderTransactions('/transactions?from=overview')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '1 need a category' }))
    expect(screen.getByText('Address: ?from=overview&category=uncategorized')).toBeInTheDocument()
  })
})

describe('transactions rules', () => {
  it('closes a rule started from a transaction without saving it', async () => {
    const server = serve()
    renderTransactions()
    const user = userEvent.setup()
    await screen.findByText('Costco')
    await user.click(screen.getAllByRole('button', { name: 'Make a rule' })[0]!)
    const form = screen.getByRole('form', { name: 'New rule' })
    await user.click(within(form).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument()
    expect(server.actions('create_rule')).toEqual([])
  })

  it('starts a blank rule from the rules list', async () => {
    serve()
    renderTransactions()
    const user = userEvent.setup()
    const rules = await screen.findByRole('region', { name: 'Rules' })
    await user.click(within(rules).getByRole('button', { name: '+ New rule' }))
    const form = screen.getByRole('form', { name: 'New rule' })
    expect(within(form).getByRole('heading', { name: 'New rule' })).toBeInTheDocument()
    expect(within(form).getByLabelText('Text to match')).toHaveValue('')
  })
})
