import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Budget, CategoryBudget, Connection, SpendingPace } from '../api/client'
import { settingsSchema } from '../../../server/src/domain/settings'
import {
  account as bankAccount,
  alertsFor,
  budgetFor,
  category,
  fakeServer,
  renderSignedIn,
  transaction,
} from '../test/fake'
import { AccountsWidget, MerchantsWidget, RecentWidget } from './Activity'
import { AlertsWidget } from './Alerts'
import { CategoriesWidget, categoryStatus, rowNote } from './Categories'
import { GlanceWidget } from './Glance'
import { LeewayWidget } from './Leeway'
import { followedText, PaceWidget } from './Pace'
import { TrendsWidget } from './Trends'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

// budgetFor puts today at Nov 17 of a 30 day November: 17 days in, 13 left.

/** A budget with some totals or period fields replaced, for cases the math alone can't reach. */
function withChanges(
  budget: Budget,
  changes: { totals?: Partial<Budget['totals']>; period?: Partial<Budget['period']> },
): Budget {
  return {
    ...budget,
    totals: { ...budget.totals, ...changes.totals },
    period: { ...budget.period, ...changes.period },
  }
}

/** An action that answers with a server error, as the real server does. */
function failing(name: string, message: string) {
  return {
    [`/api/actions/${name}`]: () =>
      Response.json({ error: 'server_error', message }, { status: 500 }),
  }
}

function connection(fields: Partial<Connection> & Pick<Connection, 'id'>): Connection {
  return {
    provider: 'plaid',
    institutionName: 'Chase',
    status: 'active',
    lastSyncedAt: null,
    lastError: null,
    accountCount: 2,
    ...fields,
  }
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

describe('LeewayWidget', () => {
  const region = () => screen.getByRole('region', { name: 'Your leeway' })

  it('asks for budgets when no category has one', () => {
    renderSignedIn(<LeewayWidget budget={budgetFor([category('Fun')], [])} offset={0} />)
    expect(region()).toHaveTextContent('Give a few categories a budget')
    expect(screen.getByRole('link', { name: 'Set budgets' })).toHaveAttribute('href', '/budgets')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows what is left, a safe amount per day and how much is used', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('$600')
    expect(region()).toHaveTextContent('left of $800')
    // $600 over the 14 days still to spend, today included, is $42.85 a day.
    expect(region()).toHaveTextContent('About $43 a day for the next 14 days.')
    expect(region()).toHaveTextContent('$200 spent, 25%')
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(region()).toHaveTextContent('Marker: where steady spending would be today')
  })

  it('says how far over it is and that nothing is left to spend', () => {
    const budget = budgetFor(categories, [
      { categoryId: groceries.id, amountCents: 60000 },
      { categoryId: dining.id, amountCents: 30000 },
    ])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('over $800')
    expect(region()).not.toHaveTextContent('left of')
    expect(region()).toHaveTextContent('Nothing left to spend this period.')
    expect(region()).toHaveTextContent('$900 spent, 113%')
    // The bar stops at full even though spending went past it.
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('treats a budget spent to the cent as nothing left', () => {
    const budget = budgetFor(categories, [
      { categoryId: groceries.id, amountCents: 60000 },
      { categoryId: dining.id, amountCents: 20000 },
    ])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('left of $800')
    expect(region()).toHaveTextContent('Nothing left to spend this period.')
  })

  it('says "1 day" on the last day of the period', () => {
    const budget = withChanges(budgetFor(categories, []), {
      period: { daysLeft: 0 },
      totals: { safePerDayCents: 80000 },
    })
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('About $800 a day for the next 1 day.')
  })

  it('leaves out the daily amount and the pace marker for a past period', () => {
    const budget = withChanges(
      budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }]),
      { period: { offset: -1 }, totals: { safePerDayCents: null } },
    )
    renderSignedIn(<LeewayWidget budget={budget} offset={-1} />)
    expect(region()).toHaveTextContent('left of $800')
    expect(region()).not.toHaveTextContent('a day')
    expect(region()).not.toHaveTextContent('Nothing left')
    expect(region()).not.toHaveTextContent('Marker')
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toBeInTheDocument()
  })

  it('holds back what goals set aside, and lists each one', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }], {
      setAsides: [
        { goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 15000 },
        { goalId: 'goal-trip', name: 'Trip', color: '#7F70E0', amountCents: 5000 },
      ],
    })
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    // $600 left in the budgets, less $200 for goals.
    expect(region()).toHaveTextContent('$400left of $800, after $200 set aside')
    expect(region()).toHaveTextContent('About $29 a day for the next 14 days.')
    const list = within(screen.getByRole('list', { name: 'Set aside for goals' }))
    expect(list.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Set aside for Road bike$150',
      'Set aside for Trip$50',
    ])
    expect(list.getByRole('link', { name: 'Set aside for Road bike' })).toHaveAttribute(
      'href',
      '/plan/goals',
    )
    // The striped stretch after the spending shows the share held back: $200 of $800.
    const held = document.querySelector('.fill.reserved') as HTMLElement
    expect(held.style.left).toBe('25%')
    expect(held.style.width).toBe('25%')
  })

  it('says nothing is left once goals take the rest', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 60000 }], {
      setAsides: [{ goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 30000 }],
    })
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('$100over $800, after $300 set aside')
    expect(region()).toHaveTextContent('Nothing left to spend this period.')
    // $300 held back is more than the $200 the bar has room for, so it stops at full.
    expect((document.querySelector('.fill.reserved') as HTMLElement).style.width).toBe('25%')
  })
})

