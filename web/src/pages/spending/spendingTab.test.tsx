// The Spending tab as a whole: its sections in the map's order, the lead that
// adds up on screen, the period arrows that only Spending has, and the latest
// transactions and Trends row leading a tap deeper.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category, failing, heldToCash, holdRequest, transaction } from '../../test/fake'
import { groceries, renderSpending, serveSpending } from '../../test/spending'
import { LATEST } from './LatestTransactions'

afterEach(() => vi.unstubAllGlobals())

/** November, day 17 of 30, with $240 of the $600 grocery budget spent. */
const november = budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }])

/** Each finished period the arrows step back to, as get_budget describes it. */
const EARLIER: Record<number, { start: string; end: string; days: number }> = {
  [-1]: { start: '2026-10-01', end: '2026-10-31', days: 31 },
  [-2]: { start: '2026-09-01', end: '2026-09-30', days: 30 },
}

/** The budget `offset` periods back, finished when earlier than now. */
function budgetAt(offset: number) {
  if (offset === 0) return november
  const { start, end, days } = EARLIER[offset]!
  const period = { start, end, days, daysElapsed: days, daysLeft: 0, offset }
  return { ...november, period, totals: { ...november.totals, safePerDayCents: null } }
}

/** Every section card's name, top to bottom. */
const SECTIONS = [
  'Spent this month',
  'Spending pace',
  'Spending categories',
  'Latest transactions',
  'Trends',
]

const region = (name: string) => screen.getByRole('region', { name })
const lead = () => within(region('Spent this month'))

describe('the Spending tab', () => {
  it('reads top to bottom as the map gives it', async () => {
    serveSpending()
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    const names = screen
      .getAllByRole('region')
      .map((one) => one.getAttribute('aria-label'))
      .filter((name) => SECTIONS.includes(name!))
    expect(names).toEqual(SECTIONS)
  })

  it('keeps the title and arrows up while the budget loads, then shows the sections', async () => {
    serveSpending()
    const release = holdRequest('/api/actions/get_budget')
    renderSpending()
    expect(screen.getByRole('heading', { level: 1, name: 'Spending' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous period' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    release()
    expect(await screen.findByRole('region', { name: 'Spent this month' })).toBeInTheDocument()
  })

  it('says why the budget could not load', async () => {
    serveSpending(
      [groceries],
      {},
      { '/api/actions/get_budget': failing('The database is down', 500) },
    )
    renderSpending()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down')
  })
})

describe("Spending's lead", () => {
  it('leads with what was spent, adding up to what is left on screen', async () => {
    serveSpending()
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    expect(lead().getByText('Spent in your budgets')).toBeInTheDocument()
    expect(lead().getByText('40% of your budgets used, 57% of the way through the month.'))
    const sum = within(lead().getByRole('group', { name: 'How your budgets add up' }))
    // $600 budgeted, less $240 spent, is $360 left: all three on screen, in order.
    expect(sum.getAllByText(/^(Budgeted|Spent|Left)$/).map((one) => one.textContent)).toEqual([
      'Budgeted',
      'Spent',
      'Left',
    ])
    expect(sum.getByText('$600')).toBeInTheDocument()
    expect(sum.getByText('−$240')).toBeInTheDocument()
    expect(sum.getByText('$360')).toBeInTheDocument()
  })

  it('says how far over in words once spending passes the budgets, never a bare minus', async () => {
    serveSpending([groceries], {
      get_budget: () => budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 70000 }]),
    })
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    const total = lead().getByText('Over by').closest('.list-row') as HTMLElement
    expect(within(total).getByText('$100')).toHaveClass('money-problem')
    expect(total).not.toHaveTextContent('−')
  })

  it('shows no figure to spend: no cash, no goals held back, no "left to spend"', async () => {
    const held = heldToCash(
      budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }], {
        setAsides: [
          { goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 9000 },
        ],
      }),
      17_800,
    )
    serveSpending([groceries], { get_budget: () => held })
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    const page = document.querySelector('.page')!
    expect(page).not.toHaveTextContent(/safe to spend|safely spend|left to spend|set aside/i)
  })

  it('says what went out with nothing budgeted, and offers suggested budgets next', async () => {
    const coffee = category('Coffee')
    serveSpending([coffee], {
      get_budget: () => budgetFor([coffee], [{ categoryId: coffee.id, amountCents: 4500 }]),
      suggest_budgets: () => ({ from: '2026-08-01', to: '2026-10-31', suggestions: [] }),
    })
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    expect(lead().getByText(/with no budgets to measure it against yet/)).toHaveTextContent(
      "You've spent $45 this month, with no budgets to measure it against yet.",
    )
    expect(lead().queryByRole('group', { name: 'How your budgets add up' })).not.toBeInTheDocument()
    await userEvent.setup().click(lead().getByRole('button', { name: 'Suggest budgets' }))
    // They open right under the button, ahead of the pace chart, so they are in view on a phone.
    const suggestions = await screen.findByRole('region', { name: 'Suggested budgets' })
    expect(region('Spent this month').nextElementSibling).toBe(suggestions)
  })

  it('keeps the sum when rollover carries the budgets to zero or below', async () => {
    const rolling = { ...groceries, rollover: true, rolloverSince: '2026-09-01' }
    serveSpending([rolling], {
      get_budget: () =>
        budgetFor([rolling], [{ categoryId: groceries.id, amountCents: 24000 }], {
          carries: new Map([[groceries.id, -70000]]),
        }),
    })
    renderSpending()
    await screen.findByRole('region', { name: 'Spent this month' })
    // $600 less $700 overspent before is -$100 budgeted: a budget all the same.
    expect(lead().queryByText(/no budgets/)).not.toBeInTheDocument()
    const sum = within(lead().getByRole('group', { name: 'How your budgets add up' }))
    expect(sum.getByText('Over by')).toBeInTheDocument()
    expect(sum.getByText('$340')).toHaveClass('money-problem')
    // No "0% of your budgets used" beside it: only how far through the month is said.
    expect(lead().getByText('57% of the way through the month.')).toBeInTheDocument()
    expect(lead().queryByText(/of your budgets used/)).not.toBeInTheDocument()
  })
})

