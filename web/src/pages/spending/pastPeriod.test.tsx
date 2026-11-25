// Looking back on Spending is read-only. Leeway keeps no budget history: each
// category's budget today is applied to every period, so a budget changed
// while looking back would change today's. A past period shows no way to
// change, add or suggest budgets, and says it is measured against today's.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category } from '../../test/fake'
import { groceries, renderSpending, serveSpending } from '../../test/spending'

afterEach(() => vi.unstubAllGlobals())

const coffee = category('Coffee')

/** The budget with groceries at $240 spent, as the current period or as last month. */
function budgetAt(offset: number, list = [groceries, coffee]) {
  const budget = budgetFor(list, [{ categoryId: groceries.id, amountCents: 24000 }])
  if (offset === 0) return budget
  const period = {
    ...budget.period,
    start: '2026-10-01',
    end: '2026-10-31',
    days: 31,
    daysElapsed: 31,
    daysLeft: 0,
    offset,
  }
  return { ...budget, period }
}

function serve(list = [groceries, coffee]) {
  serveSpending(list, { get_budget: (input) => budgetAt(Number(input.offset), list) })
}

/** Every control that changes, adds or suggests a budget. */
function editControls() {
  return [
    screen.queryByRole('button', { name: 'Change Groceries budget' }),
    screen.queryByRole('button', { name: 'Set Coffee budget' }),
    screen.queryByRole('button', { name: 'New category' }),
    screen.queryByRole('button', { name: 'Suggest from my spending' }),
  ]
}

describe('a past period on Spending', () => {
  it('shows the budgets read-only, measured against today’s', async () => {
    serve()
    renderSpending('/spending?period=-1')
    const lead = within(await screen.findByRole('region', { name: 'Spent in October 2026' }))
    expect(editControls().every((control) => control === null)).toBe(true)
    const list = within(screen.getByRole('region', { name: 'Spending categories' }))
    expect(list.getByText("Measured against today's budgets")).toBeInTheDocument()
    expect(within(list.getByRole('group', { name: 'Groceries' })).getByText('$600')).toBeVisible()
    expect(within(list.getByRole('group', { name: 'Coffee' })).getByText('no budget')).toBeVisible()
    const sum = within(lead.getByRole('group', { name: 'How your budgets add up' }))
    expect(sum.getByText("Today's budgets")).toBeInTheDocument()
    expect(sum.getByText('Leeway keeps no budget history')).toBeInTheDocument()
    expect(sum.queryByText('Budgeted')).not.toBeInTheDocument()
  })

  it('offers no suggested budgets when nothing was budgeted', async () => {
    serve([coffee])
    renderSpending('/spending?period=-1')
    const lead = within(await screen.findByRole('region', { name: 'Spent in October 2026' }))
    expect(lead.getByText(/with no budgets to measure it against/)).toBeInTheDocument()
    expect(lead.queryByRole('button', { name: 'Suggest budgets' })).not.toBeInTheDocument()
  })
})

describe('the current period on Spending', () => {
  it('keeps every way to change, add and suggest budgets, labeled as budgeted', async () => {
    serve()
    renderSpending()
    const lead = within(await screen.findByRole('region', { name: 'Spent this month' }))
    expect(editControls().every((control) => control !== null)).toBe(true)
    expect(screen.getByText('Tap an amount to change it')).toBeInTheDocument()
    const sum = within(lead.getByRole('group', { name: 'How your budgets add up' }))
    expect(sum.getByText('Budgeted')).toBeInTheDocument()
    expect(sum.queryByText("Today's budgets")).not.toBeInTheDocument()
  })
})
