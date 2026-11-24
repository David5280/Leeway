// A trip budget's goal on its card: a way to its trip's page, a word when the
// trip is gone from the calendar, and closing the goal once the trip is done.
// Its form leaves the amount and date to the budget.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../../api/client'
import { failing } from '../../../test/fake'
import { goal, planServer, renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

/** The Lisbon trip's goal, on these days; November 17th is the test's today. */
const lisbon = (startsOn: string, endsOn: string, onCalendar = true) =>
  goal({
    id: 'goal-lisbon',
    name: 'Lisbon trip',
    kind: 'purchase',
    targetCents: 185000,
    savedCents: 90000,
    targetDate: startsOn,
    setAside: true,
    trip: { startsOn, endsOn, onCalendar },
  })

function serve(goals: Goal[], routes = {}) {
  return planServer(
    {
      list_goals: () => goals,
      list_accounts: () => [],
      delete_goal: (input) => ({ deleted: input.id }),
      update_goal: (input) => ({ ...goals[0], ...input }),
    },
    routes,
  )
}

const card = async () => within(await screen.findByRole('region', { name: 'Lisbon trip' }))

describe('a trip budget’s goal', () => {
  it('links to its trip, and offers no closing before the trip is done', async () => {
    serve([lisbon('2026-12-10', '2026-12-14')])
    renderPlan('/plan/goals')
    const trip = await card()
    expect(trip.getByRole('link', { name: 'Open the trip' })).toHaveAttribute(
      'href',
      '/trips/2026-12-10/2026-12-14',
    )
    expect(trip.queryByRole('button', { name: 'Close goal' })).not.toBeInTheDocument()
  })

  it('reads as under way, never late, while the trip is on', async () => {
    serve([lisbon('2026-11-15', '2026-11-20')])
    renderPlan('/plan/goals')
    const trip = await card()
    expect(trip.getByText('Trip under way. This goal is being spent on it.')).toBeInTheDocument()
    expect(trip.queryByText(/date has passed/i)).not.toBeInTheDocument()
  })

  it('closes once the trip is done, asking first', async () => {
    const user = userEvent.setup()
    const server = serve([lisbon('2026-11-10', '2026-11-14')])
    renderPlan('/plan/goals')
    const trip = await card()
    expect(trip.getByText('Trip done. Close the goal when you are ready.')).toBeInTheDocument()
    await user.click(trip.getByRole('button', { name: 'Close goal' }))
    expect(trip.getByText('Its trip budget goes too.')).toBeInTheDocument()
    await user.click(trip.getByRole('button', { name: 'Keep' }))
    expect(server.actions('delete_goal')).toEqual([])
    await user.click(trip.getByRole('button', { name: 'Close goal' }))
    await user.click(trip.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(server.actions('delete_goal')).toEqual([{ id: 'goal-lisbon' }]))
  })

  it('says when its trip is gone from the calendar, and can be closed', async () => {
    const user = userEvent.setup()
    serve([lisbon('2026-12-10', '2026-12-14', false)], {
      '/api/actions/delete_goal': failing('Could not delete it'),
    })
    renderPlan('/plan/goals')
    const trip = await card()
    expect(trip.getByText(/no longer on your calendar/)).toHaveClass('warn')
    expect(trip.queryByRole('link', { name: 'Open the trip' })).not.toBeInTheDocument()
    await user.click(trip.getByRole('button', { name: 'Close goal' }))
    await user.click(trip.getByRole('button', { name: 'Close' }))
    expect(await trip.findByText('Could not delete it')).toBeInTheDocument()
  })

  it('leaves its amount and date to the budget in its form, pointing to the trip', async () => {
    const user = userEvent.setup()
    const server = serve([lisbon('2026-12-10', '2026-12-14')])
    renderPlan('/plan/goals')
    await user.click((await card()).getByRole('button', { name: 'Edit' }))
    const form = within(screen.getByRole('form', { name: 'Edit Lisbon trip' }))
    // Before, both were fields, and the server refused any change to them.
    expect(form.queryByRole('textbox', { name: 'Price' })).not.toBeInTheDocument()
    expect(form.queryByLabelText('Target date')).not.toBeInTheDocument()
    expect(form.getByRole('link', { name: "Change them on the trip's page" })).toHaveAttribute(
      'href',
      '/trips/2026-12-10/2026-12-14',
    )
    await user.clear(form.getByRole('textbox', { name: 'What are you saving for?' }))
    await user.type(form.getByRole('textbox', { name: 'What are you saving for?' }), 'Portugal')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(server.actions('update_goal')).toHaveLength(1))
    // The date goes back as it was, which the server takes as no change.
    expect(server.actions('update_goal')[0]).toMatchObject({
      name: 'Portugal',
      targetDate: '2026-12-10',
    })
    expect(server.actions('update_goal')[0]).not.toHaveProperty('targetCents')
  })

  it('says, with its trip off the calendar, where its amount and date would change', async () => {
    const user = userEvent.setup()
    serve([lisbon('2026-12-10', '2026-12-14', false)])
    renderPlan('/plan/goals')
    await user.click((await card()).getByRole('button', { name: 'Edit' }))
    const form = within(screen.getByRole('form', { name: 'Edit Lisbon trip' }))
    expect(form.getByText(/Put the trip back on your calendar/)).toBeInTheDocument()
    expect(form.queryByRole('link')).not.toBeInTheDocument()
  })
})
