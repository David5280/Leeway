import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../api/client'
import { failure, type Handlers } from '../../test/fake'
import { account, goal, planServer, renderPlan } from '../../test/planning'

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
    expect(tripCard.getByText('of $1,200')).toBeInTheDocument()
    expect(tripCard.getByRole('progressbar', { name: 'Trip progress' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(
      tripCard.getByText('$900 to go: about $150 a month to reach it by Apr 30.'),
    ).toBeInTheDocument()
    expect(tripCard.getByRole('form', { name: 'Add to Trip' })).toBeInTheDocument()

    const houseCard = within(screen.getByRole('region', { name: 'House' }))
    expect(houseCard.getByText('Follows the balance of High yield savings.')).toBeInTheDocument()
    expect(houseCard.queryByRole('form')).not.toBeInTheDocument()
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
    serve([trip], {}, { '/api/actions/add_to_goal': failure('Use an amount other than zero') })
    renderPlan('/plan/goals')
    const user = userEvent.setup()
    const add = within(await screen.findByRole('form', { name: 'Add to Trip' }))
    await user.type(add.getByRole('textbox'), '10')
    await user.click(add.getByRole('button', { name: 'Add' }))
    expect(await add.findByRole('alert')).toHaveTextContent('Use an amount other than zero')
  })

  it('shows why goals could not load', async () => {
    serve([], {}, { '/api/actions/list_goals': failure('Database is down', 500) })
    renderPlan('/plan/goals')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})
