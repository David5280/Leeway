// Budgets by category on Spending: the categories in the order that reads
// best, a new category, and each budget's row in plain words.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, category, failing, fakeServer, holdRequest } from '../../test/fake'
import { groceries, renderSpending, serveSpending } from '../../test/spending'

afterEach(() => vi.unstubAllGlobals())

const coffee = category('Coffee')
const paycheck = category('Paycheck', { kind: 'income' })
const savings = category('Savings', { kind: 'transfer' })

describe('budgets by category', () => {
  it('says there are no categories yet when none exist', async () => {
    serveSpending([])
    renderSpending()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    expect(spending).toHaveTextContent('No categories yet.')
    expect(screen.queryByRole('region', { name: 'Income and transfers' })).not.toBeInTheDocument()
  })

  it('lists categories under their group headings, with ungrouped ones last', async () => {
    const food = { group: 'Food and drink' }
    const alcohol = category('Alcohol', food)
    const mine = category('Bourbon club', { budgetCents: 5000 })
    serveSpending([{ ...groceries, ...food }, mine, alcohol])
    renderSpending()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    const order = within(spending)
      .getAllByText(/^(Food and drink|Other|Groceries|Alcohol|Bourbon club)$/)
      .map((element) => element.textContent)
    expect(order).toEqual(['Food and drink', 'Groceries', 'Alcohol', 'Other', 'Bourbon club'])
    // With groups, budgeted and tracked categories stay together under their heading.
    expect(within(spending).queryByText('Tracking only')).not.toBeInTheDocument()
  })

  it('lists budgeted categories first, then the ones only tracked', async () => {
    serveSpending([coffee, groceries])
    renderSpending()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    const links = within(spending).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/spending/${groceries.id}`,
      `/spending/${coffee.id}`,
    ])
    expect(within(spending).getByText('Tracking only')).toBeInTheDocument()
    expect(within(spending).getByRole('group', { name: 'Coffee' })).toHaveTextContent(
      'No budget yet',
    )
  })

  it('hides the tracking only heading when every category has a budget', async () => {
    serveSpending()
    renderSpending()
    const spending = await screen.findByRole('region', { name: 'Spending categories' })
    expect(within(spending).queryByText('Tracking only')).not.toBeInTheDocument()
  })

  it('lists income as money in and transfers as not counted, each linking to its page', async () => {
    fakeServer({
      get_budget: () => budgetFor([paycheck], [{ categoryId: paycheck.id, amountCents: -500000 }]),
      list_categories: () => [paycheck, savings],
    })
    renderSpending()
    const section = await screen.findByRole('region', { name: 'Income and transfers' })
    const income = within(section).getByRole('link', { name: /Paycheck/ })
    expect(income).toHaveTextContent('$5,000 in')
    expect(income).toHaveAttribute('href', `/spending/${paycheck.id}`)
    const transfer = within(section).getByRole('link', { name: /Savings/ })
    expect(transfer).toHaveTextContent('Not counted')
    expect(transfer).toHaveAttribute('href', `/spending/${savings.id}`)
  })
})

describe('adding a category', () => {
  it('adds a category with its budget and opens its page', async () => {
    const server = serveSpending([groceries], {
      create_category: (input) => ({ ...category(input.name as string), ...input }),
    })
    renderSpending()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    const form = screen.getByRole('form', { name: 'New category' })
    await user.type(within(form).getByLabelText('Name'), 'Pet care')
    await user.type(within(form).getByLabelText('Budget amount'), '75')
    await user.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(await screen.findByText('Landed on /spending/cat-pet-care')).toBeInTheDocument()
    expect(server.actions('create_category')).toEqual([
      expect.objectContaining({ name: 'Pet care', kind: 'expense', budgetCents: 7500 }),
    ])
  })

  it('shows the saving state while the category is being added', async () => {
    serveSpending([groceries], { create_category: () => category('Pet care') })
    const release = holdRequest('/api/actions/create_category')
    renderSpending()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    await user.type(screen.getByLabelText('Name'), 'Pet care')
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeDisabled()
    release()
    expect(await screen.findByText('Landed on /spending/cat-pet-care')).toBeInTheDocument()
  })

  it('keeps the form open with the reason when the server refuses the category', async () => {
    serveSpending(
      [groceries],
      {},
      { '/api/actions/create_category': failing('That name is taken') },
    )
    renderSpending()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    const form = screen.getByRole('form', { name: 'New category' })
    await user.type(within(form).getByLabelText('Name'), 'Groceries')
    await user.click(within(form).getByRole('button', { name: 'Add category' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('That name is taken')
    expect(screen.getByRole('heading', { level: 1, name: 'Spending' })).toBeInTheDocument()
  })

  it('closes the form without adding anything on cancel', async () => {
    const server = serveSpending()
    renderSpending()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'New category' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New category' })).not.toBeInTheDocument()
    expect(server.actions('create_category')).toEqual([])
  })
})

describe('budget rows in plain words', () => {
  const dining = category('Dining out', { budgetCents: 30000 })

  it('says what is left for how many days, and about how much a day', async () => {
    serveSpending()
    renderSpending()
    const row = within(await screen.findByRole('group', { name: 'Groceries' }))
    expect(row.getByText('$360 left for 14 days, about $25 a day')).toBeInTheDocument()
    expect(row.getByRole('link', { name: 'Groceries' })).toHaveAttribute(
      'href',
      `/spending/${groceries.id}`,
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
    renderSpending()
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
    renderSpending()
    const row = within(await screen.findByRole('group', { name: 'Groceries' }))
    expect(row.getByText('+$40 rolled over')).toBeInTheDocument()
    // The budget shown includes what rolled over; editing changes the category's own amount.
    expect(row.getByRole('button', { name: 'Change Groceries budget' })).toHaveTextContent('$640')
  })

  it('draws an empty bar for a budget of zero with nothing spent', async () => {
    const none = category('Gifts', { budgetCents: 0 })
    serveSpending([none])
    renderSpending()
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
    renderSpending()
    expect(await screen.findByRole('group', { name: 'Groceries' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Coffee' })).not.toBeInTheDocument()
  })
})