describe('GlanceWidget', () => {
  // Each glance card is its title plus what sits under it.
  const card = (title: string) => screen.getByText(title, { selector: 'p' }).parentElement!

  function serve(connections: Connection[] = []) {
    return fakeServer({ list_connections: () => connections })
  }

  it('compares spending with the same point last month', () => {
    serve()
    const budget = {
      ...budgetFor(categories, [{ categoryId: groceries.id, amountCents: 30000 }]),
      previous: { spentCents: 70000, spentToDateCents: 20000 },
    }
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$300')
    expect(card('Spent')).toHaveTextContent('$100 more than this point last month')
  })

  it('says when spending is lower than at this point last month', () => {
    serve()
    const budget = {
      ...budgetFor(categories, [{ categoryId: groceries.id, amountCents: 30000 }]),
      previous: { spentCents: 70000, spentToDateCents: 45000 },
    }
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$150 less than this point last month')
  })

  it('says "Nothing yet" when neither period has spending', () => {
    serve()
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$0')
    expect(card('Spent')).toHaveTextContent('Nothing yet')
  })

  it('counts all spending as more when last period had none', () => {
    serve()
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 4200 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$42 more than this point last month')
  })

  it.each([
    [{ kind: 'weekly' }, 'week'],
    [{ kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-06' }, 'paycheck'],
  ])('uses the word for the budget period (%o)', (period, word) => {
    serve()
    const budget = {
      ...budgetFor(categories, [{ categoryId: dining.id, amountCents: 4200 }]),
      previous: { spentCents: 0, spentToDateCents: 1000 },
    }
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />, {
      settings: settingsSchema.parse({ timeZone: 'America/Denver', period }),
    })
    expect(card('Spent')).toHaveTextContent(`$32 more than this point last ${word}`)
    expect(card('Income')).toHaveTextContent(`Money in this ${word}`)
  })

  it('shows money in from income categories', () => {
    serve()
    const paycheck = category('Paycheck', { kind: 'income' })
    const budget = budgetFor(
      [...categories, paycheck],
      [{ categoryId: paycheck.id, amountCents: -250000 }],
    )
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Income')).toHaveTextContent('$2,500')
    expect(card('Income')).toHaveTextContent('Money in this month')
  })

  it('links to the transactions that need a category', () => {
    serve()
    const budget = budgetFor(categories, [{ categoryId: null, amountCents: 4500 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Needs a category')).toHaveTextContent('1')
    expect(screen.getByRole('link', { name: 'Sort $45 of spending' })).toHaveAttribute(
      'href',
      '/transactions?category=uncategorized',
    )
  })

  it('says everything is sorted when nothing needs a category', () => {
    serve()
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(card('Needs a category')).toHaveTextContent('0All sorted')
    expect(screen.queryByRole('link', { name: /Sort/ })).not.toBeInTheDocument()
  })

  it('offers to connect a bank when there is none', async () => {
    serve([])
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('No banks yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
  })

  it('shows banks as up to date with the newest sync time', async () => {
    serve([
      connection({ id: 'a', lastSyncedAt: minutesAgo(180) }),
      connection({ id: 'b', lastSyncedAt: minutesAgo(5) }),
    ])
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('2 banks, synced 5 min ago')).toBeInTheDocument()
    expect(card('Bank sync')).toHaveTextContent('Up to date')
  })

  it.each(['needs_reauth', 'error'] as const)(
    'says a bank needs you when one has status %s',
    async (status) => {
      serve([connection({ id: 'a', status })])
      renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
      expect(await screen.findByText('1 bank, synced never')).toBeInTheDocument()
      expect(card('Bank sync')).toHaveTextContent('Needs you')
      expect(card('Bank sync')).not.toHaveTextContent('Up to date')
    },
  )

  it('does not claim banks are up to date when they could not be read', async () => {
    fakeServer({}, failing('list_connections', 'Could not read banks'))
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    await waitFor(() => expect(card('Bank sync')).not.toHaveTextContent('Up to date'))
  })
})

describe('AlertsWidget', () => {
  const region = () => screen.getByRole('region', { name: 'Heads up' })

  it('says nothing needs you when all is well', async () => {
    const server = fakeServer({ list_connections: () => [connection({ id: 'a' })] })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await waitFor(() => expect(server.actions('list_connections')).toHaveLength(1))
    expect(region()).toHaveTextContent('Nothing needs you right now. Every budget is on track.')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('lists banks first, then budgets worst first, then what needs a category', async () => {
    fakeServer({
      list_connections: () => [
        connection({ id: 'ok', institutionName: 'Ally' }),
        connection({ id: 'expired', status: 'needs_reauth' }),
      ],
    })
    const fun = category('Fun', { budgetCents: 30000 })
    const budget = withChanges(
      budgetFor(
        [...categories, fun],
        [
          // Fun is under its warning level but spending fast: a pace alert.
          { categoryId: fun.id, amountCents: 22000 },
          { categoryId: groceries.id, amountCents: 50000 },
          { categoryId: dining.id, amountCents: 24000 },
        ],
      ),
      { totals: { uncategorizedCount: 3, uncategorizedCents: 12000 } },
    )
    renderSignedIn(<AlertsWidget budget={budget} offset={0} />)
    await screen.findByText('Chase needs you to log in again to keep syncing.')
    const links = within(region()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings/banks',
      '/budgets/cat-dining-out',
      '/budgets/cat-groceries',
      '/budgets/cat-fun',
      '/transactions?category=uncategorized',
    ])
    expect(links[0]).toHaveTextContent('Bank')
    expect(links[1]).toHaveTextContent('Dining out is over budget by $40 ($240 of $200).Over')
    expect(links[2]).toHaveTextContent(
      'Groceries has used 83% of its budget, with $100 left.Warning',
    )
    expect(links[3]).toHaveTextContent('Fun is spending ahead of pace')
    expect(links[3]).toHaveTextContent('Pace')
    expect(links[4]).toHaveTextContent('3 transactions ($120) need a category.Info')
  })

  it('names a bank it knows nothing about as "A bank"', async () => {
    fakeServer({
      list_connections: () => [
        connection({ id: 'a', status: 'needs_reauth', institutionName: null }),
      ],
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(
      await screen.findByText('A bank needs you to log in again to keep syncing.'),
    ).toBeInTheDocument()
  })

  it('only asks to log in again for banks that need it', async () => {
    const server = fakeServer({
      list_connections: () => [
        connection({ id: 'a', status: 'active' }),
        connection({ id: 'b', status: 'error', lastError: 'Bank is down' }),
      ],
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await waitFor(() => expect(server.actions('list_connections')).toHaveLength(1))
    expect(region()).not.toHaveTextContent('log in again')
    expect(region()).toHaveTextContent('Nothing needs you right now.')
  })

  it('uses the singular for one transaction that needs a category', () => {
    fakeServer({ list_connections: () => [] })
    const budget = budgetFor(categories, [{ categoryId: null, amountCents: 4500 }])
    renderSignedIn(<AlertsWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('1 transaction ($45) needs a category.')
  })

  it('puts account alerts before everything else, each opening its account', async () => {
    fakeServer({
      list_connections: () => [connection({ id: 'expired', status: 'needs_reauth' })],
      list_alerts: () =>
        alertsFor([
          bankAccount({ id: 'low', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
          bankAccount({ id: 'short', name: 'Everyday', balanceCents: -4210 }),
        ]),
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByText('Everyday is overdrawn by $42.10.')
    await screen.findByText('Chase needs you to log in again to keep syncing.')
    const links = within(region()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/accounts?select=short',
      '/accounts?select=low',
      '/settings/banks',
    ])
    expect(links[0]).toHaveTextContent('Overdrawn')
    expect(links[1]).toHaveTextContent('Low')
  })

  it('still shows budget alerts when the banks cannot be read', async () => {
    const server = fakeServer({}, failing('list_connections', 'Could not read banks'))
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }])
    renderSignedIn(<AlertsWidget budget={budget} offset={0} />)
    // The banks, the account alerts and AI usage are each asked for; none answers.
    await waitFor(() => expect(server.calls).toHaveLength(3))
    expect(region()).toHaveTextContent('Dining out is over budget by $40')
  })
})

describe('AlertsWidget and the AI spending alert', () => {
  const region = () => screen.getByRole('region', { name: 'Heads up' })
  const limit = {
    level: 'limit',
    message: "This month's AI limit of $5.00 is reached.",
  }

  /** AI usage with an alert, until it is dismissed. */
  function serveAlert(alert = limit) {
    let shown: typeof limit | null = alert
    return fakeServer({
      list_connections: () => [],
      get_ai_usage: () => ({ alert: shown }),
      dismiss_ai_alert: () => {
        shown = null
        return { dismissed: true }
      },
    })
  }

  it('shows the alert last, with a way to AI models, in place of "nothing needs you"', async () => {
    serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await within(region()).findByText(/AI limit of \$5.00 is reached/)).toBeInTheDocument()
    expect(region()).not.toHaveTextContent('Nothing needs you')
    expect(within(region()).getByRole('link', { name: 'AI models' })).toHaveAttribute(
      'href',
      '/settings/ai',
    )
  })

  it('shows the warning as information, after the other alerts', async () => {
    serveAlert({ level: 'warning', message: "AI has spent $4.10 of this month's $5.00 limit." })
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }])
    renderSignedIn(<AlertsWidget budget={budget} offset={0} />)
    const warning = await within(region()).findByText(/AI has spent/)
    expect(region().textContent!.indexOf('Dining out')).toBeLessThan(
      region().textContent!.indexOf('AI has spent'),
    )
    expect(warning.closest('.alert-row')!.querySelector('.alert-icon.info')).not.toBeNull()
  })

  it('dismisses the alert through the owner-only action', async () => {
    const server = serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss the AI spending alert' }),
    )
    await waitFor(() => expect(server.actions('dismiss_ai_alert')).toEqual([{}]))
    expect(await within(region()).findByText(/Nothing needs you/)).toBeInTheDocument()
  })
})

describe('CategoriesWidget', () => {
  const money = (cents: number) => `$${cents / 100}`
  const base = budgetFor([groceries], []).categories[0]!
  const row = (fields: Partial<CategoryBudget>): CategoryBudget => ({ ...base, ...fields })

  it('describes each status in words', () => {
    expect(categoryStatus(row({ budgetCents: null }), money)).toEqual({
      text: 'No budget, tracking only',
      className: 'muted',
    })
    expect(categoryStatus(row({ status: 'over', leftCents: -4000 }), money)).toEqual({
      text: 'Over by $40',
      className: 'over strong',
    })
    expect(
      categoryStatus(row({ status: 'warning', percentUsed: 85, pace: 'on' }), money).text,
    ).toBe('85% used')
    expect(
      categoryStatus(row({ status: 'warning', percentUsed: 85, pace: 'over' }), money),
    ).toEqual({ text: '85% used, ahead of pace', className: 'warn strong' })
    expect(categoryStatus(row({ status: 'ok', pace: 'over' }), money)).toEqual({
      text: 'Ahead of pace',
      className: 'warn strong',
    })
    expect(categoryStatus(row({ status: 'ok', percentUsed: 20, pace: null }), money)).toEqual({
      text: '20% used, pace off',
      className: 'muted',
    })
    expect(categoryStatus(row({ status: 'ok', pace: 'under' }), money)).toEqual({
      text: 'On track',
      className: 'good',
    })
    expect(categoryStatus(row({ status: 'ok', pace: 'on' }), money).text).toBe('On track')
  })

  it('reads a missing percent as 0', () => {
    expect(categoryStatus(row({ percentUsed: null, pace: null }), money).text).toBe(
      '0% used, pace off',
    )
  })

  it("notes a row's status only when it needs attention, and what is left otherwise", () => {
    expect(rowNote(row({ budgetCents: null }), money)).toEqual({
      text: 'No budget',
      className: 'muted',
    })
    expect(rowNote(row({ status: 'over', leftCents: -4000 }), money).text).toBe('Over by $40')
    expect(rowNote(row({ status: 'ok', pace: 'over' }), money).text).toBe('Ahead of pace')
    expect(rowNote(row({ status: 'ok', pace: 'on', leftCents: 41300 }), money)).toEqual({
      text: '$413 left',
      className: 'muted',
    })
    // Pace off is not worth calling out on the dashboard; what is left still is.
    expect(rowNote(row({ status: 'ok', pace: null, leftCents: 100 }), money).text).toBe('$1 left')
    expect(rowNote(row({ status: 'ok', pace: 'on', leftCents: 0 }), money).text).toBe('Fully used')
  })

  it('lists spending categories with their budget, status and what is left', () => {
    const rent = category('Rent')
    const paycheck = category('Paycheck', { kind: 'income', budgetCents: 500000 })
    const budget = budgetFor(
      [...categories, rent, paycheck],
      [
        { categoryId: groceries.id, amountCents: 20000 },
        { categoryId: dining.id, amountCents: 24000 },
        { categoryId: rent.id, amountCents: 150000 },
        { categoryId: paycheck.id, amountCents: -500000 },
      ],
    )
    renderSignedIn(<CategoriesWidget budget={budget} offset={0} />)

    const groceriesRow = screen.getByRole('link', { name: /Groceries/ })
    expect(groceriesRow).toHaveAttribute('href', '/budgets/cat-groceries')
    // On track needs no saying: the row just shows what is left.
    expect(groceriesRow).toHaveTextContent('$200 of $600 · $400 left')
    expect(groceriesRow).not.toHaveTextContent('On track')

    const diningRow = screen.getByRole('link', { name: /Dining out/ })
    expect(diningRow).toHaveTextContent('$240 of $200')
    expect(diningRow).toHaveTextContent('Over by $40')
    expect(diningRow).not.toHaveTextContent('left')
    expect(
      within(diningRow).getByRole('progressbar', {
        name: 'Dining out: 120 percent of budget used',
      }),
    ).toHaveAttribute('aria-valuenow', '100')

    const rentRow = screen.getByRole('link', { name: /Rent/ })
    expect(rentRow).toHaveTextContent('$1,500')
    expect(rentRow).toHaveTextContent('$1,500 · No budget')
    expect(within(rentRow).queryByRole('progressbar')).not.toBeInTheDocument()

    // Income is not spending, so it has no row here.
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit budgets' })).toHaveAttribute('href', '/budgets')
  })

  it('shows no amount left once a budget is fully used', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 60000 }])
    renderSignedIn(<CategoriesWidget budget={budget} offset={0} />)
    const groceriesRow = screen.getByRole('link', { name: /Groceries/ })
    expect(groceriesRow).toHaveTextContent('100% used, ahead of pace')
    expect(groceriesRow).not.toHaveTextContent('left')
  })

  it('invites adding a category when there are no spending categories', () => {
    const budget = budgetFor([category('Paycheck', { kind: 'income' })], [])
    renderSignedIn(<CategoriesWidget budget={budget} offset={0} />)
    expect(screen.getByRole('region', { name: 'Categories' })).toHaveTextContent(
      'No categories yet.',
    )
    expect(screen.getByRole('link', { name: 'Add one' })).toHaveAttribute('href', '/budgets')
  })
})

describe('PaceWidget', () => {
  const region = () => screen.getByRole('region', { name: 'Spending pace' })

  /** Groceries and dining followed through Nov 17, $20 a day. */
  function pace(fields: Partial<SpendingPace> = {}): SpendingPace {
    return {
      start: '2026-11-01',
      end: '2026-11-30',
      days: 30,
      categoryIds: [groceries.id, dining.id],
      budgetCents: 80000,
      cumulative: Array.from({ length: 17 }, (_, i) => ({
        date: `2026-11-${String(i + 1).padStart(2, '0')}`,
        cents: (i + 1) * 2000,
      })),
      projectedCents: 60000,
      ...fields,
    }
  }

  it('names up to three followed categories, and counts the rest', () => {
    expect(followedText(['Groceries'])).toBe('Groceries')
    expect(followedText(['Groceries', 'Dining', 'Fun'])).toBe('Groceries, Dining, Fun')
    expect(followedText(['Groceries', 'Dining', 'Fun', 'Gas', 'Gifts'])).toBe(
      'Groceries, Dining and 3 more',
    )
  })

  it('shows loading until the pace arrives', () => {
    fakeServer({ get_spending_pace: () => pace() })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(within(region()).getByRole('status')).toHaveTextContent('Loading')
  })

  it('warns where spending is heading when it would go over', async () => {
    const server = fakeServer({ get_spending_pace: () => pace({ projectedCents: 96000 }) })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(
      await screen.findByRole('img', { name: 'Flexible spending pace' }),
    ).toHaveAccessibleDescription(
      '$340 spent by Nov 17 against a $800 budget for Nov 1 to Nov 30, on track for $960.',
    )
    expect(region()).toHaveTextContent(
      'At this rate you land near $960, about $160 over the $800 budget.',
    )
    expect(screen.getByText('Groceries, Dining out')).toBeInTheDocument()
    // The lines are named where they end, not in a legend.
    expect(region()).toHaveTextContent('Projected$960')
    expect(region()).toHaveTextContent('Budget$800')
    expect(region()).toHaveTextContent('Today')
    expect(server.actions('get_spending_pace')).toEqual([{ offset: 0 }])
  })

  it('says how far under budget spending is heading', async () => {
    fakeServer({ get_spending_pace: () => pace() })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText(/At this rate/)).toHaveTextContent(
      'At this rate you land near $600, $200 under the $800 budget.',
    )
  })

  it('names only the categories it follows', async () => {
    fakeServer({ get_spending_pace: () => pace({ categoryIds: [dining.id] }) })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('Dining out')).toBeInTheDocument()
    expect(screen.queryByText(/Groceries/)).not.toBeInTheDocument()
  })

  it('explains how to start when no category tracks pace', async () => {
    fakeServer({ get_spending_pace: () => pace({ categoryIds: [], budgetCents: 0 }) })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText(/Give a category a budget with pace on/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports what was actually spent in a past period, with nothing projected', async () => {
    const server = fakeServer({
      get_spending_pace: () => pace({ projectedCents: 96000 }),
    })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={-1} />)
    expect(await screen.findByText(/You spent/)).toHaveTextContent(
      'You spent $340, $460 under the $800 budget.',
    )
    expect(region()).not.toHaveTextContent('Projected')
    expect(server.actions('get_spending_pace')).toEqual([{ offset: -1 }])
  })

  it('counts a past period with no days as nothing spent', async () => {
    fakeServer({ get_spending_pace: () => pace({ cumulative: [] }) })
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={-1} />)
    expect(await screen.findByText(/You spent/)).toHaveTextContent(
      'You spent $0, $800 under the $800 budget.',
    )
  })

  it('shows the error when the pace cannot be read', async () => {
    fakeServer({}, failing('get_spending_pace', 'Could not read spending'))
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read spending')
  })

  it('stops loading once the read has failed', async () => {
    fakeServer({}, failing('get_spending_pace', 'Could not read spending'))
    renderSignedIn(<PaceWidget budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('RecentWidget', () => {
  const transfer = category('Transfers', { kind: 'transfer' })
  const txs = [
    transaction({
      id: 't1',
      date: '2026-11-17',
      name: 'COSTCO #12',
      merchantName: 'Costco',
      amountCents: 8450,
      categoryId: groceries.id,
    }),
    transaction({
      id: 't2',
      date: '2026-11-16',
      name: 'SWEET COW',
      amountCents: 900,
      pending: true,
    }),
    transaction({
      id: 't3',
      date: '2026-11-09',
      name: 'Payroll',
      amountCents: -250000,
      categoryId: transfer.id,
    }),
  ]

  it('asks for the latest six transactions up to the end of the period', async () => {
    const server = fakeServer({
      list_transactions: () => ({ transactions: txs, total: txs.length }),
    })
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByText('Costco')
    expect(server.actions('list_transactions')).toEqual([{ limit: 6, end: '2026-11-30' }])
  })

  it('shows each transaction with its date, category and amount', async () => {
    fakeServer({ list_transactions: () => ({ transactions: txs, total: txs.length }) })
    renderSignedIn(<RecentWidget budget={budgetFor([...categories, transfer], [])} offset={0} />)
    expect(await screen.findByText('Costco')).toBeInTheDocument()
    expect(screen.getByText('Nov 17')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('$84.50')).toBeInTheDocument()
    // No merchant name falls back to the bank's description.
    expect(screen.getByText('SWEET COW')).toBeInTheDocument()
    expect(screen.getByText('Needs a category, pending')).toBeInTheDocument()
    // Transfers are left out of the budget, so their category has no row there.
    expect(screen.getByText('Transfer')).toBeInTheDocument()
    expect(screen.getByText('+$2,500.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    )
  })

  it('labels a card payment arriving on the card, in a neutral color rather than as money in', async () => {
    const arrival = transaction({
      id: 'card',
      date: '2026-11-04',
      name: 'Payment Thank You-Mobile',
      amountCents: -40930,
      categoryId: transfer.id,
      bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    fakeServer({ list_transactions: () => ({ transactions: [arrival], total: 1 }) })
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('Card payment')).toBeInTheDocument()
    expect(screen.getByText('+$409.30')).toHaveClass('muted')
    expect(screen.getByText('+$409.30')).not.toHaveClass('good')
  })

  it('names the person a Zelle came from, as money in', async () => {
    const zelle = transaction({
      id: 'zelle',
      date: '2026-11-07',
      name: 'Zelle payment from JANE DOE BACmmhq0yzbn',
      amountCents: -12500,
      person: { app: 'Zelle', direction: 'in', counterparty: 'Jane Doe' },
    })
    fakeServer({ list_transactions: () => ({ transactions: [zelle], total: 1 }) })
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('From Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('+$125.00')).toHaveClass('good')
  })

  it('says when there are no transactions', async () => {
    fakeServer({ list_transactions: () => ({ transactions: [], total: 0 }) })
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('No transactions yet.')).toBeInTheDocument()
  })

  it('shows the error when transactions cannot be read', async () => {
    fakeServer({}, failing('list_transactions', 'Database is down'))
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument()
  })
})

describe('AccountsWidget', () => {
  function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
    return {
      connectionId: null,
      institutionName: null,
      nickname: null,
      bankName: fields.name,
      mask: null,
      type: 'depository',
      subtype: null,
      balanceCents: 0,
      availableCents: null,
      creditLimitCents: null,
      currency: 'USD',
      hidden: false,
      manual: false,
      balanceUpdatedAt: null,
      aprPercent: null,
      minimumPaymentCents: null,
      lowBalanceCents: null,
      kindChoice: null,
      kind: 'checking',
      ...fields,
    }
  }

  it('lists accounts with exact balances and marks ignored ones', async () => {
    fakeServer({
      list_accounts: () => [
        account({ id: 'a', name: 'Checking', balanceCents: 123456 }),
        account({ id: 'b', name: 'Old savings', hidden: true, balanceCents: 500 }),
        account({ id: 'c', name: 'House', balanceCents: null }),
        account({ id: 'd', name: 'Travel card', type: 'credit', balanceCents: 80000 }),
      ],
    })
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByText('Checking')).toBeInTheDocument()
    expect(screen.getByText('$1,234.56')).toBeInTheDocument()
    // A card's balance is money owed, so it says so rather than reading as cash.
    const card = screen.getByText('Travel card').closest('.list-row')!
    expect(card).toHaveTextContent('$800.00owed')
    expect(screen.getByText('Old savings').closest('.list-row')).toHaveTextContent(
      'ignored for budgets',
    )
    expect(screen.getByText('No balance')).toBeInTheDocument()
    // A cash or house account has no balance owed, so no "owed" under it.
    expect(screen.getAllByText('owed')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'All accounts' })).toHaveAttribute('href', '/accounts')
    // Each account opens the Accounts dashboard with just it picked.
    expect(screen.getByText('Checking').closest('a')).toHaveAttribute('href', '/accounts?select=a')
  })

  it('shows an overdrawn cash balance in red, but never a card balance', async () => {
    fakeServer({
      list_accounts: () => [
        account({ id: 'a', name: 'Checking', balanceCents: -4210 }),
        account({ id: 'b', name: 'Card', type: 'credit', balanceCents: 5000 }),
      ],
    })
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByText('-$42.10')).toHaveClass('over')
    expect(screen.getByText('$50.00')).not.toHaveClass('over')
  })

  it('shows the name the server gives each account, with its bank and last four digits', async () => {
    fakeServer({
      list_accounts: () => [
        account({
          id: 'a',
          name: 'Chase Credit Card',
          bankName: 'CREDIT CARD',
          institutionName: 'Chase',
          mask: '0388',
          type: 'credit',
        }),
        account({ id: 'c', name: 'Car', manual: true, type: 'property' }),
        account({ id: 'd', name: 'MY HSA', nickname: 'MY HSA', mask: '5555' }),
      ],
    })
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByText('Chase ··0388')).toBeInTheDocument()
    expect(screen.getByText('Chase ··0388').closest('.list-row')).toHaveTextContent(
      'Chase Credit Card',
    )
    expect(screen.queryByText('CREDIT CARD')).not.toBeInTheDocument()
    expect(screen.getByText('Added by hand')).toBeInTheDocument()
    // The owner's own name is shown as typed, capitals and all.
    expect(screen.getByText('MY HSA')).toBeInTheDocument()
    expect(screen.getByText('··5555')).toBeInTheDocument()
  })

  it('says when there are no accounts', async () => {
    fakeServer({ list_accounts: () => [] })
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByText('No accounts yet.')).toBeInTheDocument()
  })

  it('says why the accounts could not load', async () => {
    fakeServer({}, failing('list_accounts', 'Could not read accounts'))
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read accounts')
    expect(screen.queryByText('No accounts yet.')).not.toBeInTheDocument()
  })
})

