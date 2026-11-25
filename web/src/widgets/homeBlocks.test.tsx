// Home's blocks under the accounts: the bills coming up before payday, the
// latest activity and the row of tab cards. Each opens the page a tap deeper
// where its figures are explained and acted on, never acting on Home itself.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  budgetFor,
  category,
  failing,
  fakeServer,
  renderSignedIn,
  settingsHandlers,
  transaction,
} from '../test/fake'
import { cashFlow } from '../test/planning'
import { ComingUpWidget } from './ComingUp'
import { LatestActivityWidget } from './LatestActivity'
import { TabRowWidget } from './TabRow'

afterEach(() => vi.unstubAllGlobals())

/** The card by its name, once loaded: then its one link, to the page a tap deeper, is there. */
function loaded(name: string) {
  return waitFor(() => {
    const region = screen.getByRole('region', { name })
    within(region).getByRole('link')
    return region
  })
}

/** A bill due before payday, as get_cash_flow lists it. */
const due = (name: string, dueDate: string, amountCents: number, overdue = false) => ({
  billId: `bill-${name.toLowerCase()}`,
  name,
  dueDate,
  amountCents,
  overdue,
})

describe('Coming up before payday', () => {
  const NAME = 'Coming up before payday'

  it('lists the bills due before payday, soonest first, and opens the bills', async () => {
    const billsDue = [due('Phone', '2026-11-20', 6000), due('Rent', '2026-11-25', 180000)]
    fakeServer({ get_cash_flow: () => cashFlow({ billsDue }) })
    renderSignedIn(<ComingUpWidget />)
    const card = await loaded(NAME)
    const rows = card.querySelectorAll('.coming-up-row')
    expect([...rows].map((row) => row.textContent)).toEqual([
      'Nov 20Phone$60.00',
      'Nov 25Rent$1,800.00',
    ])
    expect(card).toHaveTextContent('Payday Fri, Nov 27')
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/payday/bills')
  })

  it('shows three at most, and says how many more come before payday', async () => {
    const billsDue = ['A', 'B', 'C', 'D', 'E'].map((name, i) => due(name, `2026-11-2${i}`, 1000))
    fakeServer({ get_cash_flow: () => cashFlow({ billsDue }) })
    renderSignedIn(<ComingUpWidget />)
    const card = await loaded(NAME)
    expect(card.querySelectorAll('.coming-up-row')).toHaveLength(3)
    expect(card).toHaveTextContent('2 more before payday, Fri, Nov 27')
  })

  it('marks a bill past its date with no payment found, the one red', async () => {
    fakeServer({
      get_cash_flow: () => cashFlow({ billsDue: [due('Gym', '2026-11-12', 4000, true)] }),
    })
    renderSignedIn(<ComingUpWidget />)
    const card = await loaded(NAME)
    expect(within(card).getByText('No payment found')).toHaveClass('over')
    expect(card.querySelector('.money-problem')).toBeNull()
  })

  it('says so in one calm line, opening the bills, when nothing is due', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ billsDue: [], billsDueCents: 0 }) })
    renderSignedIn(<ComingUpWidget />)
    const line = await screen.findByRole('link', { name: /No bills due/ })
    expect(line).toHaveTextContent('No bills due before payday, Fri, Nov 27')
    expect(line).toHaveAttribute('href', '/payday/bills')
    expect(screen.queryByRole('region', { name: NAME })).not.toBeInTheDocument()
  })

  it('says why the bills could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/get_cash_flow': failing('Database is down') },
    )
    renderSignedIn(<ComingUpWidget />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(within(screen.getByRole('region', { name: NAME })).queryByRole('link')).toBeNull()
  })
})

describe('Latest activity', () => {
  const NAME = 'Latest activity'
  const groceries = category('Groceries')
  const budget = budgetFor([groceries], [])

  it('lists the newest four with merchant, category and amount, and opens Activity', async () => {
    const latest = [
      transaction({
        id: 't1',
        date: '2026-11-16',
        name: 'COSTCO #12',
        amountCents: 8450,
        categoryId: groceries.id,
      }),
      // Filed under a transfer category the budget leaves out: a move, never spending.
      transaction({ id: 't2', date: '2026-11-15', name: 'To savings', categoryId: 'cat-move' }),
      transaction({ id: 't3', date: '2026-11-15', name: 'Refund', amountCents: -2500 }),
    ]
    const fake = fakeServer({
      list_transactions: () => ({ transactions: latest, total: latest.length }),
    })
    renderSignedIn(<LatestActivityWidget budget={budget} />)
    const card = await loaded(NAME)
    expect(fake.actions('list_transactions')).toEqual([{ limit: 4 }])
    const lines = card.querySelectorAll('.tx-line')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toHaveTextContent('Groceries')
    expect(lines[0]).toHaveTextContent('$84.50')
    expect(lines[1]).toHaveTextContent('Transfer')
    expect(lines[1]!.querySelector('.money')).toHaveClass('money-muted')
    // Money in reads green, with its plus.
    expect(lines[2]!.querySelector('.money')).toHaveClass('money-in')
    expect(lines[2]).toHaveTextContent('+$25.00')
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/spending/activity')
  })

  it('says so when there are no transactions yet', async () => {
    fakeServer({ list_transactions: () => ({ transactions: [], total: 0 }) })
    renderSignedIn(<LatestActivityWidget budget={budget} />)
    const card = await screen.findByRole('region', { name: NAME })
    expect(await within(card).findByText('No transactions yet.')).toBeInTheDocument()
  })

  it('says why the activity could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/list_transactions': failing('Database is down') },
    )
    renderSignedIn(<LatestActivityWidget budget={budget} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})

describe('the tab row', () => {
  it('shows the four tab cards in the map order, each in its own tab color, opening its tab', async () => {
    fakeServer({
      get_cash_flow: () => cashFlow(),
      list_goals: () => [],
      get_net_worth: () => ({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] }),
      get_spending_pace: () => ({
        start: '2026-11-01',
        end: '2026-11-30',
        days: 30,
        categoryIds: [],
        budgetCents: 0,
        cumulative: [],
        projectedCents: 0,
      }),
    })
    renderSignedIn(<TabRowWidget />)
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4))
    const slots = [...document.querySelectorAll<HTMLElement>('.tab-row > .tab-row-slot')]
    expect(slots.map((slot) => slot.dataset.place)).toEqual(['pay', 'spend', 'goal', 'wealth'])
    expect(
      slots.map((slot) => [
        slot.querySelector('section')!.getAttribute('aria-label'),
        within(slot).getByRole('link').getAttribute('href'),
      ]),
    ).toEqual([
      ['Cash to payday', '/payday'],
      ['Spending pace', '/spending'],
      ['Your top goal', '/goals'],
      ['Net worth', '/wealth'],
    ])
  })
})
