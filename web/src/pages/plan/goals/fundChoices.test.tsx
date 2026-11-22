// Changing what the emergency fund goes by, from its card: the essentials it
// is sized by and the accounts it counts. Each says why an account is left
// out, never counts a dollar another goal follows, and saves nothing untouched.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  essentials,
  EVERYDAY,
  fundCard,
  fundChoice,
  fundGoal,
  fundView,
  offerView,
  RAINY,
  serveEmergency,
} from '../../../test/emergency'
import { account } from '../../../test/fake'
import { renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const FUND = fundView()

describe('the essentials it is sized by', () => {
  it('opens on a tap, ticked as they count now, and saves the pick', async () => {
    const many = essentials({
      categories: ['Rent', 'Groceries', 'Gas', 'Insurance'],
      categoryIds: ['cat-rent', 'cat-groceries', 'cat-gas', 'cat-insurance'],
    })
    const server = serveEmergency(offerView({ essentials: many }))
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    await user.click(offer.getByRole('button', { name: 'Rent, Groceries, Gas and 1 more' }))
    const form = within(await offer.findByRole('form', { name: 'Essential categories' }))
    expect(form.getByRole('checkbox', { name: 'Rent' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Fun' })).not.toBeChecked()
    // Leeway found these, so there is nothing to hand back to it.
    expect(form.queryByRole('button', { name: 'Let Leeway choose' })).toBeNull()
    await user.click(form.getByRole('checkbox', { name: 'Groceries' }))
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { essentialCategoryIds: ['cat-rent', 'cat-gas', 'cat-insurance'] } },
      ]),
    )
    await waitFor(() => expect(offer.queryByRole('form')).toBeNull())
  })

  it('closes on an untouched save without saving, and hands a pick back to Leeway', async () => {
    const server = serveEmergency(fundView({ essentials: essentials({ picked: true }) }), [
      fundGoal(),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Rent and Groceries' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('update_settings')).toEqual([])

    await user.click(fund.getByRole('button', { name: 'Rent and Groceries' }))
    await user.click(fund.getByRole('button', { name: 'Let Leeway choose' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { essentialCategoryIds: null } },
      ]),
    )
  })

  it('starts with every category ticked when all spending counts, and asks for one', async () => {
    const all = essentials({ categories: null, categoryIds: null })
    const server = serveEmergency(fundView({ essentials: all }), [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'your spending' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    for (const name of ['Rent', 'Groceries', 'Fun']) {
      expect(form.getByRole('checkbox', { name })).toBeChecked()
      await user.click(form.getByRole('checkbox', { name }))
    }
    expect(form.getByText('Tick at least one to save.')).toBeVisible()
    expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(form.getByRole('checkbox', { name: 'Rent' }))
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { essentialCategoryIds: ['cat-rent'] } },
      ]),
    )
  })

  it('is plain words when bills size it, since bills have no categories to pick', async () => {
    const bills = essentials({ from: 'bills', categories: null, categoryIds: null })
    serveEmergency(fundView({ essentials: bills }), [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    expect(fund.getByText('What your bills cost in a typical month.')).toBeVisible()
    expect(fund.queryByRole('button', { name: 'your bills' })).toBeNull()
  })
})

describe('the accounts the fund counts', () => {
  it('picks an account, which switches to counting only the picked', async () => {
    const server = serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
    await user.click(fund.getByRole('checkbox', { name: /Rainy Day/ }))
    await user.click(fund.getByRole('checkbox', { name: /Everyday/ }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: ['acct-check'] }]),
    )
  })

  it('asks for at least one account before counting only the picked', async () => {
    serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
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
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change' }))
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
    await user.click(fund.getByRole('button', { name: 'Change' }))
    expect(fund.getByRole('radio', { name: 'What I add by hand' })).toBeChecked()
    await user.click(fund.getByRole('radio', { name: 'Every savings account' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('change_emergency_fund')).toEqual([{ accountIds: [] }]),
    )
  })

  it('asks for a savings account when there is none to count', async () => {
    serveEmergency(fundView({ accounts: [] }), [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    await userEvent.setup().click(fund.getByRole('button', { name: 'Change' }))
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
