import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../api/client'
import {
  category,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  transaction,
  type Handlers,
} from '../../test/fake'
import { sourceText } from './TransactionDetails'
import { TransactionSheet } from './TransactionSheet'

const groceries = category('Groceries', { icon: 'cart' })
const coffee = category('coffee shops', { icon: 'coffee' })
const dining = category('Dining out')
const transfers = category('Transfers', { kind: 'transfer' })
const categories = [groceries, coffee, dining, transfers]

const costco = transaction({
  id: 't1',
  date: '2026-11-17',
  name: 'COSTCO WHSE #0681 AURORA CO',
  merchantName: 'Costco',
  amountCents: 8450,
  accountName: 'Chase Sapphire',
  categoryId: groceries.id,
  categorySource: 'manual',
  bankCategory: 'FOOD_AND_DRINK_GROCERIES',
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

/** A server that knows these transactions, each found again by its day and account. */
function serve(
  known: Transaction[],
  handlers: Handlers = {},
  routes: Record<string, () => Response> = {},
) {
  return fakeServer(
    {
      list_transactions: (input) => {
        const found = known.filter(
          (tx) => tx.accountId === input.accountId && tx.date === input.start,
        )
        return { transactions: found, total: found.length }
      },
      update_transaction: (input) => ({ ...known[0]!, ...input }),
      delete_transaction: () => null,
      list_rules: () => [],
      preview_rule: () => ({ matchCount: 4, examples: [], wouldMove: 1, movingFrom: [] }),
      ...handlers,
    },
    routes,
  )
}

/** The names of the choices in a picker, without their icons' letters. */
function choices(list: HTMLElement): (string | null)[] {
  return within(list)
    .getAllByRole('button')
    .map((button) => button.querySelector('.option-label')!.textContent)
}

function renderSheet(tx: Transaction, extra: { onOpen?: () => void; onClose?: () => void } = {}) {
  const onOpen = vi.fn(extra.onOpen)
  const onClose = vi.fn(extra.onClose)
  renderSignedIn(
    <TransactionSheet initial={tx} categories={categories} onOpen={onOpen} onClose={onClose} />,
  )
  return { onOpen, onClose, dialog: screen.getByRole('dialog', { name: tx.displayName }) }
}

describe('TransactionSheet details', () => {
  it('shows the amount, when and where, and where the category came from', async () => {
    serve([costco])
    const { dialog } = renderSheet(costco)
    const sheet = within(dialog)
    expect(sheet.getByText('Today · Chase Sapphire')).toBeInTheDocument()
    expect(sheet.getByText('$84.50')).toHaveClass('money-xl')
    expect(sheet.getByText('Nov 17, 2026')).toBeInTheDocument()
    expect(sheet.getByText('Posted')).toBeInTheDocument()
    expect(sheet.getByRole('button', { name: /Groceries/ })).toHaveTextContent('Set by you')
  })

  it('says when the bank has not posted it yet', () => {
    const pending = { ...costco, pending: true }
    serve([pending])
    const { dialog } = renderSheet(pending)
    expect(within(dialog).getByText('Pending')).toBeInTheDocument()
  })

  it("keeps the bank's own text in closed bank details", async () => {
    serve([costco])
    const { dialog } = renderSheet(costco)
    const details = dialog.querySelector('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('COSTCO WHSE #0681 AURORA CO')).toBeInTheDocument()
    expect(within(details).getByText('food and drink groceries')).toBeInTheDocument()
    expect(within(details).getByText('Your bank feed')).toBeInTheDocument()
  })

  it('says where each category came from', () => {
    const partner = { id: 'p', accountId: 'a', accountName: 'Savings', date: '2026-11-17' }
    expect(sourceText({ categorySource: 'rule', transfer: null })).toBe('Set by a rule')
    expect(sourceText({ categorySource: 'provider', transfer: null })).toBe('From your bank')
    expect(sourceText({ categorySource: 'provider', transfer: partner })).toBe(
      'Matched with its other side',
    )
    expect(sourceText({ categorySource: null, transfer: null })).toBe('Not sorted yet')
  })
})

describe('TransactionSheet category', () => {
  it('lists categories A to Z, whatever their case, and files the pick at once', async () => {
    const server = serve([costco])
    const release = holdRequest('/api/actions/update_transaction')
    const { dialog } = renderSheet(costco)
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: /Groceries/ }))
    const list = within(dialog).getByRole('list', { name: 'Category for Costco' })
    expect(choices(list)).toEqual(['coffee shops', 'Dining out', 'Groceries', 'Transfers'])
    expect(within(list).getByRole('button', { name: 'Groceries' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(within(list).getByRole('button', { name: 'Dining out' }))
    // Shown before the server answers.
    expect(within(dialog).getByRole('button', { name: /Dining out/ })).toBeInTheDocument()
    release()
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([{ id: 't1', categoryId: dining.id }]),
    )
  })

  it('goes back to the saved category when saving the pick fails', async () => {
    serve([costco], {}, { '/api/actions/update_transaction': failing('Database is down') })
    const { dialog } = renderSheet(costco)
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: /Groceries/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Dining out' }))
    expect(await within(dialog).findByText('Database is down')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Groceries/ })).toBeInTheDocument()
  })

  it('saves nothing when the same category is picked again, and goes back to details', async () => {
    const server = serve([costco])
    const { dialog } = renderSheet(costco)
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: /Groceries/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Back to details' }))
    await user.click(within(dialog).getByRole('button', { name: /Groceries/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Groceries' }))
    expect(within(dialog).getByText('Set by you')).toBeInTheDocument()
    expect(server.actions('update_transaction')).toEqual([])
  })

  it('narrows a long list as the owner types', async () => {
    const many = Array.from({ length: 11 }, (_, i) => category(`Extra ${i}`))
    serve([costco])
    renderSignedIn(
      <TransactionSheet
        initial={costco}
        categories={[...categories, ...many]}
        onOpen={() => {}}
        onClose={() => {}}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Groceries/ }))
    await user.type(screen.getByLabelText('Find a category'), 'din')
    const list = screen.getByRole('list', { name: 'Category for Costco' })
    expect(choices(list)).toEqual(['Dining out'])
    await user.type(screen.getByLabelText('Find a category'), 'zzz')
    expect(screen.getByText('No category matches.')).toBeInTheDocument()
  })

  it('hands a category picked by hand back to the rules', async () => {
    const server = serve([costco])
    const { dialog } = renderSheet(costco)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Let rules decide again' }))
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([{ id: 't1', categoryId: null }]),
    )
  })
})

