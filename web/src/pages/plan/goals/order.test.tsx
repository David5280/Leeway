// "Which goal comes first?": goals in order with the month each lands in, the
// trade-off of a move said plainly, and moves that show at once, keep focus on
// the goal that moved, and go back as they were when the server refuses.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fundGoal, fundView, serveEmergency } from '../../../test/emergency'
import { failing } from '../../../test/fake'
import { car, held, laptop, orderCard, orderOf, serveOrder, trip } from '../../../test/goalOrder'
import { renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

/** The order card's rows. */
async function rows() {
  const card = within(await orderCard())
  return within(card.getByRole('list', { name: 'Goals in order' })).getAllByRole('listitem')
}

/** The order card's rows, as their text. */
const rowTexts = async () => (await rows()).map((row) => row.textContent)

/** The order card's goal names, first to last. */
const namesInOrder = async () =>
  (await rows()).map((row) => row.querySelector('.order-name')?.textContent)

describe('goals in order', () => {
  it('lists each goal with its landing month, and says what moving one up costs', async () => {
    serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(await rowTexts()).toEqual([
      expect.stringContaining('TripLands Mar 2027'),
      expect.stringContaining('CarLands Nov 2027'),
    ])
    expect(
      card.getByText('Moving Car ahead of Trip lands it in Jul 2027 and pushes Trip to Nov 2027.'),
    ).toBeVisible()
    // The first goal cannot go up, nor the last down.
    expect(card.getByRole('button', { name: 'Move Trip up' })).toBeDisabled()
    expect(card.getByRole('button', { name: 'Move Car down' })).toBeDisabled()
  })

  it('shows only once two goals are still being saved for', async () => {
    serveOrder(orderOf([trip]), [trip])
    renderPlan('/plan/goals')
    await screen.findByRole('region', { name: 'Trip' })
    expect(screen.queryByRole('region', { name: 'Which goal comes first?' })).toBeNull()
  })
})

describe('moving a goal', () => {
  it('moves it up, says what that did to the dates, and keeps focus on it at the top', async () => {
    const server = serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Car up' }))
    await waitFor(() =>
      expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-car', 'goal-trip'] }]),
    )
    expect(await card.findByRole('status')).toHaveTextContent(
      'Car now lands Jul 2027. Trip now lands Nov 2027.',
    )
    expect(await namesInOrder()).toEqual(['Car', 'Trip'])
    // Car is first, so it cannot go up again: focus moves to its other button.
    expect(card.getByRole('button', { name: 'Move Car down' })).toHaveFocus()
  })

  it('moves it down the same way', async () => {
    const server = serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Trip down' }))
    await waitFor(() =>
      expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-car', 'goal-trip'] }]),
    )
    await waitFor(() => expect(card.getByRole('button', { name: 'Move Trip up' })).toHaveFocus())
  })

  it('keeps focus on the button pressed while the goal can keep moving that way', async () => {
    serveOrder(orderOf([trip, car, laptop]), [trip, car, laptop])
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Move Laptop up' }))
    expect(await namesInOrder()).toEqual(['Trip', 'Laptop', 'Car'])
    expect(card.getByRole('button', { name: 'Move Laptop up' })).toHaveFocus()
    // From the keyboard, the next press moves it again.
    await waitFor(() => expect(card.getByRole('status')).toBeVisible())
    await user.keyboard('{Enter}')
    expect(await namesInOrder()).toEqual(['Laptop', 'Trip', 'Car'])
  })

  it('shows the move before the server answers, and undoes it when refused', async () => {
    let refuse!: (response: Response) => void
    const answer = new Promise<Response>((resolve) => (refuse = resolve))
    // Reads after the first wait until the test lets them through, so only
    // putting back what was there can bring the old order back before then.
    let letReadsThrough!: () => void
    const readsHeld = new Promise<void>((resolve) => (letReadsThrough = resolve))
    let reads = 0
    const read = async () => {
      if (reads++ > 0) await readsHeld
      return Response.json({ result: orderOf([trip, car]) })
    }
    serveOrder(orderOf([trip, car]), [trip, car], {
      '/api/actions/reorder_goals': held(answer),
      '/api/actions/get_goal_order': () => held(read())(),
    })
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    await userEvent.setup().click(card.getByRole('button', { name: 'Move Car up' }))
    // Moved at once, the goal cards too, with nothing turned off while it saves.
    expect(await namesInOrder()).toEqual(['Car', 'Trip'])
    const cards = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))
    expect(cards.indexOf('Car')).toBeLessThan(cards.indexOf('Trip'))
    expect(card.getByRole('button', { name: 'Move Trip up' })).toBeEnabled()

    refuse(failing('One of those goals no longer exists.')())
    await waitFor(async () => expect(await namesInOrder()).toEqual(['Trip', 'Car']))
    await waitFor(() => expect(card.getByRole('button', { name: 'Move Car up' })).toHaveFocus())
    letReadsThrough()
    expect(await card.findByText('One of those goals no longer exists.')).toBeVisible()
  })

  it('takes no second move while one is saving', async () => {
    let answer!: (response: Response) => void
    const later = new Promise<Response>((resolve) => (answer = resolve))
    const server = serveOrder(orderOf([trip, car]), [trip, car], {
      '/api/actions/reorder_goals': held(later),
    })
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Move Car up' }))
    await user.click(card.getByRole('button', { name: 'Move Trip up' }))
    answer(Response.json({ result: orderOf([car, trip]) }))
    await waitFor(() => expect(card.getByRole('status')).toBeVisible())
    expect(server.actions('reorder_goals')).toEqual([{ ids: ['goal-car', 'goal-trip'] }])
  })

  it('stops saying what a move did once a new amount changes the dates', async () => {
    serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Move Car up' }))
    expect(await card.findByRole('status')).toHaveTextContent('Car now lands Jul 2027.')

    await user.click(card.getByRole('button', { name: 'Change' }))
    const field = card.getByRole('textbox', { name: /How much can you put toward goals/ })
    await user.clear(field)
    await user.type(field, '1000')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(card.queryByRole('status')).toBeNull())
    // The hint about the next move speaks for the new dates instead.
    expect(
      card.getByText('Moving Trip ahead of Car lands it in Jan 2027 and pushes Car to May 2027.'),
    ).toBeVisible()
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
    // The fund's $1,500 to go at $500 a month lands in three months, then the trip's $2,000.
    expect(await rowTexts()).toEqual([
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
