import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../../api/client'
import { failing, sentence, type Handlers } from '../../../test/fake'
import { account, goal, planServer, renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const savings = account({ id: 'acct-savings', name: 'High yield savings', balanceCents: 240000 })
const card = account({ id: 'acct-card', name: 'Rewards card', type: 'credit' })
const hiddenSavings = account({ id: 'acct-old', name: 'Old savings', hidden: true })

const trip = goal({
  id: 'goal-trip',
  name: 'Trip',
  targetCents: 120000,
  savedCents: 30000,
  targetDate: '2027-04-30',
  color: '#E0622D',
})
const house = goal({
  id: 'goal-house',
  name: 'House',
  targetCents: 4000000,
  accountId: savings.id,
  accountName: savings.name,
  accountBalanceCents: savings.balanceCents,
})

function serve(goals: Goal[] = [trip, house], extra: Handlers = {}, routes = {}) {
  return planServer(
    {
      list_goals: () => goals,
      list_accounts: () => [savings, card, hiddenSavings],
      create_goal: (input) => goal(input as Parameters<typeof goal>[0]),
      update_goal: (input) => ({ ...trip, ...input }),
      delete_goal: (input) => ({ deleted: input.id }),
      add_to_goal: () => trip,
      ...extra,
    },
    routes,
  )
}

describe('Goals', () => {
  it('shows progress and what each goal still needs', async () => {
    serve()
    renderPlan('/plan/goals')
    const tripCard = within(await screen.findByRole('region', { name: 'Trip' }))
    expect(tripCard.getByText('$300')).toBeInTheDocument()
    expect(tripCard.getByText(sentence('of $1,200'))).toBeInTheDocument()
    expect(tripCard.getByRole('progressbar', { name: 'Trip progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(
      tripCard.getByText(
        sentence('$900 to go: set aside $150 each month to reach it by Apr 30, 2027.'),
      ),
    ).toBeInTheDocument()
    expect(tripCard.getByText(sentence('$0 of $150 put aside this month.'))).toBeInTheDocument()
    expect(tripCard.getByText('Behind: nothing was put toward it lately.')).toHaveClass('warn')
    expect(tripCard.getByRole('img', { name: 'Trip timeline' })).toHaveAccessibleDescription(
      'Today is Nov 17, 2026. The goal date is Apr 30, 2027. There is no recent progress to project from.',
    )
    expect(tripCard.getByRole('form', { name: 'Add to Trip' })).toBeInTheDocument()

    const houseCard = within(screen.getByRole('region', { name: 'House' }))
    expect(houseCard.getByText('Follows the balance of High yield savings.')).toBeInTheDocument()
    expect(houseCard.queryByRole('form')).not.toBeInTheDocument()
    // No date and no recent progress: nothing to draw a timeline from.
    expect(houseCard.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a goal on an account no longer shared as of that day, with no timeline', async () => {
    const frozen = goal({ ...house, targetDate: '2027-11-30', balanceAsOf: '2026-11-10' })
    serve([frozen])
    renderPlan('/plan/goals')
    const houseCard = within(await screen.findByRole('region', { name: 'House' }))
    expect(
      houseCard.getByText(
        sentence(
          '$2,400 saved as of Nov 10, 2026, when the bank stopped sharing High yield savings. Link the goal to another account or count it by hand.',
        ),
      ),
    ).toBeInTheDocument()
    expect(houseCard.queryByRole('img')).not.toBeInTheDocument()
  })

  it('suggests a first goal when there are none', async () => {
    serve([])
    renderPlan('/plan/goals')
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument()
  })

  it('adds a goal counted by hand', async () => {
    const server = serve([])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }))
    const form = within(screen.getByRole('form', { name: 'New goal' }))
    expect(form.getByRole('button', { name: 'Add goal' })).toBeDisabled()
    await user.type(form.getByLabelText('Name'), 'Emergency fund')
    await user.type(form.getByRole('textbox', { name: 'Target amount' }), '5,000')
    await user.type(form.getByLabelText('Target date'), '2027-06-30')
    await user.type(form.getByRole('textbox', { name: 'Saved so far' }), '250')
    await user.click(form.getByRole('radio', { name: 'Violet' }))
    await user.click(form.getByRole('button', { name: 'Add goal' }))
    await waitFor(() => expect(server.actions('create_goal')).toHaveLength(1))
    expect(server.actions('create_goal')[0]).toEqual({
      name: 'Emergency fund',
      kind: 'savings',
      setAside: false,
      targetCents: 500000,
      targetDate: '2027-06-30',
      accountId: null,
      savedCents: 25000,
      color: '#7F70E0',
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New goal' })).not.toBeInTheDocument(),
    )
  })

  it('links a goal to a savings account, offering only visible checking and savings', async () => {
    const server = serve([])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }))
    const form = within(screen.getByRole('form', { name: 'New goal' }))
    const progress = form.getByRole('combobox', { name: 'Progress' })
    expect(
      within(progress)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Count it myself', 'Follow High yield savings'])
    await user.type(form.getByLabelText('Name'), 'House')
    await user.type(form.getByRole('textbox', { name: 'Target amount' }), '40000')
    await user.selectOptions(progress, 'Follow High yield savings')
    // Nothing to count by hand once it follows an account.
    expect(form.queryByRole('textbox', { name: 'Saved so far' })).not.toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Add goal' }))
    await waitFor(() => expect(server.actions('create_goal')).toHaveLength(1))
    expect(server.actions('create_goal')[0]).toMatchObject({
      accountId: savings.id,
      targetDate: null,
      savedCents: 0,
    })
  })

  it('edits a goal and closes on cancel', async () => {
    const server = serve()
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const tripCard = within(await screen.findByRole('region', { name: 'Trip' }))
    await user.click(tripCard.getByRole('button', { name: 'Edit' }))
    const form = within(screen.getByRole('form', { name: 'Edit Trip' }))
    expect(form.getByRole('textbox', { name: 'Saved so far' })).toHaveValue('300')
    expect(form.getByRole('radio', { name: 'Orange' })).toHaveAttribute('aria-checked', 'true')
    await user.clear(form.getByRole('textbox', { name: 'Target amount' }))
    await user.type(form.getByRole('textbox', { name: 'Target amount' }), '1500')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_goal')).toHaveLength(1))
    expect(server.actions('update_goal')[0]).toMatchObject({
      id: trip.id,
      targetCents: 150000,
      savedCents: 30000,
      targetDate: '2027-04-30',
    })

    await user.click(tripCard.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Edit Trip' })).not.toBeInTheDocument()
  })

  it('deletes a goal', async () => {
    const server = serve()
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const houseCard = within(await screen.findByRole('region', { name: 'House' }))
    await user.click(houseCard.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(server.actions('delete_goal')).toEqual([{ id: house.id }]))
  })

  it('adds money to a goal and clears the box', async () => {
    const server = serve()
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const add = within(await screen.findByRole('form', { name: 'Add to Trip' }))
    const amount = add.getByRole('textbox', { name: 'Amount to add to Trip' })
    expect(add.getByRole('button', { name: 'Add' })).toBeDisabled()
    await user.type(amount, '-50')
    await user.click(add.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(server.actions('add_to_goal')).toEqual([{ id: trip.id, amountCents: -5000 }]),
    )
    await waitFor(() => expect(amount).toHaveValue(''))
  })

  it('shows why money could not be added, or goals could not load', async () => {
    serve([trip], {}, { '/api/actions/add_to_goal': failing('Use an amount other than zero') })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const add = within(await screen.findByRole('form', { name: 'Add to Trip' }))
    await user.type(add.getByRole('textbox'), '10')
    await user.click(add.getByRole('button', { name: 'Add' }))
    expect(await add.findByRole('alert')).toHaveTextContent('Use an amount other than zero')
  })

  it('shows why goals could not load', async () => {
    serve([], {}, { '/api/actions/list_goals': failing('Database is down', 500) })
    renderPlan('/plan/goals')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })

  it('shows why goals could not load when the date is unavailable', async () => {
    serve([trip], {}, { '/api/actions/get_cash_flow': failing('Cash flow is down', 500) })
    renderPlan('/plan/goals')
    expect((await screen.findAllByText('Cash flow is down')).length).toBeGreaterThan(0)
  })
})

/** $600 put in over the last 90 days, $60 of it this month: fast enough for April. */
const quick = { savedThisPeriodCents: 6000, recentSavedCents: 60000, recentDays: 90 }

const bike = goal(
  {
    id: 'goal-bike',
    name: 'Road bike',
    kind: 'purchase',
    targetCents: 120000,
    savedCents: 30000,
    targetDate: '2027-04-30',
    setAside: true,
  },
  quick,
)

describe('Saving for a purchase', () => {
  it('saves for a purchase, setting money aside once it has a date', async () => {
    const server = serve([])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Save for a purchase' }))
    expect(screen.getByRole('heading', { name: 'Save for a purchase' })).toBeInTheDocument()
    const form = within(screen.getByRole('form', { name: 'New purchase' }))
    const setAside = form.getByRole('switch', { name: 'Set aside from my budget' })
    // Without a date there is no share to hold back.
    expect(setAside).toBeDisabled()
    expect(form.getByText('Give it a date first, so there is a share to hold back')).toBeVisible()
    await user.type(form.getByLabelText('What are you saving for?'), 'Road bike')
    await user.type(form.getByRole('textbox', { name: 'Price' }), '1,800')
    await user.type(form.getByLabelText('Target date'), '2027-04-30')
    expect(setAside).toBeEnabled()
    await user.click(setAside)
    expect(setAside).toHaveAttribute('aria-checked', 'true')
    await user.click(form.getByRole('button', { name: 'Start saving' }))
    await waitFor(() => expect(server.actions('create_goal')).toHaveLength(1))
    expect(server.actions('create_goal')[0]).toMatchObject({
      name: 'Road bike',
      kind: 'purchase',
      targetCents: 180000,
      targetDate: '2027-04-30',
      setAside: true,
    })
  })

  it('stops setting money aside when the date is cleared', async () => {
    const server = serve([bike])
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const card = within(await screen.findByRole('region', { name: 'Road bike' }))
    await user.click(card.getByRole('button', { name: 'Edit' }))
    const form = within(screen.getByRole('form', { name: 'Edit Road bike' }))
    const setAside = form.getByRole('switch', { name: 'Set aside from my budget' })
    expect(setAside).toHaveAttribute('aria-checked', 'true')
    await user.clear(form.getByLabelText('Target date'))
    expect(setAside).toHaveAttribute('aria-checked', 'false')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_goal')).toHaveLength(1))
    expect(server.actions('update_goal')[0]).toMatchObject({
      kind: 'purchase',
      targetDate: null,
      setAside: false,
    })
  })

  it('opens straight onto a new purchase from the overview link', async () => {
    serve([])
    renderPlan('/plan/goals?new=purchase')
    expect(await screen.findByRole('form', { name: 'New purchase' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New purchase' })).not.toBeInTheDocument()
  })

  it("shows a purchase's share held from the budget, its pace and its timeline", async () => {
    serve([bike])
    renderPlan('/plan/goals')
    const card = within(await screen.findByRole('region', { name: 'Road bike' }))
    expect(card.getByText('Purchase')).toBeInTheDocument()
    expect(card.getByText(sentence("$160 held from this month's budget"))).toBeInTheDocument()
    expect(
      card.getByText(sentence('$900 to go: set aside $160 each month to buy it by Apr 30, 2027.')),
    ).toBeInTheDocument()
    expect(card.getByText(sentence('$60 of $160 put aside this month.'))).toBeInTheDocument()
    expect(card.getByText('On track: at your recent pace, ready by Apr 1, 2027.')).toHaveClass(
      'good',
    )
    const timeline = card.getByRole('img', { name: 'Road bike timeline' })
    expect(timeline).toHaveAccessibleDescription(
      'Today is Nov 17, 2026. The goal date is Apr 30, 2027. At the recent pace it is ready Apr 1, 2027.',
    )
    expect(within(timeline).getByText('Buy by Apr 30, 2027')).toBeInTheDocument()
    expect(within(timeline).getByText('At this pace Apr 1, 2027')).toBeInTheDocument()
  })

  it('draws where recent progress lands for a goal with no date', async () => {
    serve([goal({ name: 'Rainy day', targetCents: 120000, savedCents: 30000 }, quick)])
    renderPlan('/plan/goals')
    const card = within(await screen.findByRole('region', { name: 'Rainy day' }))
    expect(card.getByRole('img', { name: 'Rainy day timeline' })).toHaveAccessibleDescription(
      'Today is Nov 17, 2026. At the recent pace it is ready Apr 1, 2027.',
    )
    expect(card.getByText('At your recent pace, ready by Apr 1, 2027.')).toBeInTheDocument()
  })

  it('says a purchase is ready to buy once it is saved, with no timeline left', async () => {
    serve([goal({ name: 'Road bike', kind: 'purchase', targetCents: 120000, savedCents: 120000 })])
    renderPlan('/plan/goals')
    const card = within(await screen.findByRole('region', { name: 'Road bike' }))
    expect(card.getByText('Ready to buy. You have saved the full $1,200.')).toBeInTheDocument()
    expect(card.queryByRole('img')).not.toBeInTheDocument()
    expect(card.queryByText(/held from/)).not.toBeInTheDocument()
  })

  it('draws a goal behind its date in the warning color', async () => {
    const slow = { savedThisPeriodCents: 0, recentSavedCents: 9000, recentDays: 90 }
    serve([goal({ ...trip, id: 'goal-trip' }, slow)])
    renderPlan('/plan/goals')
    const card = within(await screen.findByRole('region', { name: 'Trip' }))
    expect(
      card.getByText('Behind: at your recent pace, ready May 5, 2029, after Apr 30, 2027.'),
    ).toHaveClass('warn')
    const timeline = card.getByRole('img', { name: 'Trip timeline' })
    expect(timeline.querySelector('.timeline-pace')?.getAttribute('style')).toContain('var(--warn)')
  })
})

describe('Goal history', () => {
  const entries = [
    { id: 'c2', amountCents: -1000, date: '2026-11-10' },
    { id: 'c1', amountCents: 5000, date: '2026-10-02' },
  ]

  it('lists what was recorded, newest first, and hides it again', async () => {
    const server = serve([trip], { list_goal_contributions: () => entries })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const card = within(await screen.findByRole('region', { name: 'Trip' }))
    await user.click(card.getByRole('button', { name: 'History' }))
    const list = within(await card.findByRole('list', { name: 'Trip history' }))
    expect(list.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Nov 10, 2026-$10.00',
      'Oct 2, 2026+$50.00',
    ])
    expect(server.actions('list_goal_contributions')).toEqual([{ id: trip.id, limit: 5 }])
    await user.click(card.getByRole('button', { name: 'Hide history' }))
    expect(card.queryByRole('list')).not.toBeInTheDocument()
  })

  it('says when nothing was recorded yet', async () => {
    serve([trip], { list_goal_contributions: () => [] })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const card = within(await screen.findByRole('region', { name: 'Trip' }))
    await user.click(card.getByRole('button', { name: 'History' }))
    expect(await card.findByText(/Nothing recorded yet/)).toBeInTheDocument()
  })

  it('shows why the history could not load', async () => {
    serve([trip], {}, { '/api/actions/list_goal_contributions': failing('History is down', 500) })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const card = within(await screen.findByRole('region', { name: 'Trip' }))
    await user.click(card.getByRole('button', { name: 'History' }))
    expect(await card.findByRole('alert')).toHaveTextContent('History is down')
  })
})
