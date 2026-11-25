import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { bill, cashFlow, debtPlans, goal } from '../test/planning'
import { BillsWidget, CashFlowWidget, DebtsWidget, GoalsWidget, NetWorthWidget } from './Planning'
import { worthPoint } from '../test/worth'

afterEach(() => vi.unstubAllGlobals())

const card = {
  id: 'card',
  name: 'Rewards card',
  balanceCents: 200000,
  aprBps: 2499,
  minimumCents: 6000,
}

/** Opens the card's drill-down and returns what it says it adds up to. */
async function openMath(card: HTMLElement, title: string) {
  await userEvent.click(within(card).getByRole('button'))
  const sheet = screen.getByRole('dialog', { name: title })
  return within(sheet).getByRole('region', { name: 'How it adds up' })
}

describe('Until payday widget', () => {
  it('asks whether the cash lasts, shows what is safe to spend, and opens its math', async () => {
    fakeServer({ get_cash_flow: () => cashFlow() })
    renderSignedIn(<CashFlowWidget />)
    expect(await screen.findByText(/safe to spend until payday/)).toHaveTextContent(
      '$1,440 safe to spend until payday, after bills.',
    )
    const widget = screen.getByRole('region', { name: 'Until payday' })
    expect(
      within(widget).getByRole('heading', { name: 'Will the cash last until payday?' }),
    ).toBeInTheDocument()
    expect(within(widget).queryByText('Phone')).not.toBeInTheDocument()
    expect(within(widget).queryByRole('link')).not.toBeInTheDocument()
    expect(await openMath(widget, 'Until payday')).toHaveTextContent(
      'Safe to spend $1,440 = In checking $1,500 minus bills due before payday $60',
    )
  })

  it('says how short the bills and an overdraft leave you, with the sum behind it', async () => {
    const rent = { billId: 'r', name: 'Rent', dueDate: '2026-11-20', amountCents: 9000 }
    fakeServer({
      get_cash_flow: () =>
        cashFlow({
          cashCents: 0,
          overdraftCents: 500,
          billsDue: [
            { ...rent, overdue: false },
            { ...rent, billId: 'p', name: 'Power', overdue: false },
          ],
          billsDueCents: 18_000,
          safeCents: 0,
          shortfallCents: 18_500,
        }),
    })
    renderSignedIn(<CashFlowWidget />)
    // The card is drawn anew once the numbers arrive, so it is found after them.
    await screen.findByText(/in checking/)
    const widget = screen.getByRole('region', { name: 'Until payday' })
    expect(widget).toHaveTextContent('$185 short of the bills and overdraft due before payday.')
    expect(widget).toHaveTextContent(
      '$0 in checking, minus $180 in bills and $5 to bring an overdraft back to zero.',
    )
  })

  it('says a shortfall before a guessed payday as a maybe, not in red', async () => {
    fakeServer({
      get_cash_flow: () =>
        cashFlow({
          paydaySource: 'detected_income',
          paydayEstimate: true,
          expectedPayCents: 250_000,
          cashCents: 1000,
          billsDueCents: 6000,
          safeCents: 0,
          shortfallCents: 5000,
        }),
    })
    renderSignedIn(<CashFlowWidget />)
    // The card is drawn anew once the numbers arrive, so it is found after them.
    await screen.findByText(/in checking/)
    const widget = screen.getByRole('region', { name: 'Until payday' })
    expect(widget).toHaveTextContent('Maybe $50 short of the bills due before payday.')
    expect(within(widget).getByText('$50', { selector: '.mid-number' })).not.toHaveClass(
      'money-problem',
    )
  })

  it('shows why the cash could not be read', async () => {
    fakeServer({}, { '/api/actions/get_cash_flow': failing('Database is down', 500) })
    renderSignedIn(<CashFlowWidget />)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Until payday' })).toHaveAttribute(
      'data-static',
      'empty',
    )
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
    expect(widget.getByRole('link', { name: /Bill A/ })).toHaveAttribute('href', '/payday/bills')
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
    expect(widget.getByRole('link', { name: /Trip/ })).toHaveAttribute('href', '/goals')
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
      '/goals?new=purchase',
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
    expect(await screen.findByText(/Debt free in/)).toHaveTextContent(
      'Debt free in 4 years 10 months, paying $60 a month on $2,000 owed.',
    )
    expect(server.actions('plan_debt_payoff')).toEqual([{ extraCents: 0 }])
    const math = await openMath(screen.getByRole('region', { name: 'Debt payoff' }), 'Debt payoff')
    expect(math).toHaveTextContent(
      'Paid in all $3,449 = Owed now $2,000 plus interest along the way $1,449',
    )
  })

  it('shows why the plan could not be read', async () => {
    fakeServer({}, { '/api/actions/plan_debt_payoff': failing('Database is down', 500) })
    renderSignedIn(<DebtsWidget />)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
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
  it('answers whether it is growing: the number, how far it came this year, and its line', async () => {
    const server = fakeServer({
      get_net_worth: () => ({
        assetsCents: 900000,
        liabilitiesCents: 200000,
        netWorthCents: 700000,
        history: [worthPoint('2026-01-01', 500000), worthPoint('2026-11-17', 700000)],
      }),
    })
    renderSignedIn(<NetWorthWidget />)
    expect(await screen.findByText('$7,000')).toBeInTheDocument()
    const widget = within(screen.getByRole('region', { name: 'Net worth' }))
    expect(widget.getByText('Is your net worth growing?')).toBeInTheDocument()
    expect(widget.getByText(/^Up/)).toHaveTextContent('Up $2,000 since Jan 2026')
    expect(widget.getByText('$2,000')).toHaveClass('money-in')
    expect(widget.getByRole('img', { name: 'Net worth over the last year' })).toBeInTheDocument()
    expect(server.actions('get_net_worth')).toEqual([{ days: 365 }])
    const math = await openMath(screen.getByRole('region', { name: 'Net worth' }), 'Net worth')
    expect(math).toHaveTextContent(
      'Net worth $7,000 = What you own $9,000 minus what you owe $2,000',
    )
  })

  it('says in red how far it fell', async () => {
    fakeServer({
      get_net_worth: () => ({
        assetsCents: 300000,
        liabilitiesCents: 0,
        netWorthCents: 300000,
        history: [worthPoint('2025-12-01', 500000), worthPoint('2026-11-17', 300000)],
        historyStart: '2024-01-01',
        estimatedBefore: '2026-11-17',
      }),
    })
    renderSignedIn(<NetWorthWidget />)
    const line = await screen.findByText(/^Down/)
    expect(line).toHaveTextContent('Down $2,000 since Dec 2025')
    expect(within(line).getByText('$2,000')).toHaveClass('money-problem')
    // The part rebuilt from transactions says so, in a muted line and in the chart's words.
    expect(screen.getByText('Before Nov 17, 2026, estimated from transactions.')).toHaveClass(
      'muted',
    )
    expect(
      screen.getByRole('img', { name: 'Net worth over the last year' }),
    ).toHaveAccessibleDescription(/estimated from transactions\.$/)
  })

  it('shows why net worth could not be read', async () => {
    fakeServer({}, { '/api/actions/get_net_worth': failing('Database is down', 500) })
    renderSignedIn(<NetWorthWidget />)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })

  it('marks a negative net worth and leaves out a line with one point', async () => {
    fakeServer({
      get_net_worth: () => ({
        assetsCents: 0,
        liabilitiesCents: 5000,
        netWorthCents: -5000,
        history: [worthPoint('2026-11-17', -5000)],
      }),
    })
    renderSignedIn(<NetWorthWidget />)
    expect(await screen.findByText('−$50')).toHaveClass('money-problem')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
