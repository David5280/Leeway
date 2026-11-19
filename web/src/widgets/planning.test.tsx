import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { bill, cashFlow, debtPlans, goal } from '../test/planning'
import { BillsWidget, CashFlowWidget, DebtsWidget, GoalsWidget, NetWorthWidget } from './Planning'

afterEach(() => vi.unstubAllGlobals())

const card = {
  id: 'card',
  name: 'Rewards card',
  balanceCents: 200000,
  aprBps: 2499,
  minimumCents: 6000,
}

describe('Until payday widget', () => {
  it('shows the per-day amount without the list of bills, and links to the plan', async () => {
    fakeServer({ get_cash_flow: () => cashFlow() })
    renderSignedIn(<CashFlowWidget />)
    const widget = await screen.findByRole('region', { name: 'Until payday' })
    expect(await within(widget).findByText(/a day for the next/)).toHaveTextContent(
      '$144 a day for the next 10 days.',
    )
    expect(within(widget).queryByText('Phone')).not.toBeInTheDocument()
    expect(within(widget).getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan')
  })
})

describe('Bills widget', () => {
  it('lists the next five bills with when each is due', async () => {
    const bills = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) =>
      bill({ name: `Bill ${name}`, amountCents: 1000, anchorDate: `2026-12-0${i + 1}` }),
    )
    fakeServer({ list_bills: () => ({ bills, monthlyCents: 6000, subscriptionsMonthlyCents: 0 }) })
    renderSignedIn(<BillsWidget />)
    const widget = within(await screen.findByRole('region', { name: 'Bills' }))
    expect(await widget.findByText('Bill A')).toBeInTheDocument()
    expect(widget.getByText('Bill E').parentElement).toHaveTextContent('Bill EDue Dec 5$10.00')
    expect(widget.queryByText('Bill F')).not.toBeInTheDocument()
  })

  it('says when there are none', async () => {
    fakeServer({ list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }) })
    renderSignedIn(<BillsWidget />)
    expect(await screen.findByText('No bills tracked yet.')).toBeInTheDocument()
  })

  it('shows why bills could not load', async () => {
    fakeServer({}, { '/api/actions/list_bills': failing('Database is down', 500) })
    renderSignedIn(<BillsWidget />)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('Goals widget', () => {
  it('shows the first four goals with their progress', async () => {
    const goals = ['Trip', 'Car', 'House', 'Bike', 'Boat'].map((name) =>
      goal({ name, targetCents: 100000, savedCents: 25000 }),
    )
    fakeServer({ list_goals: () => goals })
    renderSignedIn(<GoalsWidget />)
    const widget = within(await screen.findByRole('region', { name: 'Goals' }))
    expect(await widget.findByText('Trip')).toBeInTheDocument()
    expect(widget.getByText('Trip').parentElement).toHaveTextContent('$250 of $1,000')
    expect(widget.getAllByRole('progressbar')).toHaveLength(4)
    expect(widget.queryByText('Boat')).not.toBeInTheDocument()
  })

  it('gives what each goal needs per period and whether it is on track', async () => {
    const quick = { savedThisPeriodCents: 0, recentSavedCents: 60000, recentDays: 90 }
    const goals = [
      goal(
        { name: 'Bike', targetCents: 120000, savedCents: 30000, targetDate: '2027-04-30' },
        quick,
      ),
      goal({ name: 'Trip', targetCents: 120000, savedCents: 30000, targetDate: '2027-04-30' }),
      goal({ name: 'House', targetCents: 100000 }),
    ]
    fakeServer({ list_goals: () => goals })
    renderSignedIn(<GoalsWidget />)
    const widget = within(await screen.findByRole('region', { name: 'Goals' }))
    expect(await widget.findByText('$150 each month, on track')).toHaveClass('good')
    expect(widget.getByText('$150 each month, behind')).toHaveClass('warn')
    expect(widget.getByText('$1,000 to go')).toHaveClass('muted')
    expect(widget.getByRole('link', { name: 'Save for a purchase' })).toHaveAttribute(
      'href',
      '/plan/goals?new=purchase',
    )
  })

  it('says when there are none', async () => {
    fakeServer({ list_goals: () => [] })
    renderSignedIn(<GoalsWidget />)
    expect(await screen.findByText('No savings goals yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Save for a purchase' })).toBeInTheDocument()
  })
})

describe('Debt payoff widget', () => {
  it('shows when the debts are gone with no extra payment', async () => {
    const server = fakeServer({ plan_debt_payoff: () => debtPlans([card]) })
    renderSignedIn(<DebtsWidget />)
    const widget = within(await screen.findByRole('region', { name: 'Debt payoff' }))
    expect(await widget.findByText(/Debt free in/)).toHaveTextContent(
      'Debt free in 4 years 10 months, paying $60 a month on $2,000 owed.',
    )
    expect(server.actions('plan_debt_payoff')).toEqual([{ extraCents: 0 }])
  })

  it('says when payments never clear the debt', async () => {
    fakeServer({
      plan_debt_payoff: () => debtPlans([{ ...card, aprBps: 3000, minimumCents: 3000 }]),
    })
    renderSignedIn(<DebtsWidget />)
    expect(await screen.findByText('Not at these payments')).toBeInTheDocument()
  })

  it('asks for interest rates when none are known', async () => {
    fakeServer({
      plan_debt_payoff: () =>
        debtPlans([], 0, [{ id: 'loan', name: 'Loan', missing: ['aprPercent'] }]),
    })
    renderSignedIn(<DebtsWidget />)
    expect(await screen.findByText(/Add interest rates/)).toBeInTheDocument()
  })

  it('says there is nothing owed', async () => {
    fakeServer({ plan_debt_payoff: () => debtPlans([]) })
    renderSignedIn(<DebtsWidget />)
    expect(await screen.findByText('No debts with a balance.')).toBeInTheDocument()
  })
})

describe('Net worth widget', () => {
  it('shows the number and a line of the last year', async () => {
    const server = fakeServer({
      get_net_worth: () => ({
        assetsCents: 900000,
        liabilitiesCents: 200000,
        netWorthCents: 700000,
        history: [
          { date: '2026-01-01', netWorthCents: 500000 },
          { date: '2026-11-17', netWorthCents: 700000 },
        ],
      }),
    })
    renderSignedIn(<NetWorthWidget />)
    const widget = within(await screen.findByRole('region', { name: 'Net worth' }))
    expect(await widget.findByText('$7,000')).toBeInTheDocument()
    expect(widget.getByRole('img', { name: 'Net worth over the last year' })).toBeInTheDocument()
    expect(server.actions('get_net_worth')).toEqual([{ days: 365 }])
  })

  it('marks a negative net worth and leaves out a line with one point', async () => {
    fakeServer({
      get_net_worth: () => ({
        assetsCents: 0,
        liabilitiesCents: 5000,
        netWorthCents: -5000,
        history: [{ date: '2026-11-17', netWorthCents: -5000 }],
      }),
    })
    renderSignedIn(<NetWorthWidget />)
    expect(await screen.findByText('−$50')).toHaveClass('money-problem')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
