// The below zero warning on "Will the cash last until payday?": when checking
// first goes below $0 and the move that would cover it, worked out by the
// server's own math (belowZero.ts) from the same cash flow the card shows.
// Red only for a real problem. Every name is made up.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CashFlow } from '../../api/client'
import { cashFlow, planServer, renderPlan } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const RAINY_DAY = { accountName: 'Rainy day', cashCents: 300_000 }

/** Rent on Nov 20th that $1,000 in checking cannot cover: $200 short. */
const shortForRent = (fields: Partial<CashFlow> = {}) => ({
  cashCents: 100_000,
  billsDue: [
    { billId: 'r', name: 'Rent', dueDate: '2026-11-20', amountCents: 120_000, overdue: false },
  ],
  billsDueCents: 120_000,
  safeCents: 0,
  shortfallCents: 20_000,
  ...fields,
})

async function show(flow: CashFlow) {
  planServer({
    list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
    list_categories: () => [],
    find_recurring: () => [],
    get_cash_flow: () => flow,
  })
  renderPlan('/plan/bills')
  // The card is drawn anew once the numbers arrive, so it is found after them.
  await screen.findByText(/in checking/)
  return screen.getByRole('region', { name: 'Until payday' })
}

/** The warning inside the card, or null when there is none. */
const warningIn = (card: HTMLElement) =>
  within(card).queryByRole('note', { name: 'Below zero before payday' })

describe('Below zero before payday', () => {
  it('says when rent takes checking below $0, and the move from savings a day before', async () => {
    const warning = warningIn(await show(cashFlow(shortForRent(), [RAINY_DAY])))!
    expect(warning).toHaveTextContent('Checking goes below $0 on Nov 20, when Rent comes out.')
    expect(warning).toHaveTextContent('Moving $200 from Rainy day by Nov 19 would cover it.')
    // A payday read for sure leaves no doubt: red, like the shortfall above it.
    expect(within(warning).getByText(/goes below/)).toHaveClass('over')
  })

  it('names no account when no savings holds enough, and still says what would cover it', async () => {
    const small = { accountName: 'Small', cashCents: 5_000 }
    const warning = warningIn(await show(cashFlow(shortForRent(), [small])))!
    expect(warning).toHaveTextContent('Moving $200 into checking by Nov 19 would cover it.')
    expect(warning).not.toHaveTextContent('Small')
  })

  it('is amber against a payday that is only a guess, as the shortfall is', async () => {
    const guess = { paydaySource: 'detected_income', paydayEstimate: true, expectedPayCents: 1 }
    const card = await show(cashFlow(shortForRent(guess), [RAINY_DAY]))
    expect(within(warningIn(card)!).getByText(/goes below/)).toHaveClass('warn')
    expect(within(card).getByText('$200', { selector: '.mid-number' })).toHaveClass('money-warn')
  })

  it('is red, and asks for the move today, when checking is below $0 already', async () => {
    // Even against a guessed payday: the overdraft is real now.
    const card = await show(
      cashFlow(
        {
          cashCents: 0,
          overdraftCents: 4_000,
          billsDue: [],
          billsDueCents: 0,
          safeCents: 0,
          shortfallCents: 4_000,
          paydayEstimate: true,
        },
        [RAINY_DAY],
      ),
    )
    const now = warningIn(card)!
    expect(within(now).getByText(/already below/)).toHaveClass('over')
    expect(now).toHaveTextContent('Moving $40 from Rainy day today would cover it.')
  })

  it('says nothing while checking lasts until payday', async () => {
    expect(warningIn(await show(cashFlow({}, [RAINY_DAY])))).toBeNull()
  })
})
