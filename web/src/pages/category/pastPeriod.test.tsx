// A category opened from a past period on Spending (?period=-1) shows that
// period's figures, names it and leads back to it. Leeway keeps no budget
// history, so there the budget is shown but cannot be changed: a change would
// change today's budget. Settings that are not per period still save.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category, fakeServer, renderSignedIn } from '../../test/fake'
import { CategoryPage } from '../Category'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000 })

/** Groceries at $240 spent, as the current period or as last month, finished. */
function budgetAt(offset: number) {
  const budget = budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }])
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

function serve() {
  return fakeServer({
    list_categories: () => [groceries],
    get_budget: (input) => budgetAt(Number(input.offset)),
    get_trends: () => [],
    list_transactions: () => ({ transactions: [], total: 0 }),
    list_rules: () => [],
    update_category: (input) => ({ ...groceries, ...input }),
  })
}

/** Shows where the app went, query string included. */
function Landed() {
  const location = useLocation()
  return <p>Landed on Spending{location.search}</p>
}

function renderCategory(route: string) {
  return renderSignedIn(
    <Routes>
      <Route path="/spending/:id" element={<CategoryPage />} />
      <Route path="/spending" element={<Landed />} />
    </Routes>,
    { route },
  )
}

describe('a category on a past period', () => {
  it("shows that period's figures and names it", async () => {
    const server = serve()
    renderCategory(`/spending/${groceries.id}?period=-1`)
    const figures = within(await screen.findByRole('region', { name: 'in October 2026' }))
    expect(figures.getByText('Spent in October 2026')).toBeInTheDocument()
    expect(server.actions('get_budget')).toContainEqual({ offset: -1 })
    expect(server.actions('get_budget')).not.toContainEqual({ offset: 0 })
    // A finished period has no days left to share out and no pace by today.
    expect(figures.queryByText('Per day left')).not.toBeInTheDocument()
    expect(figures.queryByText(/by today/)).not.toBeInTheDocument()
    expect(screen.getByText('Nothing in October 2026.')).toBeInTheDocument()
  })

  it("shows the budget without a way to change it, as budgets are today's", async () => {
    const server = serve()
    renderCategory(`/spending/${groceries.id}?period=-1`)
    expect(
      await screen.findByText(
        "October 2026. Budgets are today's, so they change on the current period.",
      ),
    ).toBeInTheDocument()
    const form = within(screen.getByRole('form', { name: 'Category settings' }))
    expect(form.queryByRole('textbox', { name: 'Budget amount' })).not.toBeInTheDocument()
    expect(form.getByText('$600')).toBeInTheDocument()
    // Saving the other settings keeps the budget as it was.
    const user = userEvent.setup()
    const name = form.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Food at home')
    await user.click(form.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([
        expect.objectContaining({ name: 'Food at home', budgetCents: 60000 }),
      ]),
    )
  })

  it('leads back to the same period', async () => {
    serve()
    renderCategory(`/spending/${groceries.id}?period=-1`)
    await userEvent.click(await screen.findByRole('link', { name: 'All categories' }))
    expect(await screen.findByText('Landed on Spending?period=-1')).toBeInTheDocument()
  })

  it('reads a period it cannot use as the current one', async () => {
    const server = serve()
    renderCategory(`/spending/${groceries.id}?period=soon`)
    await screen.findByRole('region', { name: 'This period' })
    expect(server.actions('get_budget')).toEqual([{ offset: 0 }])
  })
})

describe('a category on the current period', () => {
  it('keeps the budget editable, with no period note, and leads back to Spending', async () => {
    const server = serve()
    renderCategory(`/spending/${groceries.id}`)
    const figures = within(await screen.findByRole('region', { name: 'This period' }))
    expect(figures.getByText('Spent this month')).toBeInTheDocument()
    expect(server.actions('get_budget')).toEqual([{ offset: 0 }])
    const form = within(screen.getByRole('form', { name: 'Category settings' }))
    expect(form.getByRole('textbox', { name: 'Budget amount' })).toHaveValue('600')
    expect(screen.queryByText(/Budgets are today's/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'All categories' }))
    expect(await screen.findByText('Landed on Spending')).toBeInTheDocument()
  })
})
