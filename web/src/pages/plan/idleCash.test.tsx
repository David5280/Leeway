// Spare cash on Plan, Bills: shown only when checking holds well more than
// it needs before payday, with the savings rate it assumes, opening the math.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkIdleCash } from '../../../../server/src/domain/idleCash'
import { planServer, renderPlan } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

/** $8,000 in checking, $1,200 of bills and $50 a day for 10 days to payday. */
const flush = {
  checkingCents: 800_000,
  billsCents: 120_000,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-11-27',
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

describe('spare cash on Plan, Bills', () => {
  it('says how much could sit in savings and what it would earn, at the rate it assumes', async () => {
    planServer({ ...quietBills, get_idle_cash: () => spare })
    renderPlan('/plan/bills')
    const card = within(await screen.findByRole('region', { name: 'Spare cash' })).getByRole(
      'button',
    )
    expect(card).toHaveTextContent("$5,600 in checking isn't needed before payday.")
    expect(card).toHaveTextContent('In savings at 4% APY, it would earn about $224 a year.')
  })

  it('opens the math, which never moves money', async () => {
    planServer({ ...quietBills, get_idle_cash: () => spare })
    renderPlan('/plan/bills')
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Spare cash' })).getByRole('button'),
    )
    const drill = screen.getByRole('dialog', { name: 'Spare cash in checking' })
    expect(drill).toHaveTextContent('Could sit in savings')
    expect(drill).toHaveTextContent('assumed 4% APY')
    expect(drill).toHaveTextContent('Leeway never moves money')
    expect(within(drill).getByText('In a month, about')).toBeInTheDocument()
  })

  it('says nothing when there is no spare cash, or it is not the time', async () => {
    const server = planServer({
      ...quietBills,
      get_idle_cash: () => checkIdleCash({ ...flush, overdrawn: true }),
    })
    renderPlan('/plan/bills')
    await waitFor(() => expect(server.actions('get_idle_cash')).toHaveLength(1))
    await screen.findByRole('region', { name: 'Until payday' })
    expect(screen.queryByRole('region', { name: 'Spare cash' })).not.toBeInTheDocument()
  })
})