describe('TransactionSheet rule', () => {
  it('makes a rule for every transaction like this one, from its clean name', async () => {
    const server = serve([costco])
    const { dialog } = renderSheet(costco)
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: 'Always categorize Costco as…' }))
    const form = within(dialog).getByRole('form', { name: 'New rule' })
    expect(within(form).getByLabelText('Text to match')).toHaveValue('Costco')
    expect(within(form).getByLabelText('Category for matches')).toHaveValue(groceries.id)
    // The sheet has its own close button, so the form shows none.
    expect(within(form).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await waitFor(() => expect(server.actions('preview_rule')).not.toHaveLength(0))

    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByText('Set by you')).toBeInTheDocument()
    expect(server.actions('create_rule')).toEqual([])
  })

  it('saves the rule and goes back to the details, ready for Escape to close it', async () => {
    const server = serve([costco], {
      create_rule: (input) => ({ rule: { id: 'r1', position: 0, ...input }, recategorized: 3 }),
    })
    const { dialog, onClose } = renderSheet(costco)
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: 'Always categorize Costco as…' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save rule and apply' }))
    await waitFor(() =>
      expect(server.actions('create_rule')).toMatchObject([
        { pattern: 'Costco', categoryId: groceries.id },
      ]),
    )
    expect(await within(dialog).findByText('Set by you')).toBeInTheDocument()
    // The saved form is gone, so focus is back on the sheet itself.
    expect(dialog).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers no rule for money moved between accounts', () => {
    const move = { ...costco, categoryId: transfers.id, categorySource: 'provider' as const }
    serve([move])
    const { dialog } = renderSheet(move)
    expect(within(dialog).queryByRole('button', { name: /Always categorize/ })).toBeNull()
    expect(within(dialog).getByText('Transfer')).toHaveClass('pill-quiet')
  })
})

