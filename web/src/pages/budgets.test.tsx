import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../api/client'
import {
  budgetFor,
  category,
  failure,
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
    serve([groceries], {}, { '/api/actions/get_budget': failure('The database is down', 500) })
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
  })

  it('marks the amount left as over once spending passes the budgets', async () => {
    fakeServer({
      get_budget: () => budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 70000 }]),
      list_categories: () => [groceries],
    })
    renderBudgets()
    const left = await screen.findByRole('region', { name: 'Left' })
    expect(within(left).getByText('-$100')).toHaveClass('over')
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
    expect(links[1]).toHaveTextContent('No budget, tracking only')
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
    serve([groceries], {}, { '/api/actions/create_category': failure('That name is taken') })
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
