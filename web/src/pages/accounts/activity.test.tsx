// What the accounts picked on Compare accounts did together: the summary in
// words, money in and out, spending by category and recent transactions.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsView } from '../../api/client'
import { everyAccount, groceries, renderCompare, server } from '../../test/accounts'
import { account, accountsViewFor, transaction } from '../../test/fake'

type CategorySpending = AccountsView['spending'][number]

afterEach(() => vi.unstubAllGlobals())

describe('the activity of the picked accounts', () => {
  it('sums up the accounts in words', async () => {
    server()
    renderCompare()
    const summary = await screen.findByRole('region', { name: 'Summary' })
    expect(summary).toHaveTextContent('$11,400 available across 2 checking and savings accounts.')
  })

  it('answers whether more came in than went out, period by period', async () => {
    server()
    renderCompare()
    const flows = await screen.findByRole('region', { name: 'Money in and out' })
    // November so far: $2,500 in, $1,200 out.
    expect(flows).toHaveTextContent('Yes so far: +$1,300 left over this period.')
    expect(flows).toHaveTextContent('November 2026, so far')
    expect(
      within(flows).getByRole('progressbar', { name: 'In, November 2026: $2,500' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('+$2,500', { selector: '.flow-amount' })[0]).toHaveClass('money-in')

    await userEvent.click(within(flows).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Money in and out' })
    expect(within(sheet).getByRole('region', { name: 'Compared with usual' })).toHaveTextContent(
      '$1,600 less than the last period',
    )
  })

  it('says plainly when more went out than came in', async () => {
    const flows = [{ start: '2026-11-01', end: '2026-11-30', inCents: 100000, outCents: 140000 }]
    server(everyAccount, { summarize_accounts: () => accountsViewFor(everyAccount, { flows }) })
    renderCompare()
    expect(await screen.findByRole('region', { name: 'Money in and out' })).toHaveTextContent(
      'Not so far: $400 more went out than came in this period.',
    )
  })

  it('lists spending by category, summing past the top six', async () => {
    const spending: CategorySpending[] = Array.from({ length: 8 }, (_, index) => ({
      categoryId: `cat-${index}`,
      name: `Category ${index}`,
      color: '#3987E5',
      spentCents: (8 - index) * 1000,
    }))
    spending.push({ categoryId: null, name: 'Needs a category', color: null, spentCents: 500 })
    server(everyAccount, { summarize_accounts: () => accountsViewFor(everyAccount, { spending }) })
    renderCompare()
    const card = await screen.findByRole('region', { name: 'Spending by category' })
    expect(within(card).getByText('Where did the money go?')).toBeInTheDocument()
    expect(within(card).getByText('Category 0')).toBeInTheDocument()
    expect(within(card).queryByText('Category 6')).not.toBeInTheDocument()
    // Two categories of $20 and $10, and $5 with no category: $35 in all.
    expect(within(card).getByText('Everything else').parentElement).toHaveTextContent('$35')

    await userEvent.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Spending by category' })
    expect(within(sheet).getByRole('link', { name: /Needs a category/ })).toHaveAttribute(
      'href',
      '/spending/activity?category=uncategorized',
    )
  })

  it('leaves out money in and out before there is a period of it', async () => {
    server(everyAccount, {
      summarize_accounts: () => accountsViewFor(everyAccount, { flows: [] }),
    })
    renderCompare()
    await screen.findByRole('region', { name: 'Spending by category' })
    expect(screen.queryByRole('region', { name: 'Money in and out' })).not.toBeInTheDocument()
  })

  it('says when nothing has been spent yet', async () => {
    server()
    renderCompare()
    expect(await screen.findByRole('region', { name: 'Spending by category' })).toHaveTextContent(
      'No spending yet this period.',
    )
  })

  it('lists recent transactions with their categories', async () => {
    const recent = [
      transaction({ id: 't1', date: '2026-11-12', name: 'MARKET', categoryId: groceries.id }),
      transaction({ id: 't2', date: '2026-11-10', name: 'MOVE', categoryId: 'cat-transfer' }),
      transaction({ id: 't3', date: '2026-11-09', name: 'MYSTERY', categoryId: null }),
    ]
    server(everyAccount, { summarize_accounts: () => accountsViewFor(everyAccount, { recent }) })
    renderCompare()
    const card = await screen.findByRole('region', { name: 'Recent transactions' })
    expect(await within(card).findByText('Nov 12 · Groceries')).toBeInTheDocument()
    // A category the list does not know is a transfer.
    expect(within(card).getByText('Nov 10 · Transfer')).toBeInTheDocument()
    expect(within(card).getByText('Nov 9 · Needs a category')).toBeInTheDocument()
  })

  it('says when there are no transactions yet', async () => {
    server()
    renderCompare()
    expect(await screen.findByRole('region', { name: 'Recent transactions' })).toHaveTextContent(
      'No transactions yet.',
    )
  })

  it('says in the summary when an account the bank no longer shares is left out', async () => {
    const old = account({
      id: 'dddddddd-0000-4000-8000-000000000004',
      name: 'Old savings',
      institutionName: 'Chase',
      subtype: 'savings',
      unsharedAt: '2026-11-04T15:00:00Z',
    })
    server([...everyAccount, old])
    renderCompare()
    expect(
      await screen.findByText(
        'Old savings is no longer shared from Chase and is left out of these figures.',
      ),
    ).toBeInTheDocument()
  })
})