describe('TransactionSheet note, totals and delete', () => {
  it('saves a note when the field is left, and leaves the transaction out of totals', async () => {
    const server = serve([costco])
    const { dialog } = renderSheet(costco)
    const user = userEvent.setup()
    await user.type(within(dialog).getByLabelText('Note'), 'Party food')
    await user.tab()
    await user.click(within(dialog).getByRole('switch', { name: 'Leave out of totals' }))
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([
        { id: 't1', note: 'Party food' },
        { id: 't1', excluded: true },
      ]),
    )
    expect(within(dialog).queryByRole('button', { name: 'Delete transaction' })).toBeNull()
  })

  it('clears a note, and saves nothing when the note did not change', async () => {
    const noted = { ...costco, note: 'Party food' }
    const server = serve([noted])
    const { dialog } = renderSheet(noted)
    const user = userEvent.setup()
    await user.click(within(dialog).getByLabelText('Note'))
    await user.tab()
    expect(server.actions('update_transaction')).toEqual([])
    await user.clear(within(dialog).getByLabelText('Note'))
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_transaction')).toEqual([{ id: 't1', note: null }]),
    )
  })

  it('shows the latest saved copy, such as a transaction now left out', async () => {
    serve([{ ...costco, excluded: true }])
    const { dialog } = renderSheet(costco)
    expect(await within(dialog).findByText('Not counted in totals')).toBeInTheDocument()
  })

  it('deletes one added by hand and closes', async () => {
    const cash = transaction({
      id: 'cash',
      date: '2026-11-16',
      name: 'Farmers market',
      manual: true,
      source: 'manual',
      pending: false,
    })
    const server = serve([cash])
    const { dialog, onClose } = renderSheet(cash)
    expect(within(dialog).getByText('Added by hand')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete transaction' }))
    await waitFor(() => expect(server.actions('delete_transaction')).toEqual([{ id: 'cash' }]))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('says a transaction was imported from a file', () => {
    const imported = transaction({
      id: 'imp',
      date: '2026-11-15',
      name: 'Old rent',
      source: 'import',
    })
    serve([imported])
    const { dialog } = renderSheet(imported)
    expect(within(dialog).getByText('Imported from a file')).toBeInTheDocument()
  })
})

describe('TransactionSheet transfer', () => {
  const out = transaction({
    id: 'out',
    date: '2026-11-16',
    name: 'ONLINE TRANSFER TO SAV ...9921',
    displayName: 'Chase Checking to Chase Savings',
    amountCents: 50000,
    accountId: 'checking',
    accountName: 'Chase Checking',
    categoryId: transfers.id,
    categorySource: 'provider',
    transfer: { id: 'in', accountId: 'savings', accountName: 'Chase Savings', date: '2026-11-17' },
  })
  const arrival = transaction({
    ...out,
    id: 'in',
    date: '2026-11-17',
    amountCents: -50000,
    accountId: 'savings',
    accountName: 'Chase Savings',
    transfer: {
      id: 'out',
      accountId: 'checking',
      accountName: 'Chase Checking',
      date: '2026-11-16',
    },
  })

  it('names the other side and opens it', async () => {
    serve([out, arrival])
    const { dialog, onOpen } = renderSheet(out)
    expect(within(dialog).getByText('$500.00')).toHaveClass('money-muted')
    expect(within(dialog).getByText('Matched with its other side')).toBeInTheDocument()
    const other = await within(dialog).findByRole('button', {
      name: 'Open the other side: Chase Savings, Nov 17, 2026',
    })
    expect(within(dialog).getByText('Moved to')).toBeInTheDocument()
    await waitFor(() => expect(other).toBeEnabled())
    await userEvent.click(other)
    expect(onOpen).toHaveBeenCalledWith(arrival)
  })

  it('says where money came from on the arriving side', () => {
    serve([out, arrival])
    const { dialog } = renderSheet(arrival)
    expect(within(dialog).getByText('Moved from')).toBeInTheDocument()
  })

  it('waits for the other side before it can be opened', () => {
    serve([out])
    const { dialog } = renderSheet(out)
    expect(within(dialog).getByRole('button', { name: /Open the other side/ })).toBeDisabled()
  })
})
