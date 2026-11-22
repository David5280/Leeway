// The monthly amount that fills goals in order: said plainly, asked for once
// when nothing has gone into goals yet, changed or cancelled, and handed back
// to the pace Leeway sees.

import { waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentence } from '../../../test/fake'
import { car, orderCard, orderOf, serveOrder, trip } from '../../../test/goalOrder'
import { renderPlan } from '../../../test/planning'

afterEach(() => vi.unstubAllGlobals())

/** The amount's field, named by the question it answers. */
const AMOUNT = { name: 'How much can you put toward goals each month?' }

describe('the amount that fills goals', () => {
  it('says plainly how the amount the owner set fills them', async () => {
    serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(
      card.getByText(
        sentence(/^Your \$500 a month goes to the top goal until it’s done, then the next\./),
      ),
    ).toBeVisible()
  })

  it('asks for it once when none has gone into goals yet, and saves it', async () => {
    const server = serveOrder(orderOf([trip, car], 0, 'none'))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(card.getAllByText('No date yet')).toHaveLength(2)
    // Nothing to cancel back to, and no pace to hand it to.
    expect(card.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(card.queryByRole('button', { name: 'Use my recent pace instead' })).toBeNull()
    const user = userEvent.setup()
    await user.type(card.getByRole('textbox', AMOUNT), '500')
    await user.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { goalsMonthlyCents: 50_000 } },
      ]),
    )
  })

  it('says the pace found lately, and lets it be changed', async () => {
    const server = serveOrder(orderOf([trip, car], 30_000, 'found'))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(
      card.getByText(
        sentence(
          /^Your recent pace, \$300 a month, goes to the top goal until it’s done, then the next\./,
        ),
      ),
    ).toBeVisible()
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Change' }))
    // Already the pace, so there is no going back to it.
    expect(card.queryByRole('button', { name: 'Use my recent pace instead' })).toBeNull()
    const field = card.getByRole('textbox', AMOUNT)
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

  it('closes unchanged on Cancel', async () => {
    const server = serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Change' }))
    await user.type(card.getByRole('textbox', AMOUNT), '9')
    await user.click(card.getByRole('button', { name: 'Cancel' }))
    expect(card.queryByRole('textbox', AMOUNT)).toBeNull()
    expect(card.getByText(sentence(/^Your \$500 a month/))).toBeVisible()
    expect(server.actions('update_settings')).toEqual([])
  })

  it('hands an amount the owner set back to the pace Leeway sees', async () => {
    const server = serveOrder(orderOf([trip, car]))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    const user = userEvent.setup()
    await user.click(card.getByRole('button', { name: 'Change' }))
    await user.click(card.getByRole('button', { name: 'Use my recent pace instead' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { savingsPlan: { goalsMonthlyCents: null } },
      ]),
    )
    expect(await card.findByText(sentence(/^Your recent pace, \$300 a month/))).toBeVisible()
  })

  it('asks for an amount, rather than saying $0, when the owner set none', async () => {
    serveOrder(orderOf([trip, car], 0, 'entered'))
    renderPlan('/plan/goals')
    const card = within(await orderCard())
    expect(card.getByText(sentence(/^Set an amount to see dates\./))).toBeVisible()
    expect(card.queryByText('$0')).toBeNull()
  })
})
