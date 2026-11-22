// What credit card balances cost in interest: on a card's page (or a
// one-field prompt for its APR), under the cards on Accounts, and atop
// Plan, Debts.

import { cleanup, screen, waitFor, within } from '@testing-library/react'
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

/** The server's refusal of an APR over 100, as the HTTP API sends it. */
const refuseRate = () =>
  Response.json({ error: 'invalid_input', message: 'An APR is at most 100%.' }, { status: 400 })

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

  it("keeps Save off for a rate that can't be one, like a negative", async () => {
    renderSignedIn(<InterestCard account={owing({ aprPercent: null })} />)
    const prompt = screen.getByRole('region', { name: "Add this card's APR" })
    await userEvent.type(within(prompt).getByRole('textbox', { name: 'APR' }), '-5')
    expect(within(prompt).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it("says why when the server won't take the APR", async () => {
    // The server allows 0 to 100; anything over is refused with its reason.
    fakeServer({}, { '/api/actions/update_account': refuseRate })
    renderSignedIn(<InterestCard account={owing({ aprPercent: null })} />)
    const prompt = screen.getByRole('region', { name: "Add this card's APR" })
    await userEvent.type(within(prompt).getByRole('textbox', { name: 'APR' }), '250')
    await userEvent.click(within(prompt).getByRole('button', { name: 'Save' }))
    expect(await within(prompt).findByRole('alert')).toHaveTextContent('An APR is at most 100%.')
  })

  it('says what the balance costs a month, and opens the math', async () => {
    renderSignedIn(<InterestCard account={owing({ aprPercent: 24.99 })} />)
    const card = within(screen.getByRole('region', { name: 'Interest on this card' })).getByRole(
      'button',
    )
    // $2,400 at 24.99% is $49.98 a month, shown to the dollar.
    expect(card).toHaveTextContent('If you carry this balance, about $50 a month in interest')
    expect(card).toHaveTextContent('On $2,400 owed, at 24.99% APR.')
    await userEvent.click(card)
    const drill = screen.getByRole('dialog', { name: 'Interest on this card' })
    // The equation spelled out: owed times the APR, divided by a year's months.
    expect(within(drill).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Interest a month, about $50 = Owed $2,400 times APR 24.99% divided by A year 12 months',
    )
    expect(within(drill).getByRole('link', { name: /Change the APR/ })).toHaveAttribute(
      'href',
      '/plan/debts',
    )
  })

  it('says plainly that a 0% card costs nothing, rather than "about $0"', () => {
    renderSignedIn(<InterestCard account={owing({ aprPercent: 0 })} />)
    const card = screen.getByRole('region', { name: 'Interest on this card' })
    expect(card).toHaveTextContent('No interest at 0% APR')
    expect(card).not.toHaveTextContent('$0')
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
      'Carrying these balances costs about $50 a month in interest, not counting 1 card with no APR yet.',
    )
  })

  it('speaks of one balance when there is one card, and counts several without an APR', () => {
    expect(line([owing({ aprPercent: 24.99 })])).toHaveTextContent(
      'Carrying this balance costs about $50 a month in interest.',
    )
    cleanup()
    expect(
      line([
        owing({ aprPercent: 24.99 }),
        owing({ id: 'b', name: 'Store card', aprPercent: null }),
        owing({ id: 'c', name: 'Gas card', aprPercent: null }),
      ]),
    ).toHaveTextContent('not counting 2 cards with no APR yet.')
  })

  it('leaves out a card the owner re-kinded, as the Credit cards group does', () => {
    // A card marked as a loan sits under Loans, so its interest is not the cards' either.
    expect(line([owing({ aprPercent: 24.99, kind: 'loan' })])).toBeNull()
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
      'Carrying this balance costs about $50 a month in interest.',
    )
  })

  it('names the cards left out of the total, worded as on Accounts', async () => {
    // $100 at 24.99% is about $2 a month; the $9,000 card has no APR, so it can't be counted.
    serve([
      owing({ balanceCents: 10_000, aprPercent: 24.99 }),
      owing({ id: 'big', name: 'Store card', balanceCents: 900_000, aprPercent: null }),
    ])
    renderPlan('/plan/debts')
    expect(await screen.findByRole('region', { name: 'Your debts' })).toHaveTextContent(
      'Carrying these balances costs about $2 a month in interest, not counting 1 card with no APR yet.',
    )
  })

  it('waits for an APR before saying it', async () => {
    serve([owing({ aprPercent: null })])
    renderPlan('/plan/debts')
    expect(await screen.findByRole('region', { name: 'Your debts' })).not.toHaveTextContent(
      'a month in interest',
    )
  })
})
