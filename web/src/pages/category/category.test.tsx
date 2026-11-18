import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Output, Rule } from '../../api/client'
import {
  budgetFor,
  category,
  failing,
  fakeServer,
  renderSignedIn,
  settingsWith,
  transaction,
  type Handlers,
} from '../../test/fake'
import { CategoryPage } from '../Category'
import { categoryHistory, pastAverage } from './History'
import { perDayLeft } from './ThisPeriod'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const paycheck = category('Paycheck', { kind: 'income', budgetCents: 500000 })
const coffee = category('Coffee')
const savings = category('Savings', { kind: 'transfer' })
const categories = [groceries, dining, paycheck, coffee, savings]

type Trends = Output<'get_trends'>

/** Six monthly periods, June to November 2026, the last one current. */
function trends(amounts: Record<string, number[]>): Trends {
  const starts = ['06', '07', '08', '09', '10', '11']
  return starts.map((month, i) => ({
    offset: i - 5,
    start: `2026-${month}-01`,
    end: `2026-${month}-28`,
    spentCents: 0,
    incomeCents: 0,
    categories: Object.entries(amounts).map(([categoryId, cents]) => ({
      categoryId,
      amountCents: cents[i]!,
    })),
  }))
}

function rule(fields: Partial<Rule> & Pick<Rule, 'id' | 'pattern' | 'categoryId'>): Rule {
  return {
    field: 'merchant',
    matchType: 'contains',
    minAmountCents: null,
    maxAmountCents: null,
    position: 0,
    ...fields,
  }
}

const rules = [
  rule({ id: 'rule-1', pattern: 'Costco', categoryId: groceries.id }),
  rule({ id: 'rule-2', pattern: 'Chipotle', categoryId: dining.id }),
  rule({
    id: 'rule-3',
    pattern: 'KING SOOPERS',
    field: 'description',
    matchType: 'starts_with',
    categoryId: groceries.id,
    minAmountCents: 500,
  }),
]

const groceryTrips = [
  transaction({
    id: 't1',
    date: '2026-11-16',
    name: 'COSTCO #12',
    merchantName: 'Costco',
    amountCents: 8450,
  }),
  transaction({ id: 't2', date: '2026-11-03', name: 'KING SOOPERS 0042', amountCents: 2399 }),
  transaction({ id: 't3', date: '2026-11-02', name: 'Refund', amountCents: -1500 }),
]

function serve(handlers: Handlers = {}, routes: Record<string, () => Response> = {}) {
  return fakeServer(
    {
      list_categories: () => categories,
      get_budget: () =>
        budgetFor(categories, [
          { categoryId: groceries.id, amountCents: 24000 },
          { categoryId: dining.id, amountCents: 23000 },
          { categoryId: paycheck.id, amountCents: -250000 },
          { categoryId: coffee.id, amountCents: 1800 },
        ]),
      get_trends: () =>
        trends({
          [groceries.id]: [50000, 62000, 58000, 55000, 60000, 24000],
          [paycheck.id]: [-500000, -500000, -510000, -500000, -500000, -250000],
        }),
      list_transactions: () => ({ transactions: groceryTrips, total: groceryTrips.length }),
      list_rules: () => rules,
      ...handlers,
    },
    routes,
  )
}

/** Shows where the app went, query string included. */
function Landed({ name }: { name: string }) {
  const location = useLocation()
  return (
    <p>
      Landed on {name}
      {location.search}
    </p>
  )
}

function renderCategory(
  id: string = groceries.id,
  options: Parameters<typeof renderSignedIn>[1] = {},
) {
  return renderSignedIn(
    <Routes>
      <Route path="/budgets/:id" element={<CategoryPage />} />
      <Route path="/budgets" element={<Landed name="budgets" />} />
      <Route path="/transactions" element={<Landed name="transactions" />} />
    </Routes>,
    { route: `/budgets/${id}`, ...options },
  )
}

function region(name: string) {
  return screen.getByRole('region', { name })
}

describe('perDayLeft', () => {
  it('splits what is left across the days left, today included', () => {
    expect(perDayLeft(36000, 13)).toBe(2571)
    expect(perDayLeft(1000, 2)).toBe(333)
  })

  it('gives everything left on the last day', () => {
    expect(perDayLeft(1000, 0)).toBe(1000)
  })

  it('never goes below zero once over budget', () => {
    expect(perDayLeft(-5000, 3)).toBe(0)
  })

  it('is null with no budget or once the period is over', () => {
    expect(perDayLeft(null, 5)).toBeNull()
    expect(perDayLeft(1000, -1)).toBeNull()
  })
})

