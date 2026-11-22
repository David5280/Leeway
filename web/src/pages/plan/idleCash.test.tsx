// Cash that could earn more on Plan, Bills: shown only when checking holds
// well more than it needs before payday, with the savings rate it assumes in
// the card's own words, opening math that adds up to the figure. Never red.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkIdleCash } from '../../lib/idleCash'
import { planServer, renderPlan } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const NAME = 'Cash that could earn more'

/** $8,059.99 in checking (shown as $8,059, rounded down), $1,200 of bills and $50 a day for 10 days to payday. */
const flush = {
  checkingCents: 805_999,
  billsCents: 120_000,
  cardsOwedCents: 0,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-11-27',
  paydayKnown: true,
  overdrawn: false,
  tight: false,
}

/** The server's own answer for that. */
const spare = checkIdleCash(flush)

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

/** The card, once it has loaded, by the one name it goes by everywhere. */
const findCard = async () => screen.findByRole('region', { name: NAME })

describe('cash that could earn more on Plan, Bills', () => {
  it('says how much could sit in savings and what it would earn, at the rate it assumes', async () => {
    planServer({ ...quietBills, get_idle_cash: () => spare })
    renderPlan('/plan/bills')
    const card = within(await findCard()).getByRole('button')
    expect(within(card).getByRole('heading', { name: NAME })).toBeInTheDocument()
    expect(card).toHaveTextContent("$5,600 in checking isn't needed before payday.")
    expect(card).toHaveTextContent(
      'In savings at an assumed 4% APY, it would earn about $224 a year.',
    )
    // Good news, never a problem: nothing on it is drawn red.
    expect(card.querySelector('.over, .money-problem')).toBeNull()
  })

  it('opens the math under the same name, with the rounding as its own row', async () => {
    planServer({ ...quietBills, get_idle_cash: () => spare })
    renderPlan('/plan/bills')
    await userEvent.click(within(await findCard()).getByRole('button'))
    const drill = screen.getByRole('dialog', { name: NAME })
    const math = within(drill).getByRole('region', { name: 'How it adds up' })
    expect(math).toHaveTextContent('rounded down')
    expect(math).toHaveTextContent(
      'Could sit in savings $5,600 = In checking $8,059 minus bills due by payday $1,200 minus typical spending until payday $500 minus a cushion kept for surprises $700 minus rounded down $59',
    )
    expect(drill).toHaveTextContent('assumed 4% APY')
    expect(drill).toHaveTextContent('Leeway never moves money')
    expect(within(drill).getByText('In a month, about')).toBeInTheDocument()
  })

  it('says nothing when no cash is spare, or it is not the time', async () => {
    const server = planServer({
      ...quietBills,
      get_idle_cash: () => checkIdleCash({ ...flush, paydayKnown: false }),
    })
    renderPlan('/plan/bills')
    await waitFor(() => expect(server.actions('get_idle_cash')).toHaveLength(1))
    await screen.findByRole('region', { name: 'Until payday' })
    expect(screen.queryByRole('region', { name: NAME })).not.toBeInTheDocument()
  })
})
