// "Which goal comes first?": goals in order with the month each lands in, the
// trade-off of a move said plainly, and the monthly amount that fills them.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Goal } from '../../../api/client'
import { landings, type OrderedGoal } from '../../../../../server/src/domain/goalOrder'
import { fundGoal, fundView, serveEmergency } from '../../../test/emergency'
import { failing, sentence } from '../../../test/fake'
import { goal, planServer, renderPlan, TODAY } from '../../../test/planning'
import type { GoalOrder } from './orderText'

afterEach(() => vi.unstubAllGlobals())

const trip = goal({ id: 'goal-trip', name: 'Trip', targetCents: 200_000 })
const car = goal({ id: 'goal-car', name: 'Car', targetCents: 400_000 })

/** The order as the server works it out, from its own math, at $500 a month. */
function orderOf(
  goals: Goal[],
  monthlyCents = 50_000,
  source: GoalOrder['source'] = 'entered',
): GoalOrder {
  const ordered: OrderedGoal[] = goals.map(({ id, name, remainingCents, status }) => ({
    id,
    name,
    remainingCents,
    status,
  }))
  return { monthlyCents, source, goals: landings(ordered, monthlyCents, TODAY) }
}

function serve(order: GoalOrder, goals: Goal[] = [trip, car], routes = {}) {
  return planServer(
    {
      list_goals: () => goals,
      list_accounts: () => [],
      get_goal_order: () => order,
      reorder_goals: () => orderOf([car, trip]),
      update_settings: (patch) => patch,
    },
    routes,
  )
}

const orderCard = () => screen.findByRole('region', { name: 'Which goal comes first?' })

describe('goals in order', () => {
  it('lists each goal with its landing month, and says what moving one up costs', async () => {
    serve(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const rows = within(card.getByRole('list', { name: 'Goals in order' })).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('TripLands Mar 2027'),
      expect.stringContaining('CarLands Nov 2027'),
    ])
    // The line ends with its Change link.
    expect(
      card.getByText(
        sentence(/^Filling them one at a time with \$500 a month, the amount you set\./),
      ),
    ).toBeVisible()
    expect(
      card.getByText('Moving Car ahead of Trip lands it in Jul 2027 and pushes Trip to Nov 2027.'),
    ).toBeVisible()
    // The first goal cannot go up, nor the last down.
    expect(card.getByRole('button', { name: 'Move Trip up' })).toBeDisabled()
    expect(card.getByRole('button', { name: 'Move Car down' })).toBeDisabled()
  })

  it('moves a goal up, then says what the move did to the dates', async () => {
    const server = serve(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Car up' }))
    await waitFor(() =>
      expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-car', 'goal-trip'] }]),
    )
    expect(await card.findByRole('status')).toHaveTextContent(
      'Car now lands Jul 2027. Trip now lands Nov 2027.',
    )
  })

  it('moves a goal down the same way', async () => {
    const server = serve(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Trip down' }))
    await waitFor(() =>
      expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-car', 'goal-trip'] }]),
    )
  })

  it('says why a move failed', async () => {
    serve(orderOf([trip, car]), [trip, car], {
      '/api/actions/reorder_goals': failing('One of those goals no longer exists.'),
    })
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Car up' }))
    expect(await card.findByText('One of those goals no longer exists.')).toBeVisible()
  })

  it('shows only once two goals are still being saved for', async () => {
    serve(orderOf([trip]), [trip])
    renderPlan('/plan/goals')
    await screen.findByRole('region', { name: 'Trip' })
    expect(screen.queryByRole('region', { name: 'Which goal comes first?' })).toBeNull()
  })
})

describe('the emergency fund in the order', () => {
  const fund = fundGoal()

  it('ranks beside the goals, and its card sits in its place among them', async () => {
    const server = serveEmergency(fundView(), [fund, trip], {
      get_goal_order: () => orderOf([fund, trip]),
      reorder_goals: () => orderOf([trip, fund]),
    })
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const rows = within(card.getByRole('list', { name: 'Goals in order' })).getAllByRole('listitem')
    // The fund's $1,500 to go at $500 a month lands in three months, then the trip's $2,000.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Emergency fundLands Feb 2027'),
      expect.stringContaining('TripLands Jun 2027'),
    ])
    // The fund draws its own card, ahead of the trip's as the list has them.
    const fundRegion = await screen.findByRole('region', { name: 'Emergency fund' })
    const tripRegion = screen.getByRole('region', { name: 'Trip' })
    expect(fundRegion.compareDocumentPosition(tripRegion)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await userEvent.setup().click(card.getByRole('button', { name: 'Move Trip up' }))
    await waitFor(() =>
      expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-trip', 'goal-emergency'] }]),
    )
  })
})

describe('the amount that fills goals', () => {
  it('asks for it once when none has gone into goals yet, and saves it', async () => {
    const server = serve(orderOf([trip, car], 0, 'none'))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(card.getAllByText('No date yet')).toHaveLength(2)
    const user = userEvent.setup()
    await user.type(card.getByRole('textbox', { name: 'Each month for goals' }), '500')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { goalsMonthlyCents: 50_000 } },
      ]),
    )
  })

  it('says the pace found lately, and lets it be changed', async () => {
    const server = serve(orderOf([trip, car], 30_000, 'found'))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(
      card.getByText(
        sentence(
          /^Filling them one at a time with \$300 a month, the pace you have saved at lately\./,
        ),
      ),
    ).toBeVisible()
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Change' }))
    const field = card.getByRole('textbox', { name: 'Each month for goals' })
    expect(field).toHaveValue('300')
    await user.clear(field)
    await user.type(field, '650')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { goalsMonthlyCents: 65_000 } },
      ]),
    )
  })
})
