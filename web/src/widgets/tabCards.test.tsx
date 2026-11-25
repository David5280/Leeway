// Home's summary cards: each shows its tab's figure with a status in words
// and opens that tab (or a page a tap deeper), never acting on Home itself.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SpendingPace } from '../api/client'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { cashFlow, debtPlans, goal } from '../test/planning'
import { worthPoint } from '../test/worth'
import { DebtsWidget, MerchantsWidget, TrendsWidget } from './Shortcuts'
import { CashToPaydayCard, NetWorthCard, SpendingPaceCard, TopGoalCard, topGoal } from './TabCards'

afterEach(() => vi.unstubAllGlobals())

/** The card by its name, once its figure has loaded. */
function card(name: string) {
  return waitFor(() => {
    const region = screen.getByRole('region', { name })
    within(region).getByRole('link')
    return region
  })
}

/** Where the card's one link goes. */
const opens = (region: HTMLElement) => within(region).getByRole('link').getAttribute('href')

/** $800 followed, $340 spent by Nov 17, heading for `projectedCents`. */
function pace(projectedCents: number, fields: Partial<SpendingPace> = {}): SpendingPace {
  return {
    start: '2026-11-01',
    end: '2026-11-30',
    days: 30,
    categoryIds: ['cat-groceries'],
    budgetCents: 80000,
    cumulative: [{ date: '2026-11-17', cents: 34000 }],
    projectedCents,
    ...fields,
  }
}

describe('Cash to payday', () => {
  it('shows the bills before payday, covered by the cash, and opens Payday', async () => {
    fakeServer({ get_cash_flow: () => cashFlow() })
    renderSignedIn(<CashToPaydayCard />)
    const region = await card('Cash to payday')
    expect(region).toHaveTextContent('$60')
    expect(region).toHaveTextContent('CoveredBills before payday Fri, Nov 27')
    expect(opens(region)).toBe('/payday')
  })

  it('says how short the cash falls, in red, before a known payday', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ shortfallCents: 12_200 }) })
    renderSignedIn(<CashToPaydayCard />)
    const region = await card('Cash to payday')
    expect(region).toHaveTextContent('Shortby $122 before payday Fri, Nov 27')
    expect(within(region).getByText('Short')).toHaveClass('pill-over')
  })

  it('marks a shortfall to watch, not red, when payday is only an estimate', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ shortfallCents: 12_200, paydayEstimate: true }) })
    renderSignedIn(<CashToPaydayCard />)
    const region = await card('Cash to payday')
    expect(region).toHaveTextContent('Shortby $122 before payday Fri, Nov 27')
    expect(within(region).getByText('Short')).toHaveClass('pill-watch')
    expect(region.querySelector('.pill-over')).not.toBeInTheDocument()
  })

  it('claims neither covered nor short while the balance is unknown', async () => {
    fakeServer({ get_cash_flow: () => cashFlow({ cashKnown: false }) })
    renderSignedIn(<CashToPaydayCard />)
    const region = await card('Cash to payday')
    expect(region).not.toHaveTextContent('Covered')
    expect(region).not.toHaveTextContent('Short')
  })

  it('shows why the cash could not be read', async () => {
    fakeServer({}, { '/api/actions/get_cash_flow': failing('Database unavailable', 500) })
    renderSignedIn(<CashToPaydayCard />)
    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument()
  })
})

describe('Spending pace', () => {
  it('shows the share used, on pace, and opens Spending', async () => {
    fakeServer({ get_spending_pace: () => pace(80_000) })
    renderSignedIn(<SpendingPaceCard />)
    const region = await card('Spending pace')
    expect(region).toHaveTextContent('43% used')
    expect(region).toHaveTextContent('On paceof $800')
    expect(opens(region)).toBe('/spending')
  })

  it('says amber words when spending is heading over the budget', async () => {
    fakeServer({ get_spending_pace: () => pace(96_000) })
    renderSignedIn(<SpendingPaceCard />)
    const region = await card('Spending pace')
    expect(within(region).getByText('Ahead of pace')).toHaveClass('pill-watch')
  })

  it('says pace is not set up when no budget follows it', async () => {
    fakeServer({ get_spending_pace: () => pace(0, { categoryIds: [] }) })
    renderSignedIn(<SpendingPaceCard />)
    expect(await card('Spending pace')).toHaveTextContent('Not set up')
  })
})

describe('Your top goal', () => {
  it('shows the first goal still being saved for, and opens Goals', async () => {
    fakeServer({
      list_goals: () => [
        goal({ name: 'Old bike', targetCents: 10000, savedCents: 10000 }),
        goal({ name: 'Trip', targetCents: 100000, savedCents: 25000 }),
      ],
    })
    renderSignedIn(<TopGoalCard />)
    const region = await card('Your top goal')
    expect(region).toHaveTextContent('25%')
    expect(region).toHaveTextContent('Trip')
    expect(opens(region)).toBe('/goals')
  })

  it('invites a first goal when there are none', async () => {
    fakeServer({ list_goals: () => [] })
    renderSignedIn(<TopGoalCard />)
    expect(await card('Your top goal')).toHaveTextContent('No goals yet')
  })

  it('falls back to the first goal when every goal is reached', () => {
    const done = goal({ name: 'Bike', targetCents: 100, savedCents: 100 })
    expect(topGoal([done])).toBe(done)
    expect(topGoal([])).toBeUndefined()
  })
})

describe('Net worth', () => {
  it('shows net worth and how far it moved this year, and opens Wealth', async () => {
    fakeServer({
      get_net_worth: () => ({
        assetsCents: 900000,
        liabilitiesCents: 200000,
        netWorthCents: 700000,
        history: [worthPoint('2026-01-01', 500000), worthPoint('2026-11-17', 700000)],
      }),
    })
    renderSignedIn(<NetWorthCard />)
    const region = await card('Net worth')
    expect(region).toHaveTextContent('$7,000')
    expect(region).toHaveTextContent('Up $2,000 since Jan 2026')
    expect(opens(region)).toBe('/wealth')
  })
})

describe('the optional shortcut cards', () => {
  it('sums up spending over time and opens its page', async () => {
    const period = (offset: number, spentCents: number) => ({
      offset,
      start: '2026-11-01',
      end: '2026-11-30',
      spentCents,
      incomeCents: 0,
      categories: [],
    })
    fakeServer({ get_trends: () => [period(-2, 50000), period(-1, 70000), period(0, 20000)] })
    renderSignedIn(<TrendsWidget />)
    const region = await card('Spending over time')
    expect(region).toHaveTextContent('$200So far this month, usually $600')
    expect(opens(region)).toBe('/spending/over-time')
  })

  it('names where the most went and opens Top merchants', async () => {
    fakeServer({ top_merchants: () => [{ merchant: 'Costco', spentCents: 12000, count: 2 }] })
    renderSignedIn(<MerchantsWidget />)
    const region = await card('Top merchants')
    expect(region).toHaveTextContent('$120The most went to Costco')
    expect(opens(region)).toBe('/spending/merchants')
  })

  it('says when the debts are gone and opens Debts', async () => {
    const debt = {
      id: 'card',
      name: 'Card',
      balanceCents: 200000,
      aprBps: 2499,
      minimumCents: 6000,
    }
    fakeServer({ plan_debt_payoff: () => debtPlans([debt]) })
    renderSignedIn(<DebtsWidget />)
    const region = await card('Debt payoff')
    expect(region).toHaveTextContent('Debt free in 4 years 10 months, paying $60 a month')
    expect(opens(region)).toBe('/wealth/debts')
  })
})