describe('categoryHistory', () => {
  const data = trends({ [groceries.id]: [100, 200, 300, 400, 500, 600] })

  it('gives one bar per period, labeled by month, marking the current one', () => {
    expect(categoryHistory(data, groceries, 'monthly', 'en-US')).toEqual([
      { label: 'Jun', cents: 100, current: false },
      { label: 'Jul', cents: 200, current: false },
      { label: 'Aug', cents: 300, current: false },
      { label: 'Sep', cents: 400, current: false },
      { label: 'Oct', cents: 500, current: false },
      { label: 'Nov', cents: 600, current: true },
    ])
  })

  it('labels other period kinds by start date', () => {
    expect(categoryHistory(data, groceries, 'weekly', 'en-US')[0]!.label).toBe('Jun 1')
  })

  it('flips income so money received shows as a positive bar', () => {
    const income = trends({ [paycheck.id]: [-1, -2, -3, -4, -5, -6] })
    expect(categoryHistory(income, paycheck, 'monthly', 'en-US').map((b) => b.cents)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })

  it('counts a period with nothing in the category as zero', () => {
    expect(categoryHistory(data, dining, 'monthly', 'en-US').map((b) => b.cents)).toEqual([
      0, 0, 0, 0, 0, 0,
    ])
  })

  it('is empty with no periods', () => {
    expect(categoryHistory([], groceries, 'monthly', 'en-US')).toEqual([])
  })
})

describe('pastAverage', () => {
  it('averages the finished periods and leaves out the current one', () => {
    expect(
      pastAverage([
        { cents: 100, current: false },
        { cents: 300, current: false },
        { cents: 9999, current: true },
      ]),
    ).toBe(200)
  })

  it('rounds to whole cents', () => {
    expect(
      pastAverage([
        { cents: 100, current: false },
        { cents: 101, current: false },
      ]),
    ).toBe(101)
  })

  it('is null when no period has finished', () => {
    expect(pastAverage([])).toBeNull()
    expect(pastAverage([{ cents: 500, current: true }])).toBeNull()
  })
})

describe('Category page', () => {
  it('says the category is gone and links back to all categories', async () => {
    serve()
    renderCategory('cat-deleted')
    expect(await screen.findByText(/That category is gone/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('link', { name: 'All categories' }))
    expect(await screen.findByText('Landed on budgets')).toBeInTheDocument()
  })

  it('shows loading until the category and budget arrive', async () => {
    serve()
    renderCategory()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('heading', { name: 'Groceries', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows why the budget could not load', async () => {
    serve({}, { '/api/actions/get_budget': failing('Budget is unavailable', 500) })
    renderCategory()
    expect(await screen.findByRole('alert')).toHaveTextContent('Budget is unavailable')
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('shows why categories could not load', async () => {
    serve({}, { '/api/actions/list_categories': failing('Categories are unavailable', 500) })
    renderCategory()
    expect(await screen.findByRole('alert')).toHaveTextContent('Categories are unavailable')
  })

  it('links back to all categories', async () => {
    serve()
    renderCategory()
    await userEvent.setup().click(await screen.findByRole('link', { name: 'All categories' }))
    expect(await screen.findByText('Landed on budgets')).toBeInTheDocument()
  })

  describe('this period', () => {
    it('shows spent, budget, left and what can go each day, with the status', async () => {
      serve()
      renderCategory()
      await screen.findByRole('heading', { name: 'Groceries', level: 1 })
      const stats = region('This period')
      // November: day 17 of 30, so 13 days left plus today share the $360 left.
      expect(stats).toHaveTextContent('Spent$240')
      expect(stats).toHaveTextContent('Budget$600')
      expect(stats).toHaveTextContent('Left$360')
      expect(stats).toHaveTextContent('Per day left$26')
      expect(screen.getByText('On track')).toBeInTheDocument()
    })

    it('shows how much is used, with a marker for today', async () => {
      serve()
      renderCategory()
      const bar = await screen.findByRole('progressbar', { name: 'Groceries budget used' })
      expect(bar).toHaveAttribute('aria-valuenow', '40')
      expect(bar.querySelector('.tick')).toHaveStyle({ left: `${(17 / 30) * 100}%` })
    })

    it('compares spending with a steady pace and the warning threshold', async () => {
      serve()
      renderCategory()
      expect(
        await screen.findByText('Steady spending would be at $340 by today. You warn at 80%.'),
      ).toBeInTheDocument()
    })

    it('says how far over budget, with nothing left to spend per day', async () => {
      serve()
      renderCategory(dining.id)
      await screen.findByRole('heading', { name: 'Dining out', level: 1 })
      expect(screen.getByText('Over by $30')).toBeInTheDocument()
      expect(region('This period')).toHaveTextContent('Left-$30')
      expect(region('This period')).toHaveTextContent('Per day left$0')
    })

    it('tracks a category with no budget without a bar or daily amount', async () => {
      serve()
      renderCategory(coffee.id)
      await screen.findByRole('heading', { name: 'Coffee', level: 1 })
      const stats = region('This period')
      expect(stats).toHaveTextContent('Spent$18')
      expect(stats).toHaveTextContent('BudgetNone')
      expect(stats).not.toHaveTextContent('Per day left')
      expect(within(stats).queryByRole('progressbar')).not.toBeInTheDocument()
      expect(screen.getByText('No budget, tracking only')).toBeInTheDocument()
    })

    it('shows income as received, without spending pace', async () => {
      serve()
      renderCategory(paycheck.id)
      await screen.findByRole('heading', { name: 'Paycheck', level: 1 })
      const stats = region('This period')
      expect(stats).toHaveTextContent('Received$2,500')
      expect(stats).toHaveTextContent('Budget$5,000')
      expect(stats).not.toHaveTextContent('Per day left')
      expect(within(stats).queryByRole('progressbar')).not.toBeInTheDocument()
      expect(stats).not.toHaveTextContent('Steady spending')
    })

    it('explains transfers and leaves out the period numbers', async () => {
      serve()
      renderCategory(savings.id)
      await screen.findByRole('heading', { name: 'Savings', level: 1 })
      expect(
        screen.getByText('Transfers never count toward spending or income.'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'This period' })).not.toBeInTheDocument()
    })

    it('leaves out the pace line when pace tracking is off', async () => {
      const bills = category('Rent', { budgetCents: 200000, trackPace: false })
      serve({
        list_categories: () => [bills],
        get_budget: () => budgetFor([bills], [{ categoryId: bills.id, amountCents: 200000 }]),
      })
      renderCategory(bills.id)
      await screen.findByRole('heading', { name: 'Rent', level: 1 })
      expect(region('This period')).not.toHaveTextContent('Steady spending')
      expect(
        screen.getByRole('progressbar', { name: 'Rent budget used' }).querySelector('.tick'),
      ).toBeNull()
    })
  })

  describe('history', () => {
    it('charts the last six months with the average of the finished ones', async () => {
      const server = serve()
      renderCategory()
      const history = await screen.findByRole('region', { name: 'Last six periods' })
      expect(within(history).getByRole('heading', { name: 'Last six months' })).toBeInTheDocument()
      // (500 + 620 + 580 + 550 + 600) / 5 = 570
      expect(
        await within(history).findByText('Average $570 against a $600 budget'),
      ).toBeInTheDocument()
      const chart = within(history).getByRole('img', { name: 'Groceries by period' })
      expect(chart).toHaveAccessibleDescription(
        'Jun $500, Jul $620, Aug $580, Sep $550, Oct $600, Nov $240. Budget $600.',
      )
      expect(server.actions('get_trends')).toEqual([{ periods: 6 }])
    })

    it('leaves out the budget wording when the category has no budget', async () => {
      serve()
      renderCategory(coffee.id)
      const history = await screen.findByRole('region', { name: 'Last six periods' })
      expect(await within(history).findByText('Average $0')).toBeInTheDocument()
    })

    it('flips income history to positive amounts', async () => {
      serve()
      renderCategory(paycheck.id)
      const history = await screen.findByRole('region', { name: 'Last six periods' })
      expect(
        await within(history).findByText('Average $5,020 against a $5,000 budget'),
      ).toBeInTheDocument()
    })

    it('calls them periods when the budget is not monthly', async () => {
      serve()
      renderCategory(groceries.id, {
        settings: settingsWith({ period: { kind: 'weekly' } }),
      })
      expect(await screen.findByRole('heading', { name: 'Last six periods' })).toBeInTheDocument()
    })

    it('shows no average or chart before the history arrives', async () => {
      serve({ get_trends: () => new Promise<never>(() => {}) })
      renderCategory()
      const history = await screen.findByRole('region', { name: 'Last six periods' })
      expect(within(history).queryByText(/Average/)).not.toBeInTheDocument()
      expect(within(history).queryByRole('img')).not.toBeInTheDocument()
    })

    it('shows why the history could not load', async () => {
      serve({}, { '/api/actions/get_trends': failing('Trends are unavailable', 500) })
      renderCategory()
      const history = await screen.findByRole('region', { name: 'Last six periods' })
      expect(await within(history).findByRole('alert')).toHaveTextContent('Trends are unavailable')
    })
  })

  describe('transactions', () => {
    it('lists this period transactions in the category', async () => {
      const server = serve()
      renderCategory()
      const list = await screen.findByRole('region', { name: 'In this category' })
      expect(await within(list).findByText('Costco')).toBeInTheDocument()
      expect(within(list).getByText('KING SOOPERS 0042')).toBeInTheDocument()
      expect(within(list).getByText('Nov 16')).toBeInTheDocument()
      expect(within(list).getByText('$84.50')).toBeInTheDocument()
      expect(within(list).getByText('+$15.00')).toBeInTheDocument()
      expect(within(list).getByText('3 this period')).toBeInTheDocument()
      expect(within(list).queryByRole('link', { name: 'All transactions' })).not.toBeInTheDocument()
      expect(server.actions('list_transactions')).toEqual([
        { categoryId: groceries.id, start: '2026-11-01', end: '2026-11-30', limit: 100 },
      ])
    })

    it('says when there is nothing yet this period', async () => {
      serve({ list_transactions: () => ({ transactions: [], total: 0 }) })
      renderCategory()
      const list = await screen.findByRole('region', { name: 'In this category' })
      expect(await within(list).findByText('Nothing yet this period.')).toBeInTheDocument()
      expect(list).toHaveTextContent('0 this period')
    })

    it('shows the first 12 and links to all of them, filtered to the category', async () => {
      const many = Array.from({ length: 15 }, (_, i) =>
        transaction({ id: `m${i}`, date: '2026-11-10', name: `Shop ${i + 1}` }),
      )
      serve({ list_transactions: () => ({ transactions: many, total: 40 }) })
      renderCategory()
      const list = await screen.findByRole('region', { name: 'In this category' })
      expect(await within(list).findByText('Shop 12')).toBeInTheDocument()
      expect(within(list).queryByText('Shop 13')).not.toBeInTheDocument()
      expect(list).toHaveTextContent('40 this period')
      const all = within(list).getByRole('link', { name: 'All transactions' })
      expect(all).toHaveAttribute('href', `/transactions?category=${groceries.id}`)
      await userEvent.setup().click(all)
      expect(
        await screen.findByText(`Landed on transactions?category=${groceries.id}`),
      ).toBeInTheDocument()
    })

    it('shows why the transactions could not load', async () => {
      serve({}, { '/api/actions/list_transactions': failing('Transactions are unavailable', 500) })
      renderCategory()
      const list = await screen.findByRole('region', { name: 'In this category' })
      expect(await within(list).findByRole('alert')).toHaveTextContent(
        'Transactions are unavailable',
      )
    })
  })

  describe('settings', () => {
    it('starts from the category and saves the changes', async () => {
      const server = serve({ update_category: (input) => ({ ...groceries, ...input }) })
      renderCategory()
      const form = await screen.findByRole('form', { name: 'Category settings' })
      const user = userEvent.setup()
      const name = within(form).getByRole('textbox', { name: 'Name' })
      expect(name).toHaveValue('Groceries')
      expect(within(form).getByRole('textbox', { name: 'Budget amount' })).toHaveValue('600')
      await user.clear(name)
      await user.type(name, 'Food at home')
      const amount = within(form).getByRole('textbox', { name: 'Budget amount' })
      await user.clear(amount)
      await user.type(amount, '650')
      await user.click(within(form).getByRole('button', { name: 'Save changes' }))
      await waitFor(() =>
        expect(server.actions('update_category')).toEqual([
          {
            id: groceries.id,
            name: 'Food at home',
            color: '#2E9E3A',
            kind: 'expense',
            budgetCents: 65000,
            budgetCadence: 'month',
            warnAtPercent: null,
            trackPace: true,
            providerCategories: [],
            group: null,
          },
        ]),
      )
      expect(await within(region('Settings')).findByText('Saved.')).toBeInTheDocument()
    })

    it('shows why saving failed', async () => {
      serve({}, { '/api/actions/update_category': failing('A category with that name exists') })
      renderCategory()
      const form = await screen.findByRole('form', { name: 'Category settings' })
      await userEvent.setup().click(within(form).getByRole('button', { name: 'Save changes' }))
      expect(await within(form).findByRole('alert')).toHaveTextContent(
        'A category with that name exists',
      )
      expect(within(region('Settings')).queryByText('Saved.')).not.toBeInTheDocument()
    })
  })

  describe('rules', () => {
    it('lists only this category rules, numbered in run order', async () => {
      serve()
      renderCategory()
      const list = await screen.findByRole('region', { name: 'Rules' })
      expect(await within(list).findByText('Merchant contains "Costco"')).toBeInTheDocument()
      expect(list).toHaveTextContent('Description starts with "KING SOOPERS" (amount limited)')
      expect(list).not.toHaveTextContent('Chipotle')
      expect(within(list).getByRole('button', { name: 'Delete rule 3' })).toBeInTheDocument()
      // Reordering happens on the full list, not here.
      expect(within(list).queryByRole('button', { name: /Move rule/ })).not.toBeInTheDocument()
    })

    it('says when the category has no rules', async () => {
      serve()
      renderCategory(coffee.id)
      const list = await screen.findByRole('region', { name: 'Rules' })
      expect(await within(list).findByText(/No rules yet/)).toBeInTheDocument()
    })

    it('makes a new rule that files matches into this category', async () => {
      const server = serve({
        preview_rule: () => ({ matchCount: 4, examples: [], wouldMove: 1, movingFrom: [] }),
        create_rule: (input) => ({ ...rules[0], ...input, id: 'rule-new' }),
      })
      renderCategory()
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: '+ New rule' }))
      const form = screen.getByRole('form', { name: 'New rule' })
      expect(within(form).getByRole('combobox', { name: 'Category for matches' })).toHaveValue(
        groceries.id,
      )
      await user.type(within(form).getByRole('textbox', { name: 'Text to match' }), '  Sprouts ')
      await user.click(within(form).getByRole('button', { name: 'Save rule and apply' }))
      await waitFor(() =>
        expect(server.actions('create_rule')).toEqual([
          {
            field: 'merchant',
            matchType: 'contains',
            pattern: 'Sprouts',
            categoryId: groceries.id,
            minAmountCents: null,
            maxAmountCents: null,
          },
        ]),
      )
      await waitFor(() =>
        expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument(),
      )
    })

    it('closes the new rule without saving', async () => {
      const server = serve({
        preview_rule: () => ({ matchCount: 0, examples: [], wouldMove: 0, movingFrom: [] }),
      })
      renderCategory()
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: '+ New rule' }))
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('form', { name: 'New rule' })).not.toBeInTheDocument()
      expect(server.actions('create_rule')).toEqual([])
    })

    it('deletes a rule', async () => {
      const server = serve({ delete_rule: () => ({ deleted: true }) })
      renderCategory()
      const list = await screen.findByRole('region', { name: 'Rules' })
      await userEvent
        .setup()
        .click(await within(list).findByRole('button', { name: 'Delete rule 1' }))
      await waitFor(() => expect(server.actions('delete_rule')).toEqual([{ id: 'rule-1' }]))
    })
  })

  describe('delete', () => {
    it('asks once more, and Keep it backs out', async () => {
      const server = serve({ delete_category: () => ({ deleted: true }) })
      renderCategory()
      const user = userEvent.setup()
      const card = await screen.findByRole('region', { name: 'Delete category' })
      await user.click(within(card).getByRole('button', { name: 'Delete category' }))
      expect(within(card).getByRole('button', { name: 'Delete Groceries' })).toBeInTheDocument()
      await user.click(within(card).getByRole('button', { name: 'Keep it' }))
      expect(
        within(card).queryByRole('button', { name: 'Delete Groceries' }),
      ).not.toBeInTheDocument()
      expect(server.actions('delete_category')).toEqual([])
    })

    it('deletes after confirming and goes to all budgets', async () => {
      const server = serve({ delete_category: () => ({ deleted: true }) })
      renderCategory()
      const user = userEvent.setup()
      const card = await screen.findByRole('region', { name: 'Delete category' })
      await user.click(within(card).getByRole('button', { name: 'Delete category' }))
      await user.click(within(card).getByRole('button', { name: 'Delete Groceries' }))
      expect(await screen.findByText('Landed on budgets')).toBeInTheDocument()
      expect(server.actions('delete_category')).toEqual([{ id: groceries.id }])
    })

    it('shows why deleting failed and stays on the category', async () => {
      serve({}, { '/api/actions/delete_category': failing('Category is in use', 409) })
      renderCategory()
      const user = userEvent.setup()
      const card = await screen.findByRole('region', { name: 'Delete category' })
      await user.click(within(card).getByRole('button', { name: 'Delete category' }))
      await user.click(within(card).getByRole('button', { name: 'Delete Groceries' }))
      expect(await within(card).findByRole('alert')).toHaveTextContent('Category is in use')
      expect(screen.queryByText('Landed on budgets')).not.toBeInTheDocument()
      expect(within(card).getByRole('button', { name: 'Delete Groceries' })).toBeEnabled()
    })
  })
})