describe('the period arrows', () => {
  it('step back through earlier periods and forward to now, every section following', async () => {
    const server = serveSpending([groceries], {
      get_budget: (input) => budgetAt(Number(input.offset)),
    })
    renderSpending()
    const user = userEvent.setup()
    expect(await screen.findByText('November 2026 · Day 17 of 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(await screen.findByText('October 2026 · Last month')).toBeInTheDocument()
    const october = within(await screen.findByRole('region', { name: 'Spent in October 2026' }))
    expect(october.getByText('40% of your budgets used.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(await screen.findByText('September 2026 · 2 months ago')).toBeInTheDocument()
    expect(server.actions('get_spending_pace')).toContainEqual({ offset: -2 })
    await waitFor(() =>
      expect(server.actions('list_transactions')).toContainEqual({
        limit: LATEST,
        start: '2026-09-01',
        end: '2026-09-30',
      }),
    )
    expect(within(region('Trends')).getByRole('link', { name: /Top merchants/ })).toHaveAttribute(
      'href',
      '/spending/merchants?period=-2',
    )

    await user.click(screen.getByRole('button', { name: 'Next period' }))
    await user.click(screen.getByRole('button', { name: 'Next period' }))
    expect(await screen.findByText('November 2026 · Day 17 of 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
  })

  it('opens on the period the address names, as a page a tap deeper links back', async () => {
    const server = serveSpending([groceries], {
      get_budget: (input) => budgetAt(Number(input.offset)),
    })
    renderSpending('/spending?period=-1')
    expect(await screen.findByText('October 2026 · Last month')).toBeInTheDocument()
    expect(server.actions('get_budget')).toEqual([{ offset: -1 }])
    expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled()
  })
})

describe('the latest transactions and the Trends row', () => {
  it('lists a few of the latest transactions and leads on to all activity', async () => {
    const coffeeRun = transaction({ id: 'tx-1', date: '2026-11-16', name: 'Corner cafe' })
    const server = serveSpending([groceries], {
      list_transactions: () => ({ transactions: [coffeeRun], total: 1 }),
    })
    renderSpending()
    const latest = within(await screen.findByRole('region', { name: 'Latest transactions' }))
    expect(await latest.findByText('Corner cafe')).toBeInTheDocument()
    expect(server.actions('list_transactions')).toEqual([
      { limit: LATEST, start: '2026-11-01', end: '2026-11-30' },
    ])
    await userEvent.setup().click(latest.getByRole('link', { name: 'All activity' }))
    expect(await screen.findByText('Landed on /spending/activity')).toBeInTheDocument()
  })

  it('says when the period has no transactions yet', async () => {
    serveSpending()
    renderSpending()
    const latest = within(await screen.findByRole('region', { name: 'Latest transactions' }))
    expect(await latest.findByText('No transactions in this period yet.')).toBeInTheDocument()
  })

  it.each([
    ['Spending over time', '/spending/over-time'],
    ['Top merchants', '/spending/merchants'],
  ])('opens %s on its own page', async (name, address) => {
    serveSpending()
    renderSpending()
    const trends = within(await screen.findByRole('region', { name: 'Trends' }))
    await userEvent.setup().click(trends.getByRole('link', { name: new RegExp(`^${name}`) }))
    expect(await screen.findByText(`Landed on ${address}`)).toBeInTheDocument()
  })
})