describe('MerchantsWidget', () => {
  it('ranks merchants with bars against the biggest one', async () => {
    const server = fakeServer({
      top_merchants: () => [
        { merchant: 'Costco', spentCents: 10000, count: 3 },
        { merchant: 'Sweet Cow', spentCents: 2500, count: 2 },
      ],
    })
    renderSignedIn(<MerchantsWidget budget={budgetFor(categories, [])} offset={-1} />)
    expect(await screen.findByRole('progressbar', { name: 'Costco: $100' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(screen.getByRole('progressbar', { name: 'Sweet Cow: $25' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(server.actions('top_merchants')).toEqual([{ offset: -1, limit: 6 }])
  })

  it('says when nothing was spent this period', async () => {
    fakeServer({ top_merchants: () => [] })
    renderSignedIn(<MerchantsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('No spending yet this period.')).toBeInTheDocument()
  })
})

describe('TrendsWidget', () => {
  const months = [
    ['2026-06-01', '2026-06-30', 50000],
    ['2026-07-01', '2026-07-31', 60000],
    ['2026-08-01', '2026-08-31', 55000],
    ['2026-09-01', '2026-09-30', 70000],
    ['2026-10-01', '2026-10-31', 65000],
    ['2026-11-01', '2026-11-30', 34000],
  ] as const
  const trends = months.map(([start, end, spentCents], i) => ({
    offset: i - 5,
    start,
    end,
    spentCents,
    incomeCents: 0,
    categories: [],
  }))

  it('charts the last six periods against the total budget', async () => {
    const server = fakeServer({
      get_trends: () => trends,
      get_budget: () => budgetFor(categories, []),
    })
    renderSignedIn(<TrendsWidget />)
    expect(
      await screen.findByRole('img', { name: 'Spending by period' }),
    ).toHaveAccessibleDescription(
      'Jun $500, Jul $600, Aug $550, Sep $700, Oct $650, Nov $340. Budget $800.',
    )
    expect(screen.getByText('Jun 1 to Nov 30')).toBeInTheDocument()
    expect(server.actions('get_trends')).toEqual([{ periods: 6 }])
    expect(server.actions('get_budget')).toEqual([{ offset: 0 }])
  })

  it('leaves out the budget line when nothing is budgeted', async () => {
    fakeServer({
      get_trends: () => trends,
      get_budget: () => budgetFor([category('Fun')], []),
    })
    renderSignedIn(<TrendsWidget />)
    expect(
      await screen.findByRole('img', { name: 'Spending by period' }),
    ).toHaveAccessibleDescription(/Nov \$340$/)
  })

  it('still charts spending when the budget cannot be read', async () => {
    fakeServer({ get_trends: () => trends }, failing('get_budget', 'Budget failed'))
    renderSignedIn(<TrendsWidget />)
    const chart = await screen.findByRole('img', { name: /^Spending by period/ })
    expect(chart).not.toHaveAccessibleDescription(/Budget/)
  })

  it('labels bars by start day for periods that are not months', async () => {
    const weeks = [
      { ...trends[0]!, offset: -1, start: '2026-11-09', end: '2026-11-15' },
      { ...trends[1]!, offset: 0, start: '2026-11-16', end: '2026-11-22' },
    ]
    fakeServer({ get_trends: () => weeks, get_budget: () => budgetFor(categories, []) })
    renderSignedIn(<TrendsWidget />, {
      settings: settingsSchema.parse({ timeZone: 'America/Denver', period: { kind: 'weekly' } }),
    })
    expect(
      await screen.findByRole('img', { name: 'Spending by period' }),
    ).toHaveAccessibleDescription(/^Nov 9 \$500, Nov 16 \$600/)
    expect(screen.getByText('Nov 9 to Nov 22')).toBeInTheDocument()
  })

  it('copes with an empty list of periods', async () => {
    const server = fakeServer({ get_trends: () => [], get_budget: () => budgetFor(categories, []) })
    renderSignedIn(<TrendsWidget />)
    await waitFor(() => expect(server.actions('get_trends')).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'Spending over time' })).toBeInTheDocument()
  })

  it('shows only the heading until the trends arrive', () => {
    fakeServer({ get_trends: () => trends, get_budget: () => budgetFor(categories, []) })
    renderSignedIn(<TrendsWidget />)
    expect(screen.getByRole('heading', { name: 'Spending over time' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
