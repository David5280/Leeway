// Changing the accounts the emergency fund counts, from its card. Each says
// why an account is left out, never counts a dollar another goal follows, and
// saves nothing untouched.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EVERYDAY,
  fundCard,
  fundChoice,
  fundGoal,
  fundView,
  RAINY,
  serveEmergency,
} from '../../../test/emergency'
import { account } from '../../../test/fake'
import { renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const FUND = fundView()

describe('the accounts the fund counts', () => {
  it('picks an account, which switches to counting only the picked', async () => {
    const server = serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    const form = within(fund.getByRole('form', { name: 'Accounts for the emergency fund' }))
    expect(form.getByRole('radio', { name: 'Every savings account' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: /Rainy Day/ })).not.toBeChecked()
    await user.click(form.getByRole('checkbox', { name: /Everyday/ }))
    expect(form.getByRole('radio', { name: 'Only the accounts I pick' })).toBeChecked()
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: ['acct-check'] }]),
    )
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
  })

  it('names the accounts picked, starts from them, and saves nothing untouched', async () => {
    const marked = { ...RAINY, marked: true }
    const server = serveEmergency(fundView({ counts: 'marked', accounts: [marked, EVERYDAY] }), [
      fundGoal(),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    expect(fund.getByText(/Counts Rainy Day\./)).toBeVisible()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('checkbox', { name: /Rainy Day/ })).toBeChecked()
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('change_emergency_fund')).toEqual([])
  })

  it('swaps one picked account for another', async () => {
    const marked = { ...RAINY, marked: true }
    const server = serveEmergency(fundView({ counts: 'marked', accounts: [marked, EVERYDAY] }), [
      fundGoal(),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    await user.click(fund.getByRole('checkbox', { name: /Rainy Day/ }))
    await user.click(fund.getByRole('checkbox', { name: /Everyday/ }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: ['acct-check'] }]),
    )
  })

  it('closes on Cancel without saving, as the essentials form does', async () => {
    const server = serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    await user.click(fund.getByRole('checkbox', { name: /Everyday/ }))
    await user.click(fund.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('change_emergency_fund')).toEqual([])
    expect(fund.getByRole('button', { name: 'Change accounts' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('asks for at least one account before counting only the picked', async () => {
    serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    await user.click(fund.getByRole('radio', { name: 'Only the accounts I pick' }))
    expect(fund.getByText('Tick at least one account to save.')).toBeVisible()
    expect(fund.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('goes back to every savings account', async () => {
    const marked = { ...RAINY, marked: true }
    const server = serveEmergency(fundView({ counts: 'marked', accounts: [marked, EVERYDAY] }), [
      fundGoal(),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    await user.click(fund.getByRole('radio', { name: 'Every savings account' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: [] }]),
    )
  })

  it('reflects the account the goal links, and saves nothing untouched', async () => {
    const linked = { ...RAINY, marked: true }
    const view = fundView({ counts: 'account', accounts: [linked, EVERYDAY] })
    const server = serveEmergency(view, [
      fundGoal({ accountId: 'acct-rainy', followedAccountIds: null }),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    expect(fund.getByText(/Counts Rainy Day\./)).toBeVisible()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('radio', { name: 'Only the accounts I pick' })).toBeChecked()
    expect(fund.getByRole('checkbox', { name: /Rainy Day/ })).toBeChecked()
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('change_emergency_fund')).toEqual([])
  })

  it("says which goal follows an account, and won't let it be picked", async () => {
    const trip = fundChoice({
      id: 'acct-trip',
      name: 'Trip savings',
      counted: false,
      leftOut: 'other_goal',
      otherGoal: 'Trip',
    })
    serveEmergency(fundView({ accounts: [RAINY, trip] }), [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    expect(fund.getByText('Trip savings is left out, since Trip follows it.')).toBeVisible()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('checkbox', { name: /Trip savings/ })).toBeDisabled()
    expect(fund.getByText('(Trip follows it)')).toBeVisible()
  })

  it('keeps a hidden marked account in view, saying it counts nothing', async () => {
    const hidden = fundChoice({
      id: 'acct-hidden',
      name: 'Spare',
      counted: false,
      marked: true,
      leftOut: 'hidden',
    })
    serveEmergency(fundView({ counts: 'marked', accounts: [hidden, EVERYDAY] }), [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    expect(fund.getByText(/Counts none of the accounts you picked yet\./)).toBeVisible()
    expect(
      fund.getByText('Spare is hidden, so it counts nothing until you show it again.'),
    ).toBeVisible()
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('checkbox', { name: /Spare/ })).toBeChecked()
    expect(fund.getByText('(Hidden)')).toBeVisible()
  })

  it('moves a fund counted by hand onto accounts', async () => {
    const server = serveEmergency(fundView({ counts: 'hand' }), [
      fundGoal({ followedAccountIds: null }),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('radio', { name: 'What I add by hand' })).toBeChecked()
    await user.click(fund.getByRole('radio', { name: 'Every savings account' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: [] }]),
    )
  })

  it('goes back to counting by hand while a count by hand is kept', async () => {
    const server = serveEmergency(FUND, [fundGoal({ savedCents: 20_000 })])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByRole('radio', { name: 'Every savings account' })).toBeChecked()
    await user.click(fund.getByRole('radio', { name: 'What I add by hand' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('change_emergency_fund')).toEqual([{ byHand: true }]))
  })

  it('offers no count by hand when none was ever kept', async () => {
    serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.queryByRole('radio', { name: 'What I add by hand' })).toBeNull()
  })

  it('asks for a savings account when there is none to count', async () => {
    serveEmergency(fundView({ accounts: [] }), [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change accounts' }))
    expect(fund.getByText('Link or add a savings account to hold the fund.')).toBeVisible()
  })
})

describe("another goal's form", () => {
  it('warns that following an account the fund counts leaves it out of the fund', async () => {
    const rainy = account({ id: 'acct-rainy', name: 'Rainy Day', type: 'depository' })
    serveEmergency(FUND, [fundGoal()], { list_accounts: () => [rainy] })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }))
    const form = within(await screen.findByRole('form', { name: 'New goal' }))
    expect(form.queryByText(/Your emergency fund counts/)).toBeNull()
    await user.selectOptions(form.getByRole('combobox', { name: 'Progress' }), 'acct-rainy')
    expect(
      form.getByText(
        'Your emergency fund counts Rainy Day now. Following it here leaves it out of the fund.',
      ),
    ).toBeVisible()
  })
})
