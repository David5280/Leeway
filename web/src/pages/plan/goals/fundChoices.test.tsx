// Changing the essentials the emergency fund is sized by, from its card:
// ticked as they count now, saved as the owner's pick or handed back to
// Leeway, and never saved untouched. The accounts it counts are in
// fundAccounts.test.tsx.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  essentials,
  fundCard,
  fundGoal,
  fundView,
  offerView,
  serveEmergency,
} from '../../../test/emergency'
import { category } from '../../../test/fake'
import { renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

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
    expect(offer.getByText(/What Rent, Groceries, Gas and 1 more cost/)).toBeVisible()
    await user.click(offer.getByRole('button', { name: 'Change essentials' }))
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
    const picked = {
      pickedIds: ['cat-rent', 'cat-groceries'],
      spentIds: ['cat-rent', 'cat-groceries'],
    }
    const server = serveEmergency(
      fundView({ essentials: essentials({ picked: true }), essentialsChoice: picked }),
      [fundGoal()],
    )
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    await user.click(fund.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('update_settings')).toEqual([])

    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
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
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
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
    expect(fund.queryByRole('button', { name: 'Change essentials' })).toBeNull()
  })

  it('keeps a pick reachable while bills size the fund, ticked as picked', async () => {
    const bills = essentials({ from: 'bills', categories: null, categoryIds: null, picked: true })
    const choice = { pickedIds: ['cat-rent'], spentIds: [] }
    const server = serveEmergency(fundView({ essentials: bills, essentialsChoice: choice }), [
      fundGoal(),
    ])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    expect(form.getByRole('checkbox', { name: 'Rent' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Groceries' })).not.toBeChecked()
    await user.click(form.getByRole('button', { name: 'Let Leeway choose' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { essentialCategoryIds: null } },
      ]),
    )
  })

  it('lists what counts now first, then the rest under their groups', async () => {
    serveEmergency(fundView(), [fundGoal()], {
      list_categories: () => [
        category('Fun', { group: 'Lifestyle' }),
        category('Rent', { group: 'Home' }),
        category('Pets'),
        category('Groceries', { group: 'Food' }),
        category('Dining', { group: 'Food' }),
        category('Salary', { kind: 'income' }),
      ],
    })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    const groups = form.getAllByRole('group').map((group) => [
      within(group).getByText(/./, { selector: 'legend' }).textContent,
      within(group)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')!.textContent),
    ])
    expect(groups).toEqual([
      ['Counted now', ['Rent', 'Groceries']],
      ['Lifestyle', ['Fun']],
      ['Food', ['Dining']],
      ['Other', ['Pets']],
    ])
  })

  it('says when a ticked category had no recent spending, and closes on Cancel', async () => {
    const server = serveEmergency(fundView(), [fundGoal()], {
      list_categories: () => [category('Rent'), category('Groceries'), category('Pets')],
    })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    expect(form.queryByText(/had no spending/)).toBeNull()
    await user.click(form.getByRole('checkbox', { name: 'Pets' }))
    expect(
      form.getByText('Pets had no spending in recent months, so it adds nothing to the fund.'),
    ).toBeVisible()
    expect(fund.getByRole('button', { name: 'Close essentials' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await user.click(form.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(fund.queryByRole('form')).toBeNull())
    expect(server.actions('update_settings')).toEqual([])
  })

  it("names the categories Leeway counts only in part, which a pick of one's own would not", async () => {
    const partly = essentials({ partlyCounted: ['Debt payments'] })
    serveEmergency(fundView({ essentials: partly }), [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    expect(fund.getByText(/What Rent, Groceries and Debt payments cost/)).toBeVisible()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    expect(
      form.getByText(/^Also counted: the loan and child care payments in Debt payments/),
    ).toBeVisible()
  })

  it('says nothing of a part once the owner picks, since the pick counts whole categories', async () => {
    const picked = { pickedIds: ['cat-rent'], spentIds: ['cat-rent'] }
    const view = fundView({ essentials: essentials({ picked: true }), essentialsChoice: picked })
    serveEmergency(view, [fundGoal()])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Change essentials' }))
    const form = within(await fund.findByRole('form', { name: 'Essential categories' }))
    expect(form.queryByText(/Also counted/)).toBeNull()
  })
})
