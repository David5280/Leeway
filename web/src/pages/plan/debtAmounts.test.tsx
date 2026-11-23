// Amounts typed on Plan, Debts that cannot be read: a debt's monthly payment
// is never saved as none, which would clear it, and the payoff plan says why
// it counts no extra.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, debtPlans, planServer, renderPlan } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const UNREADABLE = "Couldn't read that amount."

// A card with a $60 minimum.
const rewards = account({
  id: 'acct-rewards',
  name: 'Rewards card',
  type: 'credit',
  balanceCents: 200000,
  aprPercent: 24.99,
  minimumPaymentCents: 6000,
})
const rewardsDebt = {
  id: rewards.id,
  name: rewards.name,
  balanceCents: 200000,
  aprBps: 2499,
  minimumCents: 6000,
}

function serve() {
  return planServer({
    list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
    list_categories: () => [],
    find_recurring: () => [],
    list_accounts: () => [rewards],
    update_account: (input) => ({ ...rewards, ...input }),
    plan_debt_payoff: (input) => ({ ...debtPlans([rewardsDebt]), extraCents: input.extraCents }),
  })
}

async function rewardsTerms() {
  renderPlan('/plan/debts')
  const terms = within(await screen.findByRole('form', { name: 'Rewards card terms' }))
  return {
    terms,
    payment: terms.getByRole('textbox', { name: 'Rewards card monthly payment' }),
    save: terms.getByRole('button', { name: 'Save' }),
  }
}

describe("a debt's monthly payment", () => {
  it('refuses "6O" for a $60 minimum rather than clear the minimum', async () => {
    const server = serve()
    const { terms, payment, save } = await rewardsTerms()
    const user = userEvent.setup()
    await user.clear(payment)
    await user.type(payment, '6O')
    expect(save).toBeDisabled()
    expect(terms.queryByRole('alert')).not.toBeInTheDocument()
    await user.type(payment, '{Enter}')
    expect(terms.getByRole('alert')).toHaveTextContent(UNREADABLE)
    expect(server.actions('update_account')).toEqual([])
  })

  it('refuses a negative minimum, "-5", rather than send it to be turned down', async () => {
    const server = serve()
    const { terms, payment, save } = await rewardsTerms()
    const user = userEvent.setup()
    await user.clear(payment)
    await user.type(payment, '-5')
    expect(save).toBeDisabled()
    await user.tab()
    expect(terms.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    expect(server.actions('update_account')).toEqual([])
  })

  it('saves once the payment is fixed, and still clears it when left blank', async () => {
    const server = serve()
    const { terms, payment, save } = await rewardsTerms()
    const user = userEvent.setup()
    await user.clear(payment)
    await user.type(payment, '6O')
    await user.clear(payment)
    await user.type(payment, '65')
    expect(terms.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(save)
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: rewards.id, aprPercent: 24.99, minimumPaymentCents: 6500 },
      ]),
    )

    await user.clear(payment)
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() =>
      expect(server.actions('update_account').at(-1)).toEqual({
        id: rewards.id,
        aprPercent: 24.99,
        minimumPaymentCents: null,
      }),
    )
  })
})

describe('the extra each month', () => {
  it('says it could not read "1.5mm", and plans with no extra rather than $1.50', async () => {
    const server = serve()
    renderPlan('/plan/debts')
    const plan = within(await screen.findByRole('region', { name: 'Payoff plan' }))
    const user = userEvent.setup()
    await user.type(plan.getByRole('textbox', { name: 'Extra each month' }), '1.5mm')
    await user.tab()
    expect(plan.getByRole('alert')).toHaveTextContent(UNREADABLE)
    for (const input of server.actions('plan_debt_payoff')) expect(input).toEqual({ extraCents: 0 })
  })

  it('says a negative extra, "-50", is not one, rather than plan with none quietly', async () => {
    const server = serve()
    renderPlan('/plan/debts')
    const plan = within(await screen.findByRole('region', { name: 'Payoff plan' }))
    const user = userEvent.setup()
    await user.type(plan.getByRole('textbox', { name: 'Extra each month' }), '-50')
    await user.tab()
    expect(plan.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    for (const input of server.actions('plan_debt_payoff')) expect(input).toEqual({ extraCents: 0 })
  })
})
