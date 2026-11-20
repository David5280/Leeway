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

  it('shows what is left as the hero, a safe amount per day and the share used', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('Left to spend$600')
    // $600 over the 14 days still to spend, today included, is $42.85 a day.
    expect(region()).toHaveTextContent('About $43 a day for the next 14 days, of $800')
    const ring = screen.getByRole('progressbar', { name: 'Budget used' })
    expect(ring).toHaveAttribute('aria-valuenow', '25')
    // 25% used by day 17 of 30 is behind the calendar, so the ring reads fine.
    expect(ring).toHaveClass('ring-ok')
    // The ring shows the share used, so the line under it only names the ring's mark.
    expect(region()).toHaveTextContent('57% of the way through the month, marked on the ring.')
    expect(region()).not.toHaveTextContent('of the budget used')
    // The comparison with last month belongs to the Activity hero, not this one.
    expect(within(region()).queryByRole('img', { name: /last month/ })).not.toBeInTheDocument()
  })

  it('warns in the ring when spending runs ahead of the days', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 60000 }])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    // 75% used against 57% of the month is more than 10 points ahead.
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).toHaveClass('ring-watch')
  })

  it('says how far over it is, in red', () => {
    const budget = budgetFor(categories, [
      { categoryId: groceries.id, amountCents: 60000 },
      { categoryId: dining.id, amountCents: 30000 },
    ])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('Over budget$100')
    expect(region()).toHaveTextContent('Over budget by $100 of $800')
    expect(screen.getByText('$100', { selector: '.hero-figure-number' })).toHaveClass(
      'money-problem',
    )
    // The ring stops at full even though spending went past it, and says how far.
    const ring = screen.getByRole('progressbar', { name: 'Budget used' })
    expect(ring).toHaveAttribute('aria-valuenow', '100')
    expect(ring).toHaveAttribute('aria-valuetext', '113%')
    expect(ring).toHaveClass('ring-over')
  })

  it('treats a budget spent to the cent as nothing left, not over', () => {
    const budget = budgetFor(categories, [
      { categoryId: groceries.id, amountCents: 60000 },
      { categoryId: dining.id, amountCents: 20000 },
    ])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('Left to spend$0')
    expect(region()).not.toHaveTextContent('Over budget')
  })

  it('says "1 day" on the last day of the period', () => {
    const budget = withChanges(budgetFor(categories, []), {
      period: { daysLeft: 0 },
      totals: { safePerDayCents: 80000 },
    })
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    expect(region()).toHaveTextContent('About $800 a day for the next 1 day, of $800')
  })

  it('leaves out the daily amount, the usual and the calendar for a past period', () => {
    const budget = withChanges(
      budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }]),
      { period: { offset: -1 }, totals: { safePerDayCents: null } },
    )
    renderSignedIn(<LeewayWidget budget={budget} offset={-1} />)
    expect(region()).toHaveTextContent('Left of $800')
    expect(region()).not.toHaveTextContent('a day')
    expect(region()).not.toHaveTextContent('of the way through')
    expect(screen.queryByRole('img', { name: /last month/ })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Budget used' })).not.toHaveClass('ring-watch')
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
    expect(region()).toHaveTextContent('Left to spend$400')
    expect(region()).toHaveTextContent('About $29 a day for the next 14 days, of $800')
    const list = within(screen.getByRole('list', { name: 'Set aside for goals' }))
    expect(list.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Set aside for Road bike$150',
      'Set aside for Trip$50',
    ])
  })

  it('opens the math behind what is left, goals included', async () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }], {
      setAsides: [{ goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 15000 }],
    })
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    await userEvent.click(within(region()).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Left to spend' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Left to spend $450 = Budgets this period $800 minus spent in them $200 minus set aside for goals $150',
    )
    expect(within(sheet).getByRole('link', { name: /Groceries/ })).toHaveAttribute(
      'href',
      `/budgets/${groceries.id}`,
    )
  })

  it('opens the math of an overspent budget as how far over', async () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 90000 }])
    renderSignedIn(<LeewayWidget budget={budget} offset={0} />)
    await userEvent.click(within(region()).getByRole('button'))
    expect(screen.getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Over budget by $100 = Budgets this period $800 minus spent in them $900',
    )
    expect(screen.getByText(/Spending in categories without a budget/)).toBeInTheDocument()
  })
})

