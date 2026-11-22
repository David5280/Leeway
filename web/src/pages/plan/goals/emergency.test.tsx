// The emergency fund on the Goals section: offered in one tap, then shown as
// its goal, its figure opening the math, with the next step to take.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fundCard, fundGoal, fundView, offerView, serveEmergency } from '../../../test/emergency'
import { failing, sentence } from '../../../test/fake'
import { goal, planServer, renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const OFFER = offerView()
const FUND = fundView()

describe('the emergency fund offer', () => {
  it('offers a month of essentials in one tap, with the step after it, then is gone', async () => {
    const server = serveEmergency(OFFER)
    renderPlan('/plan/goals')
    const region = await screen.findByRole('region', { name: 'Start an emergency fund' })
    const offer = within(region)
    expect(offer.getByText('Start with one month of essentials')).toBeVisible()
    expect(offer.getByText('$2,000')).toBeVisible()
    expect(offer.getByText(/^What Rent and Groceries cost in a typical month\./)).toBeVisible()
    expect(offer.getByText(sentence('Then aim for 3 months: $6,000.'))).toBeVisible()
    // No empty-goals card beside the offer: the offer is the way to start.
    expect(screen.queryByText(/No goals yet/)).toBeNull()

    await userEvent.setup().click(offer.getByRole('button', { name: 'Start my emergency fund' }))
    await waitFor(() => expect(server.actions('start_emergency_fund')).toEqual([{}]))
    // Hidden at once, though the server here still offers it.
    await waitFor(() => expect(region).not.toBeInTheDocument())
  })

  it('opens the math behind its figure', async () => {
    serveEmergency(OFFER)
    renderPlan('/plan/goals')
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    await userEvent.setup().click(offer.getByRole('button', { name: /show how it adds up/ }))
    const sheet = within(screen.getByRole('dialog', { name: 'Emergency fund' }))
    expect(sheet.getByText('Counted as essential')).toBeVisible()
    expect(sheet.getByText('Groceries')).toBeVisible()
  })

  it('says why it could not start', async () => {
    planServer(
      {
        list_goals: () => [],
        list_accounts: () => [],
        get_emergency_fund: () => OFFER,
      },
      { '/api/actions/start_emergency_fund': failing('Rainy day is already your emergency fund') },
    )
    renderPlan('/plan/goals')
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    await userEvent.setup().click(offer.getByRole('button', { name: 'Start my emergency fund' }))
    expect(await offer.findByText('Rainy day is already your emergency fund')).toBeVisible()
  })

  it('shows only the picker, with no figure, when the picked essentials had no spending', async () => {
    const quiet = offerView({
      essentials: null,
      essentialsChoice: { pickedIds: ['cat-fun'], spentIds: ['cat-rent'] },
      months: null,
      targetCents: 0,
      monthsCovered: null,
      next: null,
    })
    const server = serveEmergency(quiet)
    renderPlan('/plan/goals')
    const offer = within(await screen.findByRole('region', { name: 'Start an emergency fund' }))
    expect(offer.getByText('Pick what counts as essential')).toBeVisible()
    expect(
      offer.getByText(/^The essentials you picked had no spending in recent months\./),
    ).toBeVisible()
    expect(offer.queryByText('$0')).toBeNull()
    expect(offer.queryByRole('button', { name: 'Start my emergency fund' })).toBeNull()
    // The picker is open at once, saying why the pick adds nothing.
    const form = within(await offer.findByRole('form', { name: 'Essential categories' }))
    expect(form.getByRole('checkbox', { name: 'Fun' })).toBeChecked()
    expect(form.getByText(/^Fun had no spending in recent months/)).toBeVisible()
    await userEvent.setup().click(form.getByRole('button', { name: 'Let Leeway choose' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { essentialCategoryIds: null } },
      ]),
    )
  })

  it('is not offered before spending is known, so the empty card says when it will be', async () => {
    serveEmergency(null)
    renderPlan('/plan/goals')
    expect(
      await screen.findByText(/start an emergency fund once a month of spending/),
    ).toBeVisible()
  })
})

