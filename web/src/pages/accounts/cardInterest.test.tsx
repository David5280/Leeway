// What credit card balances cost in interest: on a card's page (or a
// one-field prompt for its APR), under the cards on Accounts, and atop
// Plan, Debts.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../api/client'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { account, planServer, renderPlan } from '../../test/planning'
import { CardsInterestLine, InterestCard } from './CardInterest'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

const owing = (fields: Partial<Account> = {}) =>
  account({ id: 'cc', name: 'Travel card', type: 'credit', balanceCents: 240_000, ...fields })

describe("a card's interest on its page", () => {
  it('asks for the APR in one field, and saves it', async () => {
    const server = fakeServer({ update_account: (input) => ({ ...owing(), ...input }) })
    renderSignedIn(<InterestCard account={owing({ aprPercent: null })} />)
    const prompt = screen.getByRole('region', { name: "Add this card's APR" })
    expect(prompt).toHaveTextContent("Add this card's APR to see what the balance costs you.")
    const save = within(prompt).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await userEvent.type(within(prompt).getByRole('textbox', { name: 'APR' }), '24.99')
    await userEvent.click(save)
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([{ id: 'cc', aprPercent: 24.99 }]),
    )
  })

  it('says what the balance costs a month, and opens the math', async () => {
    renderSignedIn(<InterestCard account={owing({ aprPercent: 24.99 })} />)
    const card = within(screen.getByRole('region', { name: 'Interest on this card' })).getByRole(
      'button',
    )
    // $2,400 at 24.99% is $49.98 a month, shown to the dollar.
    expect(card).toHaveTextContent('About $50 a month in interest')
    expect(card).toHaveTextContent('On $2,400 owed, at 24.99% APR.')
    await userEvent.click(card)
    const drill = screen.getByRole('dialog', { name: 'Interest on this card' })
    expect(within(drill).getByRole('link', { name: /Change the APR/ })).toHaveAttribute(
      'href',
      '/plan/debts',
    )
  })

  it('shows nothing once the card owes nothing', () => {
    const { container } = renderSignedIn(<InterestCard account={owing({ balanceCents: 0 })} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the interest line under the cards on Accounts', () => {
  const line = (accounts: Account[]) => {
    renderSignedIn(
      <Routes>
        <Route path="/" element={<CardsInterestLine accounts={accounts} />} />
      </Routes>,
    )
    return screen.queryByRole('link')
  }

  it('adds up the cards with an APR and counts those without', () => {
    const link = line([
      owing({ aprPercent: 24.99 }),
      owing({ id: 'b', name: 'Store card', aprPercent: null }),
    ])
    expect(link).toHaveAttribute('href', '/plan/debts')
    expect(link).toHaveTextContent(
      'About $50 a month in interest, not counting 1 card with no APR yet.',
    )
  })

  it('asks for the APRs when no card has one', () => {
    expect(line([owing({ aprPercent: null })])).toHaveTextContent(
      "Add your cards' APRs to see what their balances cost you.",
    )
  })

  it('is not there when no card owes', () => {
    expect(line([owing({ balanceCents: 0 })])).toBeNull()
  })
})

describe('what the cards cost, atop Plan, Debts', () => {
  const serve = (accounts: Account[]) =>
    planServer({ ...quietBills, list_accounts: () => accounts, plan_debt_payoff: () => null })

  it('leads the debts with the interest a month', async () => {
    serve([owing({ aprPercent: 24.99 })])
    renderPlan('/plan/debts')
    expect(await screen.findByRole('region', { name: 'Your debts' })).toHaveTextContent(
      'Your cards cost about $50 a month in interest.',
    )
  })

  it('waits for an APR before saying it', async () => {
    serve([owing({ aprPercent: null })])
    renderPlan('/plan/debts')
    expect(await screen.findByRole('region', { name: 'Your debts' })).not.toHaveTextContent(
      'Your cards cost',
    )
  })
})