describe('GlanceWidget', () => {
  // Each glance tile is a card named by its title.
  const card = (title: string) => screen.getByRole('region', { name: title })

  function serve(connections: Connection[] = []) {
    return fakeServer({ list_connections: () => connections, get_trends: () => [] })
  }

  /** Finished periods (offset below zero) and this one, as get_trends returns them. */
  const trend = (offset: number, spentCents: number) => ({
    offset,
    start: '2026-10-01',
    end: '2026-10-31',
    days: 31,
    spentCents,
    incomeCents: 0,
    categories: [],
  })

  it('puts what a whole period usually comes to under what is spent so far', async () => {
    fakeServer({
      list_connections: () => [],
      // The average leaves out this period and a period with nothing in it.
      get_trends: () => [trend(-3, 0), trend(-2, 70000), trend(-1, 90000), trend(0, 30000)],
    })
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 30000 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$300')
    expect(await within(card('Spent')).findByText(/Usually about/)).toHaveTextContent(
      'Usually about $800 a month',
    )
    // The same-point comparison stays on the Activity hero and in the drill-down.
    expect(within(card('Spent')).queryByRole('img')).not.toBeInTheDocument()
  })

  it('says what the figure is until a period has finished', () => {
    serve()
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(card('Spent')).toHaveTextContent('$0Spent this month')
  })

  it.each([
    [{ kind: 'weekly' }, 'week'],
    [{ kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-06' }, 'paycheck'],
  ])('uses the word for the budget period (%o)', async (period, word) => {
    fakeServer({ list_connections: () => [], get_trends: () => [trend(-1, 4200)] })
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 4200 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />, {
      settings: settingsSchema.parse({ timeZone: 'America/Denver', period }),
    })
    expect(await within(card('Spent')).findByText(/Usually about/)).toHaveTextContent(
      `Usually about $42 a ${word}`,
    )
    expect(card('Income')).toHaveTextContent(`Money in this ${word}`)
  })

  it('shows money in from income categories, signed and green', () => {
    serve()
    const paycheck = category('Paycheck', { kind: 'income' })
    const budget = budgetFor(
      [...categories, paycheck],
      [{ categoryId: paycheck.id, amountCents: -250000 }],
    )
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(screen.getByText('+$2,500', { selector: '.mid-number' })).toHaveClass('money-in')
    expect(card('Income')).toHaveTextContent('Money in this month')
  })

  it('counts what needs a category, and opens where to sort it', async () => {
    serve()
    const budget = budgetFor(categories, [{ categoryId: null, amountCents: 4500 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    expect(card('Needs a category')).toHaveTextContent('1$45 of spending to sort')
    await userEvent.click(within(card('Needs a category')).getByRole('button'))
    expect(screen.getByRole('link', { name: 'Sort 1 transaction' })).toHaveAttribute(
      'href',
      '/transactions?category=uncategorized',
    )
  })

  it('says everything is sorted when nothing needs a category', () => {
    serve()
    renderSignedIn(<GlanceWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(card('Needs a category')).toHaveTextContent('0All sorted')
  })

  it('opens the math behind what was spent', async () => {
    serve()
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 30000 }])
    renderSignedIn(<GlanceWidget budget={budget} offset={0} />)
    await userEvent.click(within(card('Spent')).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Spent this month' })
    expect(within(sheet).getByRole('region', { name: 'Compared with usual' })).toHaveTextContent(
      '$300 more than this point last month',
    )
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
    expect(await screen.findByText('Could not check your banks')).toBeInTheDocument()
    expect(card('Bank sync')).not.toHaveTextContent('Up to date')
  })
})

describe('AlertsWidget', () => {
  const region = () => screen.getByRole('region', { name: 'Heads up' })

  it('takes no room at all when nothing needs the owner', async () => {
    const server = fakeServer({
      list_connections: () => [connection({ id: 'a' })],
      list_alerts: () => [],
      get_ai_usage: () => ({ alert: null }),
    })
    const { container } = renderSignedIn(
      <AlertsWidget budget={budgetFor(categories, [])} offset={0} />,
    )
    await waitFor(() => expect(server.actions('get_ai_usage')).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps to three rows, banks then budgets worst first, and leads to every alert', async () => {
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
      '/alerts',
    ])
    expect(links[0]).toHaveTextContent('Bank')
    expect(links[1]).toHaveTextContent('Dining out is over budget by $40 ($240 of $200).Over')
    expect(links[2]).toHaveTextContent(
      'Groceries has used 83% of its budget, with $100 left.Warning',
    )
    expect(links[3]).toHaveTextContent('See all alerts')
    // Fun's pace and the transactions to sort wait on the Alerts page.
    expect(region()).toHaveTextContent('2 more alerts')
    expect(region()).not.toHaveTextContent('Fun is spending ahead of pace')
    // No account is in trouble, so the card keeps its plain colour.
    expect(region()).not.toHaveClass('over-card')
    expect(region()).not.toHaveClass('warn-card')
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
    expect(await screen.findByText('Chase stopped syncing. Open Banks to see why.')).toBeVisible()
    expect(region()).not.toHaveTextContent('log in again')
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
      '/accounts/short',
      '/accounts/low',
      '/settings/banks',
    ])
    expect(links[0]).toHaveTextContent('Overdrawn')
    expect(links[1]).toHaveTextContent('Low')
    // An overdrawn account turns the whole card red.
    expect(region()).toHaveClass('over-card')
  })

  it('is amber when the only account alert is a warning', async () => {
    fakeServer({
      list_connections: () => [],
      list_alerts: () =>
        alertsFor([
          bankAccount({ id: 'low', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
        ]),
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByText(/Bills is down to/)
    expect(region()).toHaveClass('warn-card')
    expect(within(region()).queryByRole('link', { name: 'See all alerts' })).toBeNull()
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

  it('shows the alert on its own, with a way to AI models, when nothing else needs the owner', async () => {
    serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText(/AI limit of \$5.00 is reached/)).toBeInTheDocument()
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

  it('counts the alert among the rest when three rows are already full', async () => {
    serveAlert()
    const budget = withChanges(
      budgetFor(categories, [
        { categoryId: dining.id, amountCents: 24000 },
        { categoryId: groceries.id, amountCents: 50000 },
        { categoryId: null, amountCents: 4500 },
      ]),
      {},
    )
    renderSignedIn(<AlertsWidget budget={budget} offset={0} />)
    expect(await within(region()).findByText('1 more alert')).toBeInTheDocument()
    expect(region()).not.toHaveTextContent('AI limit')
  })

  it('dismisses the alert through the owner-only action', async () => {
    const server = serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} offset={0} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss the AI spending alert' }),
    )
    await waitFor(() => expect(server.actions('dismiss_ai_alert')).toEqual([{}]))
    // With the alert gone nothing needs the owner, so Heads up steps aside.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Heads up' })).not.toBeInTheDocument(),
    )
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

  it('draws each spending category against its budget, biggest first', () => {
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
    const card = screen.getByRole('region', { name: 'Categories' })
    expect(within(card).getByText('Where did your money go?')).toBeInTheDocument()
    const rows = within(card).getAllByRole('listitem')
    // Income is not spending, so it has no row here.
    expect(rows.map((row) => row.querySelector('.cbar-name')?.textContent)).toEqual([
      'Rent',
      'Dining out',
      'Groceries',
    ])
    // A row with no budget shows only what it spent; one past its budget says so in a word.
    expect(rows[0]).toHaveTextContent(/Rent\$1,500$/)
    expect(rows[1]).toHaveTextContent('Dining outOver$240 of $200')
    expect(rows[1]!.querySelector('.cbar-past')).not.toBeNull()
    expect(rows[2]).toHaveTextContent(/Groceries\$200 of \$600$/)
    expect(card).toHaveTextContent('The line on each bar is its budget.')
  })

  it('calls a budget used up to its limit close', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 60000 }])
    renderSignedIn(<CategoriesWidget budget={budget} offset={0} />)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('GroceriesClose$600 of $600')
  })

  it('shows the five biggest and counts the rest, which the drill-down lists', async () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name) => category(name))
    const budget = budgetFor(
      many,
      many.map((one, index) => ({ categoryId: one.id, amountCents: (index + 1) * 1000 })),
    )
    renderSignedIn(<CategoriesWidget budget={budget} offset={0} />)
    const card = screen.getByRole('region', { name: 'Categories' })
    expect(within(card).getAllByRole('listitem')).toHaveLength(5)
    expect(card).toHaveTextContent('2 more categories.')
    await userEvent.click(within(card).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Where your money went' })
    expect(within(sheet).getByRole('link', { name: /^A/ })).toHaveAttribute(
      'href',
      `/budgets/${many[0]!.id}`,
    )
    expect(within(sheet).getByRole('link', { name: 'Open budgets' })).toHaveAttribute(
      'href',
      '/budgets',
    )
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
    expect(screen.getByText('Nov 17 · Groceries')).toBeInTheDocument()
    expect(screen.getByText('$84.50')).toBeInTheDocument()
    // No merchant name: the bank's description, cleaned.
    expect(screen.getByText('Sweet Cow')).toBeInTheDocument()
    expect(screen.getByText('Nov 16 · Needs a category, pending')).toBeInTheDocument()
    // A transfer only moved money, so it has no sign and a quiet tone.
    expect(screen.getByText('Nov 9 · Transfer')).toBeInTheDocument()
    expect(screen.getByText('$2,500.00')).toHaveClass('money-muted')
  })

  it('opens what they add up to, leaving the transfer out', async () => {
    fakeServer({ list_transactions: () => ({ transactions: txs, total: txs.length }) })
    renderSignedIn(<RecentWidget budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByText('Costco')
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Recent transactions' })).getByRole('button'),
    )
    const sheet = screen.getByRole('dialog', { name: 'Recent transactions' })
    // $84.50 and $9 out; the $2,500 is a transfer the budget does not list, so neither.
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Out, after what came in $94 = Money out $94 minus money in $0',
    )
    expect(within(sheet).getByRole('link', { name: 'See all transactions' })).toHaveAttribute(
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
    expect(await screen.findByText('Nov 4 · Card payment')).toBeInTheDocument()
    expect(screen.getByText('$409.30')).toHaveClass('money-muted')
    expect(screen.queryByText('+$409.30')).not.toBeInTheDocument()
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
    expect(screen.getByText('+$125.00')).toHaveClass('money-in')
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
  })

  it('opens what the counted accounts come to, each opening its own page', async () => {
    fakeServer({
      list_accounts: () => [
        account({ id: 'a', name: 'Checking', balanceCents: 123456 }),
        account({ id: 'b', name: 'Old savings', hidden: true, balanceCents: 500 }),
        account({ id: 'd', name: 'Travel card', type: 'credit', balanceCents: 80000 }),
      ],
    })
    renderSignedIn(<AccountsWidget />)
    await screen.findByText('Checking')
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Accounts' })).getByRole('button'),
    )
    const sheet = screen.getByRole('dialog', { name: 'Your accounts' })
    // The ignored account is left out of the sum and the list.
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Together $435 = Owned in these accounts $1,235 minus owed on cards and loans $800',
    )
    expect(within(sheet).getByRole('link', { name: /Checking/ })).toHaveAttribute(
      'href',
      '/accounts/a',
    )
    expect(within(sheet).queryByText('Old savings')).not.toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    )
  })

  it("draws a line of each account's recent balance, when it has one", async () => {
    fakeServer({
      list_accounts: () => [
        account({ id: 'a', name: 'Checking', balanceCents: 9000 }),
        account({ id: 'b', name: 'New savings', balanceCents: 100 }),
      ],
      list_recent_balances: () => [
        { accountId: 'a', balancesCents: [5000, 7000, 9000] },
        { accountId: 'b', balancesCents: [100] },
      ],
    })
    renderSignedIn(<AccountsWidget />)
    const checking = (await screen.findByText('Checking')).closest('.list-row')!
    await waitFor(() => expect(checking.querySelector('svg.spark polyline')).not.toBeNull())
    // Decorative: the card's button still reads as the account list.
    expect(checking.querySelector('svg.spark')).toHaveAttribute('aria-hidden', 'true')
    // One day of history makes no line.
    const savings = screen.getByText('New savings').closest('.list-row')!
    expect(savings.querySelector('svg.spark')).toBeNull()
  })

  it('shows an overdrawn cash balance in red, but never a card balance', async () => {
    fakeServer({
      list_accounts: () => [
        account({ id: 'a', name: 'Checking', balanceCents: -4210 }),
        account({ id: 'b', name: 'Card', type: 'credit', balanceCents: 5000 }),
      ],
    })
    renderSignedIn(<AccountsWidget />)
    expect(await screen.findByText('−$42.10')).toHaveClass('money-problem')
    expect(screen.getByText('$50.00')).not.toHaveClass('money-problem')
  })

  it("shows each account's name under its bank and last four digits", async () => {
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
    // The line under the name names the bank, so the name drops it from the front.
    expect(screen.getByText('Chase ··0388').closest('.list-row')).toHaveTextContent(
      /^Credit CardChase ··0388/,
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
    await userEvent.click(
      within(screen.getByRole('region', { name: 'Top merchants' })).getByRole('button'),
    )
    const sheet = screen.getByRole('dialog', { name: 'Top merchants' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Spent at these merchants $125 = Costco $100 plus Sweet Cow $25',
    )
  })

  it('says when nothing was spent this period', async () => {
    fakeServer({ top_merchants: () => [] })
    renderSignedIn(<MerchantsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('No spending yet this period.')).toBeInTheDocument()
  })

  it('shows why merchants could not be read', async () => {
    fakeServer({}, failing('top_merchants', 'Database is down'))
    renderSignedIn(<MerchantsWidget budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
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
