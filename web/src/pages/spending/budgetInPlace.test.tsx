// Changing a budget in place on Spending: a tap on a category's amount opens
// a box that saves on Enter or when focus leaves, and keeps it as it was on
// Escape.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { category, failing } from '../../test/fake'
import { groceries, renderSpending, serveSpending } from '../../test/spending'

afterEach(() => vi.unstubAllGlobals())

const coffee = category('Coffee')

describe('changing a budget in place', () => {
  /** The Groceries row, ready to edit. */
  async function groceriesRow() {
    return within(await screen.findByRole('group', { name: 'Groceries' }))
  }

  it('saves a new amount on Enter, in the category own cadence', async () => {
    const weekly = { ...groceries, budgetCadence: 'week' as const, budgetCents: 15000 }
    const server = serveSpending([weekly], {
      update_category: (input) => ({ ...weekly, ...input }),
    })
    renderSpending()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    const amount = row.getByRole('textbox', { name: 'Groceries budget amount' })
    expect(amount).toHaveValue('150')
    expect(amount).toHaveFocus()
    expect(row.getByText('a week')).toBeInTheDocument()
    await user.clear(amount)
    await user.type(amount, '175{Enter}')
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([{ id: groceries.id, budgetCents: 17500 }]),
    )
    await waitFor(() => expect(row.queryByRole('textbox')).not.toBeInTheDocument())
  })

  it('saves when focus leaves the box, and removes the budget when cleared', async () => {
    const server = serveSpending([groceries], { update_category: () => groceries })
    renderSpending()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.clear(row.getByRole('textbox'))
    await user.click(screen.getByRole('heading', { level: 1, name: 'Spending' }))
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([{ id: groceries.id, budgetCents: null }]),
    )
  })

  it('leaves the budget as it was on Escape, or when the amount is unchanged', async () => {
    const server = serveSpending()
    renderSpending()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.type(row.getByRole('textbox'), '9{Escape}')
    expect(row.queryByRole('textbox')).not.toBeInTheDocument()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.type(row.getByRole('textbox'), '{Enter}')
    expect(row.queryByRole('textbox')).not.toBeInTheDocument()
    expect(server.actions('update_category')).toEqual([])
  })

  it('keeps the box open while what was typed is not an amount', async () => {
    const server = serveSpending()
    renderSpending()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    const amount = row.getByRole('textbox')
    await user.clear(amount)
    await user.type(amount, '-20{Enter}')
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(server.actions('update_category')).toEqual([])
  })

  it('sets a first budget on a category only tracked', async () => {
    const server = serveSpending([groceries, coffee], { update_category: () => coffee })
    renderSpending()
    const user = userEvent.setup()
    const row = within(await screen.findByRole('group', { name: 'Coffee' }))
    expect(row.getByText('No budget yet')).toBeInTheDocument()
    await user.click(row.getByRole('button', { name: 'Set Coffee budget' }))
    expect(row.getByRole('textbox')).toHaveValue('')
    await user.type(row.getByRole('textbox'), '40{Enter}')
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([{ id: coffee.id, budgetCents: 4000 }]),
    )
  })

  it('shows why a budget could not be saved, and clears it on Escape', async () => {
    serveSpending(
      [groceries],
      {},
      { '/api/actions/update_category': failing('Budget is too large') },
    )
    renderSpending()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.type(row.getByRole('textbox'), '0{Enter}')
    expect(await row.findByRole('alert')).toHaveTextContent('Budget is too large')
    await user.type(row.getByRole('textbox'), '{Escape}')
    expect(row.queryByRole('alert')).not.toBeInTheDocument()
  })
})
