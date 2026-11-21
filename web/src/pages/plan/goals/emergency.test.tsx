// The emergency fund on the Goals section: offered in one tap, then shown as
// its goal with the next step and the accounts it counts.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../../api/client'
import { failing, sentence } from '../../../test/fake'
import { goal, planServer, renderPlan } from '../../../test/planning'
import type { EmergencyView } from './emergencyText'

afterEach(() => vi.unstubAllGlobals())

const ESSENTIALS = { cents: 200_000, from: 'spending' as const, categories: ['Rent', 'Groceries'] }
const ACCOUNTS = [
  { id: 'acct-rainy', name: 'Rainy Day', balanceCents: 50_000, counted: true },
  { id: 'acct-check', name: 'Everyday', balanceCents: 90_000, counted: false },
]

/** The offer: no fund yet, one month of $2,000 essentials. */
const OFFER: EmergencyView = {
  goalId: null,
  essentials: ESSENTIALS,
  months: 1,
  targetCents: 200_000,
  savedCents: 50_000,
  next: { months: 3, targetCents: 600_000 },
  accounts: ACCOUNTS,
  picked: false,
}

/** The fund once started, with $500 of its $2,000 in Rainy Day. */
const FUND: EmergencyView = { ...OFFER, goalId: 'goal-emergency' }

function fundGoal(fields: Partial<Goal> = {}): Goal {
  return goal({
    id: 'goal-emergency',
    name: 'Emergency fund',
    targetCents: 200_000,
    emergencyMonths: 1,
    followedAccountIds: ['acct-rainy'],
    accountBalanceCents: 50_000,
    ...fields,
  })
}

function serve(view: EmergencyView | null, goals: Goal[] = []) {
  return planServer({
    list_goals: () => goals,
    list_accounts: () => [],
    get_emergency_fund: () => view,
    start_emergency_fund: () => fundGoal(),
    change_emergency_fund: () => FUND,
  })
}

describe('the emergency fund offer', () => {
  it('offers a month of essentials in one tap, with the step after it', async () => {
    const server = serve(OFFER)
    renderPlan('/plan/goals')
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    expect(offer.getByText('Start with one month of essentials')).toBeVisible()
    expect(offer.getByText('$2,000')).toBeVisible()
    expect(offer.getByText('What Rent and Groceries cost in a typical month.')).toBeVisible()
    expect(offer.getByText(sentence('Then aim for 3 months: $6,000.'))).toBeVisible()
    // No empty-goals card beside the offer: the offer is the way to start.
    expect(screen.queryByText(/No goals yet/)).toBeNull()

    await userEvent.setup().click(offer.getByRole('button', { name: 'Start my emergency fund' }))
    await waitFor(() => expect(server.actions('start_emergency_fund')).toEqual([{}]))
  })

  it('says why it could not start', async () => {
    planServer(
      {
        list_goals: () => [],
        list_accounts: () => [],
        get_emergency_fund: () => OFFER,
      },
      { '/api/actions/start_emergency_fund': failing('You already have an emergency fund goal') },
    )
    renderPlan('/plan/goals')
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    await userEvent.setup().click(offer.getByRole('button', { name: 'Start my emergency fund' }))
    expect(await offer.findByText('You already have an emergency fund goal')).toBeVisible()
  })

  it('is not offered before spending is known, so the empty card says when it will be', async () => {
    serve(null)
    renderPlan('/plan/goals')
    expect(
      await screen.findByText(/start an emergency fund once a month of spending/),
    ).toBeVisible()
  })
})

describe('the emergency fund goal', () => {
  it('shows its months, what is left and the next step, and takes it', async () => {
    const server = serve(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    expect(fund.getByText('1 month of essentials')).toBeVisible()
    expect(fund.getByText(sentence('$1,500 to go.'))).toBeVisible()
    expect(fund.getByText(/Counts every savings account/)).toBeVisible()
    // Following savings, it takes no money by hand.
    expect(fund.queryByRole('form', { name: /Add to/ })).toBeNull()

    const next = fund.getByRole('button', { name: 'Aim for 3 months: $6,000' })
    expect(next).not.toHaveClass('primary')
    await userEvent.setup().click(next)
    await waitFor(() => expect(server.actions('change_emergency_fund')).toEqual([{ months: 3 }]))
  })

  it('cheers a step reached, and makes the next one the main button', async () => {
    serve(FUND, [fundGoal({ accountBalanceCents: 250_000 })])
    renderPlan('/plan/goals')
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    expect(fund.getByText('You have 1 month put by. Nice work.')).toHaveClass('good')
    expect(fund.getByRole('button', { name: 'Aim for 3 months: $6,000' })).toHaveClass('primary')
  })

  it('marks the accounts that hold it, and empty goes back to every savings account', async () => {
    const server = serve(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    await user.click(fund.getByRole('button', { name: 'Change' }))
    const form = within(fund.getByRole('form', { name: 'Accounts for the emergency fund' }))
    expect(form.getByRole('checkbox', { name: /Rainy Day/ })).not.toBeChecked()
    await user.click(form.getByRole('checkbox', { name: /Everyday/ }))
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: ['acct-check'] }]),
    )
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
  })

  it('names the accounts picked, and starts the form from them', async () => {
    const picked = { ...FUND, picked: true }
    serve(picked, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    expect(fund.getByText(/Counts Rainy Day\./)).toBeVisible()
    await user.click(fund.getByRole('button', { name: 'Change' }))
    expect(fund.getByRole('checkbox', { name: /Rainy Day/ })).toBeChecked()
    await user.click(fund.getByRole('button', { name: 'Close' }))
    expect(fund.queryByRole('form')).toBeNull()
  })

  it('asks for a savings account when there is none to count', async () => {
    serve({ ...FUND, accounts: [] }, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change' }))
    expect(fund.getByText('Link or add a savings account to hold the fund.')).toBeVisible()
  })

  it('edits without the progress fields, since it follows savings', async () => {
    serve(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = within(await screen.findByRole('region', { name: 'Emergency fund' }))
    await userEvent.setup().click(fund.getByRole('button', { name: 'Edit' }))
    const form = within(await screen.findByRole('form', { name: 'Edit Emergency fund' }))
    expect(form.queryByRole('combobox', { name: 'Progress' })).toBeNull()
    expect(form.queryByRole('textbox', { name: 'Saved so far' })).toBeNull()
  })
})
