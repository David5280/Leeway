import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../api/client'
import {
  budgetFor,
  category,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  type Handlers,
} from '../test/fake'
import { Budgets } from './Budgets'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000 })
const coffee = category('Coffee')
const paycheck = category('Paycheck', { kind: 'income' })
const savings = category('Savings', { kind: 'transfer' })

/** The server for the Budgets screen, with groceries budgeted unless a test says otherwise. */
function serve(
  list: Category[] = [groceries],
  extra: Handlers = {},
  routes: Record<string, () => Response> = {},
) {
  return fakeServer(
    {
      get_budget: () => budgetFor(list, [{ categoryId: groceries.id, amountCents: 24000 }]),
      list_categories: () => list,
      ...extra,
    },
    routes,
  )
}

/** Shows where the app went after leaving the Budgets screen. */
function Landed() {
  return <p>Landed on {useLocation().pathname}</p>
}

function renderBudgets() {
  return renderSignedIn(
    <Routes>
      <Route path="/budgets" element={<Budgets />} />
      <Route path="/budgets/:id" element={<Landed />} />
    </Routes>,
    { route: '/budgets' },
  )
}

describe('budgets page', () => {
  it('shows a loading note until the budget arrives', async () => {
    serve()
    const release = holdRequest('/api/actions/get_budget')
    renderBudgets()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    release()
    expect(await screen.findByRole('heading', { name: 'Budgets' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says why the budget could not load, without a loading note', async () => {
    serve([groceries], {}, { '/api/actions/get_budget': failing('The database is down', 500) })
    renderBudgets()
    expect(await screen.findByRole('alert')).toHaveTextContent('The database is down')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says there are no categories yet when none exist', async () => {
    serve([])
    renderBudgets()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    expect(spending).toHaveTextContent('No categories yet.')
    expect(screen.queryByRole('region', { name: 'Income and transfers' })).not.toBeInTheDocument()
  })

  it('totals what is budgeted, spent and left this period', async () => {
    serve()
    renderBudgets()
    expect(await screen.findByRole('region', { name: 'Budgeted' })).toHaveTextContent('$600')
    expect(screen.getByRole('region', { name: 'Spent' })).toHaveTextContent('$240')
    expect(screen.getByRole('region', { name: 'Left' })).toHaveTextContent('$360')
    const used = screen.getByRole('progressbar', { name: 'Budgets used' })
    expect(used).toHaveAttribute('aria-valuenow', '40')
    expect(used).toHaveClass('ring-ok')
  })

  it('marks the amount left as over once spending passes the budgets', async () => {
    fakeServer({
      get_budget: () => budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 70000 }]),
      list_categories: () => [groceries],
    })
    renderBudgets()
    const left = await screen.findByRole('region', { name: 'Left' })
    expect(within(left).getByText('−$100')).toHaveClass('money-problem')
    const used = screen.getByRole('progressbar', { name: 'Budgets used' })
    expect(used).toHaveAttribute('aria-valuetext', '117%')
    expect(used).toHaveClass('ring-over')
  })

  it('leaves out the ring until something is budgeted', async () => {
    serve([category('Coffee')])
    renderBudgets()
    await screen.findByRole('region', { name: 'Spent' })
    expect(screen.queryByRole('progressbar', { name: 'Budgets used' })).not.toBeInTheDocument()
  })

  it('lists categories under their group headings, with ungrouped ones last', async () => {
    const food = { group: 'Food and drink' }
    const alcohol = category('Alcohol', food)
    const mine = category('Bourbon club', { budgetCents: 5000 })
    serve([{ ...groceries, ...food }, mine, alcohol])
    renderBudgets()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    const order = within(spending)
      .getAllByText(/^(Food and drink|Other|Groceries|Alcohol|Bourbon club)$/)
      .map((element) => element.textContent)
    expect(order).toEqual(['Food and drink', 'Groceries', 'Alcohol', 'Other', 'Bourbon club'])
    // With groups, budgeted and tracked categories stay together under their heading.
    expect(within(spending).queryByText('Tracking only')).not.toBeInTheDocument()
  })

  it('lists budgeted categories first, then the ones only tracked', async () => {
    serve([coffee, groceries])
    renderBudgets()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    const links = within(spending).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/budgets/${groceries.id}`,
      `/budgets/${coffee.id}`,
    ])
    expect(within(spending).getByText('Tracking only')).toBeInTheDocument()
    expect(within(spending).getByRole('group', { name: 'Coffee' })).toHaveTextContent(
      'No budget yet',
    )
  })

  it('hides the tracking only heading when every category has a budget', async () => {
    serve()
    renderBudgets()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    expect(within(spending).queryByText('Tracking only')).not.toBeInTheDocument()
  })

  it('lists income as money in and transfers as not counted, each linking to its page', async () => {
    fakeServer({
      get_budget: () => budgetFor([paycheck], [{ categoryId: paycheck.id, amountCents: -500000 }]),
      list_categories: () => [paycheck, savings],
    })
    renderBudgets()
    const section = await screen.findByRole('region', { name: 'Income and transfers' })
    const income = within(section).getByRole('link', { name: /Paycheck/ })
    expect(income).toHaveTextContent('$5,000 in')
    expect(income).toHaveAttribute('href', `/budgets/${paycheck.id}`)
    const transfer = within(section).getByRole('link', { name: /Savings/ })
    expect(transfer).toHaveTextContent('Not counted')
    expect(transfer).toHaveAttribute('href', `/budgets/${savings.id}`)
  })
})

describe('adding a category', () => {
  it('adds a category with its budget and opens its page', async () => {
    const server = serve([groceries], {
      create_category: (input) => ({ ...category(input.name as string), ...input }),
    })
    renderBudgets()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    const form = screen.getByRole('form', { name: 'New category' })
    await user.type(within(form).getByLabelText('Name'), 'Pet care')
    await user.type(within(form).getByLabelText('Budget amount'), '75')
    await user.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('Landed on /budgets/cat-pet-care')).toBeInTheDocument()
    expect(server.actions('create_category')).toEqual([
      expect.objectContaining({ name: 'Pet care', kind: 'expense', budgetCents: 7500 }),
    ])
  })

  it('shows the saving state while the category is being added', async () => {
    serve([groceries], { create_category: () => category('Pet care') })
    const release = holdRequest('/api/actions/create_category')
    renderBudgets()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    await user.type(screen.getByLabelText('Name'), 'Pet care')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeDisabled()
    release()
    expect(await screen.findByText('Landed on /budgets/cat-pet-care')).toBeInTheDocument()
  })

  it('keeps the form open with the reason when the server refuses the category', async () => {
    serve([groceries], {}, { '/api/actions/create_category': failing('That name is taken') })
    renderBudgets()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    const form = screen.getByRole('form', { name: 'New category' })
    await user.type(within(form).getByLabelText('Name'), 'Groceries')
    await user.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('That name is taken')
    expect(screen.getByRole('heading', { name: 'Budgets' })).toBeInTheDocument()
  })

  it('closes the form without adding anything on cancel', async () => {
    const server = serve()
    renderBudgets()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New category' })).not.toBeInTheDocument()
    expect(server.actions('create_category')).toEqual([])
  })
})

describe('changing a budget in place', () => {
  /** The Groceries row, ready to edit. */
  async function groceriesRow() {
    return within(await screen.findByRole('group', { name: 'Groceries' }))
  }

  it('saves a new amount on Enter, in the category own cadence', async () => {
    const weekly = { ...groceries, budgetCadence: 'week' as const, budgetCents: 15000 }
    const server = serve([weekly], { update_category: (input) => ({ ...weekly, ...input }) })
    renderBudgets()
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
    const server = serve([groceries], { update_category: () => groceries })
    renderBudgets()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.clear(row.getByRole('textbox'))
    await user.click(screen.getByRole('heading', { name: 'Budgets' }))
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([{ id: groceries.id, budgetCents: null }]),
    )
  })

  it('leaves the budget as it was on Escape, or when the amount is unchanged', async () => {
    const server = serve()
    renderBudgets()
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
    const server = serve()
    renderBudgets()
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
    const server = serve([groceries, coffee], { update_category: () => coffee })
    renderBudgets()
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
    serve([groceries], {}, { '/api/actions/update_category': failing('Budget is too large') })
    renderBudgets()
    const user = userEvent.setup()
    const row = await groceriesRow()
    await user.click(row.getByRole('button', { name: 'Change Groceries budget' }))
    await user.type(row.getByRole('textbox'), '0{Enter}')
    expect(await row.findByRole('alert')).toHaveTextContent('Budget is too large')
    await user.type(row.getByRole('textbox'), '{Escape}')
    expect(row.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('budget rows in plain words', () => {
  const dining = category('Dining out', { budgetCents: 30000 })

  it('says what is left for how many days, and about how much a day', async () => {
    serve()
    renderBudgets()
    const row = within(await screen.findByRole('group', { name: 'Groceries' }))
    expect(row.getByText('$360 left for 14 days, about $25 a day')).toBeInTheDocument()
    expect(row.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
      'href',
      `/budgets/${groceries.id}`,
    )
  })

  it('says how far over a category is and what to do about it', async () => {
    fakeServer({
      get_budget: () =>
        budgetFor(
          [groceries, dining],
          [
            { categoryId: groceries.id, amountCents: 20000 },
            { categoryId: dining.id, amountCents: 31200 },
          ],
        ),
      list_categories: () => [groceries, dining],
    })
    renderBudgets()
    const row = within(await screen.findByRole('group', { name: 'Dining out' }))
    expect(row.getByText('Over by $12')).toHaveClass('over')
    expect(
      row.getByText(
        'Cover the $12 from Groceries, which has $400 left, or raise this budget. It starts fresh Dec 1.',
      ),
    ).toBeInTheDocument()
  })

  it('labels what rolled over into a budget', async () => {
    const rolling = { ...groceries, rollover: true, rolloverSince: '2026-09-01' }
    fakeServer({
      get_budget: () =>
        budgetFor([rolling], [{ categoryId: groceries.id, amountCents: 24000 }], {
          carries: new Map([[groceries.id, 4000]]),
        }),
      list_categories: () => [rolling],
    })
    renderBudgets()
    const row = within(await screen.findByRole('group', { name: 'Groceries' }))
    expect(row.getByText('+$40 rolled over')).toBeInTheDocument()
    // The budget shown includes what rolled over; editing changes the category's own amount.
    expect(row.getByRole('button', { name: 'Change Groceries budget' })).toHaveTextContent('$640')
  })

  it('notes what goals hold back from what is left', async () => {
    fakeServer({
      get_budget: () =>
        budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }], {
          setAsides: [
            { goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 15000 },
          ],
        }),
      list_categories: () => [groceries],
    })
    renderBudgets()
    const left = await screen.findByRole('region', { name: 'Left' })
    const link = within(left).getByRole('link', { name: '$150 of it set aside for goals' })
    expect(link).toHaveAttribute('href', '/plan/goals')
    // The amount and words in one box, so the flex link on a phone keeps the space between.
    expect(link.children).toHaveLength(1)
    expect(link.firstElementChild).toHaveTextContent(/^\$150 of it set aside for goals$/)
  })

  it('draws an empty bar for a budget of zero with nothing spent', async () => {
    const none = category('Gifts', { budgetCents: 0 })
    serve([none])
    renderBudgets()
    const row = within(await screen.findByRole('group', { name: 'Gifts' }))
    expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    expect(row.getByText('All used for this period')).toBeInTheDocument()
  })

  it('waits for a category the list has not caught up on yet', async () => {
    fakeServer({
      get_budget: () =>
        budgetFor([groceries, coffee], [{ categoryId: groceries.id, amountCents: 24000 }]),
      list_categories: () => [groceries],
    })
    renderBudgets()
    expect(await screen.findByRole('group', { name: 'Groceries' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Coffee' })).not.toBeInTheDocument()
  })
})