describe('the emergency fund goal', () => {
  it('shows its months, what is left and the next step, and takes it', async () => {
    const server = serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    expect(fund.getByText('1 month of essentials')).toBeVisible()
    expect(fund.getByText(sentence('$1,500 to go.'))).toBeVisible()
    expect(fund.getByText(/Counts every savings account\./)).toBeVisible()
    // Following savings, it takes no money by hand.
    expect(fund.queryByRole('form', { name: /Add to/ })).toBeNull()

    const next = fund.getByRole('button', { name: 'Aim for 3 months: $6,000' })
    expect(next).not.toHaveClass('primary')
    await userEvent.setup().click(next)
    await waitFor(() => expect(server.actions('change_emergency_fund')).toEqual([{ months: 3 }]))
  })

  it('opens how many months it covers from its figure', async () => {
    serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    await userEvent.setup().click(fund.getByRole('button', { name: /show how it adds up/ }))
    const sheet = within(screen.getByRole('dialog', { name: 'Emergency fund' }))
    expect(sheet.getByText('0.2 months')).toBeVisible()
    expect(sheet.getByRole('link', { name: /Rainy Day/ })).toHaveAttribute(
      'href',
      '/accounts/acct-rainy',
    )
  })

  it('cheers a step reached, and makes the next one the main button', async () => {
    serveEmergency(FUND, [fundGoal({ accountBalanceCents: 250_000 })])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    expect(fund.getByText('You have 1 month put by. Nice work.')).toHaveClass('good')
    expect(fund.getByRole('button', { name: 'Aim for 3 months: $6,000' })).toHaveClass('primary')
  })

  it("says the owner's own target in months, never as the step it was", async () => {
    serveEmergency(fundView({ ownTarget: true, months: 2.5, next: null }), [
      fundGoal({ accountBalanceCents: 250_000 }),
    ])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    expect(fund.getByText('About 2.5 months of essentials')).toBeVisible()
    expect(fund.queryByText('1 month of essentials')).toBeNull()
    expect(fund.getByText('You have your target put by. Nice work.')).toBeVisible()
  })

  it('draws a goal only named as the fund as the fund, counted by hand', async () => {
    const named = goal({
      id: 'goal-rainy',
      name: 'Rainy day',
      targetCents: 300_000,
      savedCents: 70_000,
    })
    const view = fundView({ goalId: 'goal-rainy', counts: 'hand', ownTarget: true, months: 1.5 })
    serveEmergency(view, [named])
    renderPlan('/plan/goals')
    const fund = within(await screen.findByRole('region', { name: 'Rainy day' }))
    expect(fund.getByText('About 1.5 months of essentials')).toBeVisible()
    expect(fund.getByText(/Counts what you add by hand\./)).toBeVisible()
    expect(fund.getByRole('form', { name: 'Add to Rainy day' })).toBeVisible()
    // No offer beside it: it is the fund.
    expect(screen.queryByRole('region', { name: 'Start an emergency fund' })).toBeNull()
  })

  it('edits with a hint on how its target is sized, and without the progress fields', async () => {
    serveEmergency(FUND, [fundGoal()])
    renderPlan('/plan/goals')
    const fund = await fundCard()
    await userEvent.setup().click(fund.getByRole('button', { name: 'Edit goal' }))
    const form = within(await screen.findByRole('form', { name: 'Edit Emergency fund' }))
    expect(form.getByText(/^Sized by essentials/)).toBeVisible()
    expect(form.queryByRole('combobox', { name: 'Progress' })).toBeNull()
    expect(form.queryByRole('textbox', { name: 'Saved so far' })).toBeNull()
  })

  it('saves a new name without its target, so the target stays sized by essentials', async () => {
    const server = serveEmergency(FUND, [fundGoal()], { update_goal: () => fundGoal() })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const fund = await fundCard()
    await user.click(fund.getByRole('button', { name: 'Edit goal' }))
    const form = within(await screen.findByRole('form', { name: 'Edit Emergency fund' }))
    await user.clear(form.getByRole('textbox', { name: 'Name' }))
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'Cushion')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_goal')).toHaveLength(1))
    const [saved] = server.actions('update_goal')
    expect(saved).toMatchObject({ id: 'goal-emergency', name: 'Cushion' })
    expect(saved).not.toHaveProperty('targetCents')
  })
})
