import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../api/client'
import { category, fakeServer, renderSignedIn, transaction } from '../../test/fake'
import { ActivityList, ActivityRow } from './ActivityList'

const coffee = category('Coffee', { icon: 'coffee', color: '#B5651D' })
const pay = category('Paycheck', { kind: 'income' })
const moves = category('Transfers', { kind: 'transfer' })
const categories = new Map([coffee, pay, moves].map((c) => [c.id, c]))

const blueBottle = transaction({
  id: 'bb',
  date: '2026-11-17',
  name: 'SQ *BLUE BOTTLE 0412',
  amountCents: 575,
  categoryId: coffee.id,
  accountName: 'Chase Total Checking',
  pending: true,
})
const paycheck = transaction({
  id: 'pay',
  date: '2026-11-17',
  name: 'ACME PAYROLL',
  amountCents: -250000,
  categoryId: pay.id,
})
const toSavings = transaction({
  id: 'move',
  date: '2026-11-16',
  name: 'ONLINE TRANSFER TO SAV ...9921',
  displayName: 'Chase Checking to Chase Savings',
  amountCents: 50000,
  // The server pairs only transfers filed under a transfer category.
  categoryId: moves.id,
  transfer: { id: 'other', accountId: 'savings', accountName: 'Chase Savings', date: '2026-11-16' },
})
const leftOut = transaction({
  id: 'out',
  date: '2026-11-16',
  name: 'REFUNDABLE DEPOSIT',
  amountCents: 10000,
  excluded: true,
})
const unsorted = transaction({
  id: 'unsorted',
  date: '2026-11-15',
  name: 'MILE HIGH FLEA',
  amountCents: 2200,
})

beforeEach(() => {
  // Day headers read "Today" and "Yesterday" from the owner's own date.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
  fakeServer({})
})
afterEach(() => vi.useRealTimers())

function renderList(transactions: Transaction[], complete = true, onOpen = vi.fn()) {
  renderSignedIn(
    <ActivityList
      transactions={transactions}
      categories={categories}
      complete={complete}
      onOpen={onOpen}
    />,
  )
  return onOpen
}

describe('ActivityList', () => {
  it('groups rows under days named as people say them, each with its net', async () => {
    renderList([blueBottle, paycheck, toSavings, leftOut, unsorted])
    const today = await screen.findByRole('region', { name: 'Today' })
    // $5.75 spent and $2,500 in: the day brought money in, so its net is green with a "+".
    expect(within(today).getByRole('heading')).toHaveTextContent('Today+$2,494.25')
    expect(within(today).getByText('+$2,494.25')).toHaveClass('money-in')

    // A transfer and a transaction left out of totals move no day's net.
    const yesterday = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(yesterday).getByRole('heading')).toHaveTextContent(/^Yesterday$/)

    const older = screen.getByRole('region', { name: 'Sun, Nov 15' })
    expect(within(older).getByText('$22.00', { selector: 'h2 *' })).toHaveClass('money-muted')
  })

  it('leaves out the net of the last day while older transactions are still to load', async () => {
    renderList([blueBottle, unsorted], false)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByRole('heading')).toHaveTextContent('Today$5.75')
    const last = screen.getByRole('region', { name: 'Sun, Nov 15' })
    expect(within(last).getByRole('heading')).toHaveTextContent(/^Sun, Nov 15$/)
  })

  it('counts a transaction whose category is gone as spending', async () => {
    renderList([{ ...unsorted, categoryId: 'deleted' }])
    const day = await screen.findByRole('region', { name: 'Sun, Nov 15' })
    expect(within(day).getByRole('heading')).toHaveTextContent('Sun, Nov 15$22.00')
  })

  it('opens the transaction a row stands for', async () => {
    const onOpen = renderList([blueBottle, paycheck])
    await userEvent.click(await screen.findByRole('button', { name: /^Acme Payroll/ }))
    expect(onOpen).toHaveBeenCalledWith(paycheck)
  })
})

describe('ActivityRow', () => {
  function renderRow(tx: Transaction, categoryId = tx.categoryId) {
    renderSignedIn(
      <ul>
        <ActivityRow
          tx={tx}
          category={categoryId ? categories.get(categoryId) : undefined}
          onOpen={() => {}}
        />
      </ul>,
    )
  }

  it('reads everything it shows in its label', async () => {
    renderRow(blueBottle)
    const row = await screen.findByRole('button', {
      name: 'Blue Bottle, spent $5.75, Chase Total Checking, Coffee, pending',
    })
    expect(within(row).getByText('Blue Bottle')).toHaveClass('act-row-name')
    expect(within(row).getByText('Chase Total Checking')).toBeInTheDocument()
    expect(within(row).getByText('Pending')).toHaveClass('pill-quiet')
    // Ordinary spending is not colored and has no sign.
    expect(within(row).getByText('$5.75')).toHaveClass('money-neutral')
  })

  it('shows money in green with a plus', async () => {
    renderRow(paycheck)
    expect(await screen.findByText('+$2,500.00')).toHaveClass('money-in')
  })

  it('shows a paired transfer as a neutral move, with no sign and the swap icon', async () => {
    renderRow(toSavings)
    const row = await screen.findByRole('button', { name: /moved \$500\.00/ })
    expect(within(row).getByText('$500.00')).toHaveClass('money-muted')
    expect(row.querySelector('.icon-badge')).toHaveStyle({ '--c': '#8390A2' })
  })

  it('marks a transaction that still needs a category, and one left out of totals', async () => {
    renderRow({ ...unsorted, excluded: true })
    const row = await screen.findByRole('button', {
      name: 'Mile High Flea, spent $22.00, Checking, needs a category, not counted in totals',
    })
    expect(row.querySelector('.icon-badge')).toHaveClass('unsorted')
    expect(within(row).getByText('Not counted')).toBeInTheDocument()
  })
})
